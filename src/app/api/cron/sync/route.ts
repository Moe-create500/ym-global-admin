import { NextRequest, NextResponse } from 'next/server';
import { syncAllStores, syncFacebookAds } from '@/lib/sync';
import { getDb } from '@/lib/db';
import { getAccountBalance, getAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET || '';

async function syncBankAccounts() {
  const db = getDb();
  const accounts: any[] = db.prepare("SELECT * FROM bank_accounts WHERE status = 'active'").all();
  let totalTxns = 0;
  const errors: string[] = [];

  for (const account of accounts) {
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
            balance_updated_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(...params);
      } catch (balErr: any) {
        errors.push(`${account.account_name}: balance error - ${balErr.message}`);
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

  return { accounts_synced: accounts.length, transactions_imported: totalTxns, errors };
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');

  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { results, logId } = await syncAllStores();
  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const errors = results.filter(r => r.error);

  // Also sync Facebook ad spend for all active profiles
  const fbResult = await syncFacebookAds();

  // Sync bank accounts + credit cards (Teller)
  const bankResult = await syncBankAccounts();

  return NextResponse.json({
    success: true,
    synced: totalSynced,
    fbAdsSynced: fbResult.synced,
    fbInvoicesImported: fbResult.invoicesImported,
    bankAccountsSynced: bankResult.accounts_synced,
    bankTxnsImported: bankResult.transactions_imported,
    stores: results.length,
    errors: errors.length > 0 ? errors : undefined,
    fbErrors: fbResult.errors.length > 0 ? fbResult.errors : undefined,
    bankErrors: bankResult.errors.length > 0 ? bankResult.errors : undefined,
    logId,
  });
}
