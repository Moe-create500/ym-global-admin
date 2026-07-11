// Teller bank sync shared by the 30-min scheduled loop (instrumentation.ts)
// and the /api/cron/sync route. Balances + last 200 transactions per account.

import { getDb } from '@/lib/db';
import { getAccountBalance, getAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';

export async function syncBankAccounts(): Promise<{ accounts_synced: number; transactions_imported: number; errors: string[] }> {
  const db = getDb();
  const accounts: any[] = db.prepare("SELECT * FROM bank_accounts WHERE status = 'active'").all();
  let totalTxns = 0;
  let synced = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    // Manual-anchor accounts (e.g. Shopify Balance) have no Teller feed — skip
    if (!account.access_token || !account.teller_account_id) continue;
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
        for (const txn of txns) {
          const existing = db.prepare('SELECT id FROM bank_transactions WHERE teller_transaction_id = ?').get(txn.id);
          if (existing) continue;
          const amountCents = Math.round(parseFloat(txn.amount || '0') * 100);
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
        errors.push(`${account.account_name}: txn error - ${txnErr.message}`);
      }
    } catch (err: any) {
      errors.push(`${account.account_name}: ${err.message}`);
    }
  }

  return { accounts_synced: synced, transactions_imported: totalTxns, errors };
}
