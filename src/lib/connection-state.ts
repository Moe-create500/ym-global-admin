// ============================================================================
// CONNECTION STATE — canonical, evidence-based bank connection model.
//
// THE RULE: the UI must never claim something about a bank connection that the
// backend cannot prove. Connection status comes from AUTHORITATIVE PROVIDER
// SIGNALS (Plaid/Teller error codes, webhooks, item state) — NEVER from
// transaction recency, balance age, or "no new data". Freshness is a separate,
// descriptive measurement. UNKNOWN is a valid, honest answer.
//
// Separated concepts (do not collapse):
//   A. connection status   — can the provider access the item? (this module)
//   B. institution health  — is the BANK itself degraded at the provider?
//   C. data freshness      — when did we last receive useful data?
//   D. balance freshness   — when was the balance last bank-confirmed?
//   E. txn freshness       — newest transaction date (descriptive ONLY)
//   F. sync job status     — did OUR job run? (sync_runs table)
// ============================================================================

import type Database from 'better-sqlite3';

export type ConnectionStatus =
  | 'HEALTHY'
  | 'SYNCING'
  | 'STALE'
  | 'DEGRADED'
  | 'ACTION_REQUIRED'
  | 'PENDING_DISCONNECT'
  | 'DISCONNECTED'
  | 'PROVIDER_OUTAGE'
  | 'ERROR'
  | 'UNKNOWN';

export interface ConnectionEvidence {
  provider: string | null; // 'plaid' | 'teller' | null/manual
  /** plaid_items.status ('active'|'inactive') or teller enrollment state */
  itemStatus?: string | null;
  /** Authoritative provider error code (ITEM_LOGIN_REQUIRED, ...) */
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  errorDetectedAt?: string | null;
  /** Provider told us the item will disconnect (webhook PENDING_DISCONNECT/PENDING_EXPIRATION) */
  pendingDisconnectAt?: string | null;
  consentExpirationAt?: string | null;
  /** 'HEALTHY' | 'DEGRADED' | 'DOWN' | null=never checked */
  institutionHealth?: string | null;
  lastSyncAttemptAt?: string | null;
  lastSyncSuccessAt?: string | null;
  /** status of the LAST sync run: 'success' | 'partial' | 'failed' */
  lastSyncStatus?: string | null;
  syncInProgress?: boolean;
  /** ms epoch "now" — injected for testability */
  now?: number;
}

export interface DerivedConnection {
  status: ConnectionStatus;
  /** human-readable, evidence-grounded explanation */
  reason: string;
  /** what proved it: 'provider' (authoritative) | 'sync' (our job) | 'none' */
  source: 'provider' | 'sync' | 'none';
  requiresUserAction: boolean;
  userActionType: 'reauth' | 'reselect_accounts' | 'review' | null;
}

const ts = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? null : t;
};

const HOURS = 3_600_000;

// Provider error codes that PROVE user re-auth is needed (Plaid + generic)
const REAUTH_CODES = /^(ITEM_LOGIN_REQUIRED|ITEM_LOCKED|INVALID_CREDENTIALS|INVALID_MFA|USER_SETUP_REQUIRED|ACCESS_NOT_GRANTED|ITEM_NO_LONGER_SUPPORTED|USER_PERMISSION_REVOKED)$/i;
const RESELECT_CODES = /^(NO_ACCOUNTS|NEW_ACCOUNTS_AVAILABLE|ADDITIONAL_CONSENT_REQUIRED)$/i;
// Bank-side problems at the provider — NOT the user's fault, do not tell them to reconnect
const INSTITUTION_CODES = /^(INSTITUTION_DOWN|INSTITUTION_NOT_RESPONDING|INSTITUTION_NOT_AVAILABLE|INSTITUTION_NO_LONGER_SUPPORTED)$/i;
// Transient provider/plumbing problems
const TRANSIENT_CODES = /^(INTERNAL_SERVER_ERROR|PLANNED_MAINTENANCE|RATE_LIMIT_EXCEEDED|API_ERROR|PRODUCT_NOT_READY)$/i;

/** How long after the last successful sync we still call the connection HEALTHY.
 *  Sync cadence is ~30–120 min; 36h tolerates weekends/outages on OUR side
 *  without accusing the bank connection. */
export const FRESH_WINDOW_MS = 36 * HOURS;

export function deriveConnectionState(e: ConnectionEvidence): DerivedConnection {
  const now = e.now ?? Date.now();
  const code = (e.providerErrorCode || '').trim();

  // ---- 1. Authoritative provider signals win over everything -------------
  if (code) {
    if (REAUTH_CODES.test(code)) {
      return {
        status: 'ACTION_REQUIRED',
        reason: `${e.provider === 'plaid' ? 'Plaid' : 'Provider'} returned ${code} — bank authorization must be renewed`,
        source: 'provider', requiresUserAction: true, userActionType: 'reauth',
      };
    }
    if (RESELECT_CODES.test(code)) {
      return {
        status: 'ACTION_REQUIRED',
        reason: `Provider returned ${code} — account selection/consent must be updated`,
        source: 'provider', requiresUserAction: true, userActionType: 'reselect_accounts',
      };
    }
    if (INSTITUTION_CODES.test(code)) {
      return {
        status: 'PROVIDER_OUTAGE',
        reason: `The bank is currently unavailable at the provider (${code}). Authorization looks valid — do not reconnect.`,
        source: 'provider', requiresUserAction: false, userActionType: null,
      };
    }
    if (TRANSIENT_CODES.test(code)) {
      return {
        status: 'ERROR',
        reason: `Provider error ${code} on last sync — usually transient; no user action proven necessary`,
        source: 'provider', requiresUserAction: false, userActionType: null,
      };
    }
    // Unrecognized provider code: report honestly, require review, invent nothing
    return {
      status: 'ERROR',
      reason: `Unrecognized provider error ${code} — needs review`,
      source: 'provider', requiresUserAction: true, userActionType: 'review',
    };
  }

  // ---- 2. Scheduled disconnect / consent expiry (provider-announced) -----
  if (e.pendingDisconnectAt) {
    return {
      status: 'PENDING_DISCONNECT',
      reason: `Provider announced this connection will disconnect (${e.pendingDisconnectAt.slice(0, 10)}) — repair proactively`,
      source: 'provider', requiresUserAction: true, userActionType: 'reauth',
    };
  }
  const consentTs = ts(e.consentExpirationAt);
  if (consentTs != null && consentTs - now < 7 * 24 * HOURS) {
    const expired = consentTs <= now;
    return {
      status: expired ? 'ACTION_REQUIRED' : 'PENDING_DISCONNECT',
      reason: expired
        ? `Bank consent expired ${e.consentExpirationAt!.slice(0, 10)} — reauthorize`
        : `Bank consent expires ${e.consentExpirationAt!.slice(0, 10)} — reauthorize before it lapses`,
      source: 'provider', requiresUserAction: true, userActionType: 'reauth',
    };
  }

  // ---- 3. Item deliberately retired on our side --------------------------
  if (e.itemStatus === 'inactive' || e.itemStatus === 'disconnected') {
    return {
      status: 'DISCONNECTED',
      reason: 'Connection was retired (superseded or deactivated) — relink to restore',
      source: 'provider', requiresUserAction: true, userActionType: 'reauth',
    };
  }

  // ---- 4. No provider at all (manual account) ----------------------------
  if (!e.provider) {
    return {
      status: 'UNKNOWN',
      reason: 'Manual account — no provider feed exists to verify',
      source: 'none', requiresUserAction: false, userActionType: null,
    };
  }

  // ---- 5. Institution health (auth fine, bank degraded at provider) ------
  if (e.institutionHealth === 'DOWN') {
    return {
      status: 'PROVIDER_OUTAGE',
      reason: 'Provider reports the institution is down. Authorization looks valid — do not reconnect.',
      source: 'provider', requiresUserAction: false, userActionType: null,
    };
  }

  // ---- 6. Our own sync-job evidence --------------------------------------
  if (e.syncInProgress) {
    return { status: 'SYNCING', reason: 'Sync in progress', source: 'sync', requiresUserAction: false, userActionType: null };
  }

  const successTs = ts(e.lastSyncSuccessAt);
  const attemptTs = ts(e.lastSyncAttemptAt);

  if (successTs != null && now - successTs <= FRESH_WINDOW_MS) {
    if (e.institutionHealth === 'DEGRADED') {
      return {
        status: 'DEGRADED',
        reason: 'Connection works, but the provider reports degraded connectivity for this bank — data may lag. Do not reconnect.',
        source: 'provider', requiresUserAction: false, userActionType: null,
      };
    }
    if (e.lastSyncStatus === 'partial') {
      return {
        status: 'DEGRADED',
        reason: 'Last sync partially succeeded (some data types failed) — connection itself is proven working',
        source: 'sync', requiresUserAction: false, userActionType: null,
      };
    }
    return { status: 'HEALTHY', reason: `Last successful sync ${e.lastSyncSuccessAt}`, source: 'sync', requiresUserAction: false, userActionType: null };
  }

  // Success is old. That means OUR pipeline hasn't confirmed lately —
  // it does NOT prove the bank connection is broken.
  if (successTs != null) {
    if (attemptTs != null && attemptTs > successTs && e.lastSyncStatus === 'failed') {
      return {
        status: 'ERROR',
        reason: 'Recent sync attempts are failing without an authoritative provider error — investigate our pipeline first; no bank re-authorization is indicated',
        source: 'sync', requiresUserAction: false, userActionType: null,
      };
    }
    return {
      status: 'STALE',
      reason: `No successful sync since ${e.lastSyncSuccessAt} — connection state unproven either way; data below is last-known`,
      source: 'sync', requiresUserAction: false, userActionType: null,
    };
  }

  // ---- 7. No evidence at all ---------------------------------------------
  if (attemptTs != null && e.lastSyncStatus === 'failed') {
    return {
      status: 'ERROR',
      reason: 'Every recorded sync attempt failed and no provider verdict exists yet',
      source: 'sync', requiresUserAction: false, userActionType: null,
    };
  }
  return {
    status: 'UNKNOWN',
    reason: 'No sync evidence recorded for this connection yet — status cannot be verified',
    source: 'none', requiresUserAction: false, userActionType: null,
  };
}

// ============================================================================
// Schema: provider evidence on plaid_items + sync_runs job ledger
// ============================================================================

export function ensureConnectionSchema(db: Database.Database) {
  const alters = [
    "ALTER TABLE plaid_items ADD COLUMN institution_id TEXT",
    "ALTER TABLE plaid_items ADD COLUMN provider_error_code TEXT",
    "ALTER TABLE plaid_items ADD COLUMN provider_error_message TEXT",
    "ALTER TABLE plaid_items ADD COLUMN error_detected_at TEXT",
    "ALTER TABLE plaid_items ADD COLUMN pending_disconnect_at TEXT",
    "ALTER TABLE plaid_items ADD COLUMN consent_expiration_at TEXT",
    "ALTER TABLE plaid_items ADD COLUMN institution_health TEXT",
    "ALTER TABLE plaid_items ADD COLUMN institution_health_checked_at TEXT",
    "ALTER TABLE plaid_items ADD COLUMN last_sync_attempt_at TEXT",
    "ALTER TABLE plaid_items ADD COLUMN last_sync_success_at TEXT",
    "ALTER TABLE plaid_items ADD COLUMN last_sync_status TEXT",
    "ALTER TABLE bank_accounts ADD COLUMN last_txn_success_at TEXT",
    "ALTER TABLE bank_accounts ADD COLUMN archived INTEGER DEFAULT 0",
  ];
  for (const sql of alters) { try { db.exec(sql); } catch { /* column exists */ } }
  db.exec(`CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    item_id TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT,               -- success | partial | failed
    balance_result TEXT,       -- success | failed | skipped
    transaction_result TEXT,   -- success | failed | skipped
    records_added INTEGER DEFAULT 0,
    records_modified INTEGER DEFAULT 0,
    records_removed INTEGER DEFAULT 0,
    error_code TEXT,
    error_message TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_sync_runs_item ON sync_runs(item_id, started_at)');
}

/** Evidence loader for one plaid item row (already SELECTed). */
export function evidenceFromPlaidItem(item: any, opts: { syncInProgress?: boolean; now?: number } = {}): ConnectionEvidence {
  return {
    provider: 'plaid',
    itemStatus: item.status,
    providerErrorCode: item.provider_error_code,
    providerErrorMessage: item.provider_error_message,
    errorDetectedAt: item.error_detected_at,
    pendingDisconnectAt: item.pending_disconnect_at,
    consentExpirationAt: item.consent_expiration_at,
    institutionHealth: item.institution_health,
    lastSyncAttemptAt: item.last_sync_attempt_at,
    // Migration fallback: before evidence columns existed, updated_at was only
    // touched on successful cursor saves — legitimate success evidence.
    lastSyncSuccessAt: item.last_sync_success_at || item.updated_at,
    lastSyncStatus: item.last_sync_status || (item.updated_at ? 'success' : null),
    syncInProgress: opts.syncInProgress,
    now: opts.now,
  };
}
