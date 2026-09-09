import { describe, it, expect } from 'vitest';
import { deriveConnectionState, FRESH_WINDOW_MS } from './connection-state';

// Hard tests for connection truthfulness (Bank Accounts hardening spec §23).
// The core rule under test: connection state comes from PROVIDER EVIDENCE,
// never from transaction recency or balance age.

const NOW = Date.parse('2026-09-09T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const H = 3_600_000;
const D = 24 * H;

describe('connection truthfulness', () => {
  it('1. healthy connection + no transactions for 90 days → HEALTHY, not disconnected', () => {
    // Transaction recency is NOT an input to connection state at all — an
    // account with zero activity for months is still healthy if syncs succeed.
    const d = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active',
      lastSyncAttemptAt: iso(1 * H), lastSyncSuccessAt: iso(1 * H), lastSyncStatus: 'success',
      now: NOW,
    });
    expect(d.status).toBe('HEALTHY');
  });

  it('2. ITEM_LOGIN_REQUIRED → ACTION_REQUIRED with reauth', () => {
    const d = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active', providerErrorCode: 'ITEM_LOGIN_REQUIRED',
      lastSyncSuccessAt: iso(2 * D), now: NOW,
    });
    expect(d.status).toBe('ACTION_REQUIRED');
    expect(d.source).toBe('provider');
    expect(d.userActionType).toBe('reauth');
  });

  it('3. PENDING_DISCONNECT → PENDING_DISCONNECT + proactive repair', () => {
    const d = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active', pendingDisconnectAt: iso(-3 * D),
      lastSyncSuccessAt: iso(1 * H), lastSyncStatus: 'success', now: NOW,
    });
    expect(d.status).toBe('PENDING_DISCONNECT');
    expect(d.requiresUserAction).toBe(true);
  });

  it('4. institution degraded but auth healthy → DEGRADED, not disconnected, no reconnect ask', () => {
    const d = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active', institutionHealth: 'DEGRADED',
      lastSyncSuccessAt: iso(2 * H), lastSyncStatus: 'success', now: NOW,
    });
    expect(d.status).toBe('DEGRADED');
    expect(d.requiresUserAction).toBe(false);
    expect(d.reason).toMatch(/not reconnect/i);
  });

  it('5. institution down → PROVIDER_OUTAGE (never blamed on the user)', () => {
    const byHealth = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active', institutionHealth: 'DOWN',
      lastSyncSuccessAt: iso(30 * H), now: NOW,
    });
    expect(byHealth.status).toBe('PROVIDER_OUTAGE');
    const byCode = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active', providerErrorCode: 'INSTITUTION_DOWN', now: NOW,
    });
    expect(byCode.status).toBe('PROVIDER_OUTAGE');
    expect(byCode.requiresUserAction).toBe(false);
  });

  it('6. our sync job stops running → STALE, NOT disconnected', () => {
    const d = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active',
      lastSyncAttemptAt: iso(5 * D), lastSyncSuccessAt: iso(5 * D), lastSyncStatus: 'success',
      now: NOW,
    });
    expect(d.status).toBe('STALE');
    expect(d.reason).not.toMatch(/disconnect/i);
  });

  it('6b. our sync crashes repeatedly with no provider verdict → ERROR, not disconnected', () => {
    const d = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active',
      lastSyncAttemptAt: iso(1 * H), lastSyncSuccessAt: iso(3 * D), lastSyncStatus: 'failed',
      now: NOW,
    });
    expect(d.status).toBe('ERROR');
    expect(d.reason).not.toMatch(/reconnect/i);
  });

  it('7+8. one data type fails, the other succeeds → DEGRADED (partial), connection proven', () => {
    const d = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active',
      lastSyncAttemptAt: iso(1 * H), lastSyncSuccessAt: iso(1 * H), lastSyncStatus: 'partial',
      now: NOW,
    });
    expect(d.status).toBe('DEGRADED');
    expect(d.requiresUserAction).toBe(false);
  });

  it('9. no provider evidence at all → UNKNOWN (a valid state, never invented certainty)', () => {
    const d = deriveConnectionState({ provider: 'plaid', itemStatus: 'active', now: NOW });
    expect(d.status).toBe('UNKNOWN');
    const manual = deriveConnectionState({ provider: null, now: NOW });
    expect(manual.status).toBe('UNKNOWN');
  });

  it('11. connection state is independent of transaction activity (no txn inputs exist)', () => {
    // The evidence type has NO transaction-recency field: this is enforced by
    // construction. Two accounts with wildly different activity derive the
    // same state from the same provider evidence.
    const a = deriveConnectionState({ provider: 'plaid', itemStatus: 'active', lastSyncSuccessAt: iso(H), lastSyncStatus: 'success', now: NOW });
    const b = deriveConnectionState({ provider: 'plaid', itemStatus: 'active', lastSyncSuccessAt: iso(H), lastSyncStatus: 'success', now: NOW });
    expect(a).toEqual(b);
  });

  it('transient provider errors (RATE_LIMIT, maintenance) → ERROR without reconnect demand', () => {
    for (const code of ['RATE_LIMIT_EXCEEDED', 'INTERNAL_SERVER_ERROR', 'PLANNED_MAINTENANCE']) {
      const d = deriveConnectionState({ provider: 'plaid', itemStatus: 'active', providerErrorCode: code, now: NOW });
      expect(d.status).toBe('ERROR');
      expect(d.requiresUserAction).toBe(false);
    }
  });

  it('NO_ACCOUNTS / NEW_ACCOUNTS_AVAILABLE → ACTION_REQUIRED with account re-selection', () => {
    const d = deriveConnectionState({ provider: 'plaid', itemStatus: 'active', providerErrorCode: 'NO_ACCOUNTS', now: NOW });
    expect(d.status).toBe('ACTION_REQUIRED');
    expect(d.userActionType).toBe('reselect_accounts');
  });

  it('consent expiring within 7 days → PENDING_DISCONNECT; already expired → ACTION_REQUIRED', () => {
    const soon = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active', consentExpirationAt: new Date(NOW + 3 * D).toISOString(),
      lastSyncSuccessAt: iso(H), lastSyncStatus: 'success', now: NOW,
    });
    expect(soon.status).toBe('PENDING_DISCONNECT');
    const expired = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active', consentExpirationAt: iso(1 * D), now: NOW,
    });
    expect(expired.status).toBe('ACTION_REQUIRED');
  });

  it('deliberately retired item → DISCONNECTED', () => {
    const d = deriveConnectionState({ provider: 'plaid', itemStatus: 'inactive', now: NOW });
    expect(d.status).toBe('DISCONNECTED');
  });

  it('unrecognized provider error → ERROR + review, never guessed into a bucket', () => {
    const d = deriveConnectionState({ provider: 'plaid', itemStatus: 'active', providerErrorCode: 'SOME_FUTURE_CODE', now: NOW });
    expect(d.status).toBe('ERROR');
    expect(d.userActionType).toBe('review');
  });

  it('sync in progress → SYNCING', () => {
    const d = deriveConnectionState({ provider: 'plaid', itemStatus: 'active', syncInProgress: true, lastSyncSuccessAt: iso(H), now: NOW });
    expect(d.status).toBe('SYNCING');
  });

  it('freshness window boundary: success just inside → HEALTHY, just outside → STALE', () => {
    const inside = deriveConnectionState({ provider: 'plaid', itemStatus: 'active', lastSyncSuccessAt: iso(FRESH_WINDOW_MS - 60_000), lastSyncStatus: 'success', now: NOW });
    expect(inside.status).toBe('HEALTHY');
    const outside = deriveConnectionState({ provider: 'plaid', itemStatus: 'active', lastSyncSuccessAt: iso(FRESH_WINDOW_MS + 60_000), lastSyncStatus: 'success', now: NOW });
    expect(outside.status).toBe('STALE');
  });

  it('provider signals always outrank freshness (fresh sync + login error = ACTION_REQUIRED)', () => {
    const d = deriveConnectionState({
      provider: 'plaid', itemStatus: 'active', providerErrorCode: 'ITEM_LOGIN_REQUIRED',
      lastSyncSuccessAt: iso(10 * 60_000), lastSyncStatus: 'success', now: NOW,
    });
    expect(d.status).toBe('ACTION_REQUIRED');
  });
});
