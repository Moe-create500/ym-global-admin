// Teller bank sync shared by the 30-min scheduled loop (instrumentation.ts)
// and the /api/cron/sync route. Balances + last 200 transactions per account.

import { getDb } from '@/lib/db';
import { getAccountBalance, getAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';

export async function syncBankAccounts(): Promise<{ accounts_synced: number; transactions_imported: number; errors: string[] }> {
  const db = getDb();
  // Teller-provider rows only — Plaid items sync separately below
  const accounts: any[] = db.prepare("SELECT * FROM bank_accounts WHERE status = 'active' AND COALESCE(provider, 'teller') = 'teller'").all();
  let totalTxns = 0;
  let synced = 0;
  const errors: string[] = [];
  const isRateLimit = (e: any) => /429|too_many_requests|rate limit/i.test(String(e?.message || e));
  let rateLimited = false;

  for (const account of accounts) {
    // Manual-anchor accounts (e.g. Shopify Balance) have no Teller feed — skip
    if (!account.access_token || !account.teller_account_id) continue;
    // Circuit breaker: once Teller rate-limits, STOP — hammering the remaining
    // accounts burns the whole quota and the limit never gets a chance to clear
    if (rateLimited) break;
    // Gentle pacing between accounts keeps a full pass under the burst limit
    await new Promise(r => setTimeout(r, 1500));
    try {
      // Sync balance
      try {
        const balance = await getAccountBalance(account.access_token, account.teller_account_id);
        const available = Math.round(parseFloat(balance.available || '0') * 100);
        const ledger = Math.round(parseFloat(balance.ledger || '0') * 100);

        let creditLimitUpdate = '';
        const params: any[] = [available, ledger];
        if (account.account_type === 'credit') {
          const derivedLimit = available + ledger;
          const storedLimit = account.credit_limit_cents || 0;
          const creditLimit = Math.max(derivedLimit, storedLimit);
          creditLimitUpdate = ', credit_limit_cents = ?';
          params.push(creditLimit);
        }
        params.push(account.id);

        db.prepare(`
          UPDATE bank_accounts SET balance_available_cents = ?, balance_ledger_cents = ?${creditLimitUpdate},
            balance_updated_at = datetime('now'), updated_at = datetime('now'), last_sync_error = NULL
          WHERE id = ?
        `).run(...params);
        synced++;
      } catch (balErr: any) {
        if (isRateLimit(balErr)) { rateLimited = true; errors.push('Teller rate limit hit — remaining accounts skipped this pass'); continue; }
        const msg = String(balErr.message || balErr);
        const friendly = /not_found|404|410|unauthorized|401/i.test(msg)
          ? 'CONNECTION EXPIRED — reconnect this bank via Connect Card (Teller re-auth required)'
          : msg.slice(0, 180);
        try {
          db.exec('ALTER TABLE bank_accounts ADD COLUMN last_sync_error TEXT');
        } catch { /* exists */ }
        db.prepare('UPDATE bank_accounts SET last_sync_error = ? WHERE id = ?').run(friendly, account.id);
        errors.push(`${account.account_name}: ${friendly}`);
      }

      // Sync transactions (last 200)
      try {
        const txns = await getAccountTransactions(account.access_token, account.teller_account_id, 200);

        // Track how fresh the BANK's data actually is. Teller keeps returning
        // 200 + last-known balances when a bank connection silently dies (BofA
        // froze 2026-07-08 while every sync "succeeded") — the newest
        // transaction date is the only truthful freshness signal.
        const newestTxnDate = txns.reduce((m: string, t: any) => (t.date && t.date > m ? t.date : m), '');
        if (newestTxnDate) {
          try { db.exec('ALTER TABLE bank_accounts ADD COLUMN bank_data_as_of TEXT'); } catch { /* exists */ }
          db.prepare('UPDATE bank_accounts SET bank_data_as_of = ? WHERE id = ?').run(newestTxnDate, account.id);
        }

        for (const txn of txns) {
          const amountCents = Math.round(parseFloat(txn.amount || '0') * 100);
          // Dedup by teller id, THEN by content — transaction ids are
          // application-scoped, so a new Teller app must not re-import history
          const existing = db.prepare('SELECT id FROM bank_transactions WHERE teller_transaction_id = ?').get(txn.id)
            || db.prepare('SELECT id FROM bank_transactions WHERE bank_account_id = ? AND date = ? AND amount_cents = ? AND description = ?')
              .get(account.id, txn.date, amountCents, txn.description);
          if (existing) continue;
          const runningBalance = txn.running_balance ? Math.round(parseFloat(txn.running_balance) * 100) : null;
          db.prepare(`
            INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, description,
              category, amount_cents, type, status, counterparty, running_balance_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(), account.id, txn.id, txn.date, txn.description,
            txn.details?.category || null, amountCents, txn.type, txn.status,
            txn.details?.counterparty?.name || null, runningBalance
          );
          totalTxns++;
        }
      } catch (txnErr: any) {
        if (isRateLimit(txnErr)) { rateLimited = true; errors.push('Teller rate limit hit — remaining accounts skipped this pass'); continue; }
        errors.push(`${account.account_name}: txn error - ${txnErr.message}`);
      }
    } catch (err: any) {
      errors.push(`${account.account_name}: ${err.message}`);
    }
  }

  // Plaid items (new connections live here — Teller went invite-only)
  try {
    const { syncPlaidItems } = await import('@/lib/plaid');
    const plaid = await syncPlaidItems(db);
    synced += plaid.accounts_synced;
    totalTxns += plaid.transactions_imported;
    errors.push(...plaid.errors);
  } catch (e: any) {
    errors.push(`plaid sync: ${String(e?.message || e).slice(0, 150)}`);
  }

  return { accounts_synced: synced, transactions_imported: totalTxns, errors };
}
