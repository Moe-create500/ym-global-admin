// ============================================================================
// FINANCIAL INTEGRITY — database-level idempotency, source-truth revision
// history, and the financial health scan (hardening spec 2026-09-09).
//
// Philosophy: UNKNOWN is never ZERO, FAILED is never EMPTY, and the system
// reports its own problems before Moe finds them manually.
// ============================================================================

import type Database from 'better-sqlite3';
import crypto from 'crypto';

/** Idempotency enforced by the DATABASE, not just application checks.
 *  Verified duplicate-free before adding (2026-09-09, post account-merge):
 *  a replayed webhook/sync/import that slips past application dedupe now
 *  hits a UNIQUE constraint instead of double-counting money. */
export function ensureIntegritySchema(db: Database.Database) {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_txn_provider_id
    ON bank_transactions(teller_transaction_id) WHERE teller_transaction_id IS NOT NULL`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_spend_business_key
    ON ad_spend(store_id, date, platform, ad_id)`);

  // Source-truth revision history: provider modifications/removals never
  // silently rewrite history — the prior state is preserved here first.
  db.exec(`CREATE TABLE IF NOT EXISTS txn_revisions (
    id TEXT PRIMARY KEY,
    txn_id TEXT NOT NULL,
    change_type TEXT NOT NULL,      -- provider_modified | provider_removed | merge_dedupe
    old_json TEXT NOT NULL,
    new_json TEXT,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_txn_revisions_txn ON txn_revisions(txn_id)');
}

/** Preserve a transaction's prior state before mutating/deleting it. */
export function recordTxnRevision(
  db: Database.Database,
  txnId: string,
  changeType: 'provider_modified' | 'provider_removed' | 'merge_dedupe',
  oldRow: any,
  newRow: any | null,
  source = 'plaid',
) {
  db.prepare(`INSERT INTO txn_revisions (id, txn_id, change_type, old_json, new_json, source)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), txnId, changeType, JSON.stringify(oldRow), newRow ? JSON.stringify(newRow) : null, source);
}

export interface HealthIssue {
  key: string;
  severity: 'critical' | 'warning' | 'info';
  label: string;
  count: number;
  amount_cents?: number;
  href?: string;
}

/** The system reports what's wrong: every unresolved integrity issue with a
 *  count, a dollar amount where meaningful, and where to go fix it.
 *  Everything here is computed from evidence — no guesses. */
export function getFinancialHealth(db: Database.Database): { issues: HealthIssue[]; checked_at: string } {
  ensureIntegritySchema(db);
  const issues: HealthIssue[] = [];

  // 1. Connections that provably need user action (provider error codes)
  const broken: any = db.prepare(`SELECT COUNT(*) n FROM plaid_items
    WHERE status = 'active' AND provider_error_code IS NOT NULL
      AND provider_error_code IN ('ITEM_LOGIN_REQUIRED','ITEM_LOCKED','INVALID_CREDENTIALS','ACCESS_NOT_GRANTED','NO_ACCOUNTS','NEW_ACCOUNTS_AVAILABLE','USER_PERMISSION_REVOKED')`).get();
  if (broken.n > 0) issues.push({ key: 'connections_action', severity: 'critical', label: 'bank logins need re-authorization', count: broken.n, href: '/dashboard/banking' });

  // 2. Stale balances (no bank verification in 36h) — last-known money
  const stale: any = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(ABS(balance_available_cents)),0) amt FROM bank_accounts
    WHERE status = 'active' AND (balance_updated_at IS NULL OR balance_updated_at < datetime('now', '-36 hours'))`).get();
  if (stale.n > 0) issues.push({ key: 'stale_balances', severity: 'warning', label: 'accounts not verified in 36h', count: stale.n, amount_cents: stale.amt, href: '/dashboard/banking' });

  // 3. Possible duplicate accounts parked for review
  const possibleDup: any = db.prepare("SELECT COUNT(*) n FROM bank_accounts WHERE status = 'possible_duplicate'").get();
  if (possibleDup.n > 0) issues.push({ key: 'possible_dup_accounts', severity: 'critical', label: 'possible duplicate accounts need review', count: possibleDup.n, href: '/dashboard/banking' });

  // 4. Recent sync failures (24h)
  const failedSyncs: any = db.prepare(`SELECT COUNT(*) n FROM sync_runs
    WHERE status = 'failed' AND started_at > datetime('now', '-24 hours')`).get();
  if (failedSyncs.n > 0) issues.push({ key: 'sync_failures', severity: 'warning', label: 'sync failures in the last 24h', count: failedSyncs.n, href: '/dashboard/banking' });

  // 5. Uncategorized activity (90d) — money with no interpretation
  const uncat: any = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(ABS(bt.amount_cents)),0) amt
    FROM bank_transactions bt JOIN bank_accounts a ON a.id = bt.bank_account_id
    WHERE a.status = 'active' AND bt.custom_category IS NULL AND bt.category IS NULL
      AND bt.date > date('now', '-90 days')`).get();
  if (uncat.n > 0) issues.push({ key: 'uncategorized', severity: 'info', label: 'uncategorized transactions (90d)', count: uncat.n, amount_cents: uncat.amt, href: '/dashboard/transactions' });

  // 6. Transfer suspects: opposite-amount pairs across owned accounts within
  //    2 days, ≥$500, not already paired — potential double-counted movement.
  const transferSuspects: any = db.prepare(`
    SELECT COUNT(*) n, COALESCE(SUM(a.amount_cents),0) amt FROM bank_transactions a
    JOIN bank_transactions b ON b.amount_cents = -a.amount_cents
      AND b.bank_account_id != a.bank_account_id
      AND ABS(JULIANDAY(b.date) - JULIANDAY(a.date)) <= 2
    JOIN bank_accounts aa ON aa.id = a.bank_account_id AND aa.status = 'active'
    JOIN bank_accounts ba ON ba.id = b.bank_account_id AND ba.status = 'active'
    LEFT JOIN txn_links la ON la.txn_id = a.id AND la.pair_txn_id IS NOT NULL
    WHERE a.amount_cents >= 50000 AND a.date > date('now', '-60 days') AND la.txn_id IS NULL`).get();
  if (transferSuspects.n > 0) issues.push({ key: 'transfer_suspects', severity: 'warning', label: 'possible unlinked transfers (60d)', count: transferSuspects.n, amount_cents: transferSuspects.amt, href: '/dashboard/transactions' });

  // 7. Active credit cards with NO statement data (liabilities consent gap)
  const noStmt: any = db.prepare(`SELECT COUNT(*) n FROM bank_accounts a
    WHERE a.status = 'active' AND a.account_type = 'credit' AND a.provider = 'plaid'
      AND NOT EXISTS (SELECT 1 FROM card_statements cs WHERE cs.bank_account_id = a.id)`).get();
  if (noStmt.n > 0) issues.push({ key: 'missing_statements', severity: 'info', label: 'cards without bank statement data (consent gap)', count: noStmt.n, href: '/dashboard/credit-cards' });

  return { issues, checked_at: new Date().toISOString() };
}
