import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccountBalance, getAccountTransactions, getAllAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';
import { dropBrainCache } from '@/lib/brain-cache';

export const dynamic = 'force-dynamic';

// POST: Sync balances + transactions for all or specific account
export async function POST(req: NextRequest) {
  dropBrainCache(); // financial write — cached answers must not outlive it
  const accountId = req.nextUrl.searchParams.get('accountId');
  const full = req.nextUrl.searchParams.get('full') === 'true';
  const db = getDb();

  const accounts: any[] = accountId
    ? [db.prepare("SELECT * FROM bank_accounts WHERE id = ? AND status = 'active' AND COALESCE(provider,'teller') = 'teller'").get(accountId)].filter(Boolean)
    : db.prepare("SELECT * FROM bank_accounts WHERE status = 'active' AND COALESCE(provider,'teller') = 'teller'").all();

  let totalTxns = 0;
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

        // For credit accounts, track credit limit (available + ledger when no pending)
        // Use max of current and stored to handle pending fluctuations
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
            balance_updated_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(...params);
      } catch (balErr: any) {
        errors.push(`${account.account_name}: balance error - ${balErr.message}`);
      }

      // Sync transactions
      try {
        const txns = full
          ? await getAllAccountTransactions(account.access_token, account.teller_account_id)
          : await getAccountTransactions(account.access_token, account.teller_account_id, 200);

        for (const txn of txns) {
          const amountCents = Math.round(parseFloat(txn.amount || '0') * 100);
          // Dedup by teller id, THEN by content — ids are application-scoped,
          // so a new Teller app must not re-import history
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
        errors.push(`${account.account_name}: transactions error - ${txnErr.message}`);
      }
    } catch (err: any) {
      errors.push(`${account.account_name}: ${err.message}`);
    }
  }

  // Plaid items (new connections live here)
  let plaidSynced = 0;
  try {
    const { syncPlaidItems } = await import('@/lib/plaid');
    const plaid = await syncPlaidItems(db);
    plaidSynced = plaid.accounts_synced;
    totalTxns += plaid.transactions_imported;
    errors.push(...plaid.errors);
  } catch (e: any) {
    errors.push(`plaid sync: ${String(e?.message || e).slice(0, 150)}`);
  }

  return NextResponse.json({
    success: true,
    accounts_synced: accounts.length + plaidSynced,
    transactions_imported: totalTxns,
    errors: errors.length > 0 ? errors : undefined,
  });
}
