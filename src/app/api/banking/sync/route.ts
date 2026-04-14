import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccountBalance, getAccountTransactions, getAllAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// POST: Sync balances + transactions for all or specific account
export async function POST(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId');
  const full = req.nextUrl.searchParams.get('full') === 'true';
  const db = getDb();

  const accounts: any[] = accountId
    ? [db.prepare("SELECT * FROM bank_accounts WHERE id = ? AND status = 'active'").get(accountId)].filter(Boolean)
    : db.prepare("SELECT * FROM bank_accounts WHERE status = 'active'").all();

  if (accounts.length === 0) {
    return NextResponse.json({ error: 'No active accounts' }, { status: 404 });
  }

  let totalTxns = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      // Sync balance
      try {
        const balance = await getAccountBalance(account.access_token, account.teller_account_id);
        const available = Math.round(parseFloat(balance.available || '0') * 100);
        const ledger = Math.round(parseFloat(balance.ledger || '0') * 100);
        db.prepare(`
          UPDATE bank_accounts SET balance_available_cents = ?, balance_ledger_cents = ?,
            balance_updated_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(available, ledger, account.id);
      } catch (balErr: any) {
        errors.push(`${account.account_name}: balance error - ${balErr.message}`);
      }

      // Sync transactions
      try {
        const txns = full
          ? await getAllAccountTransactions(account.access_token, account.teller_account_id)
          : await getAccountTransactions(account.access_token, account.teller_account_id, 200);

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
        errors.push(`${account.account_name}: transactions error - ${txnErr.message}`);
      }
    } catch (err: any) {
      errors.push(`${account.account_name}: ${err.message}`);
    }
  }

  return NextResponse.json({
    success: true,
    accounts_synced: accounts.length,
    transactions_imported: totalTxns,
    errors: errors.length > 0 ? errors : undefined,
  });
}
