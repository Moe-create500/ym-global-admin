import { NextRequest, NextResponse } from 'next/server';
import { syncAllStores, syncFacebookAds, acquireSyncLock, releaseSyncLock, activeSyncLock } from '@/lib/sync';
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
            balance_updated_at = datetime('now'), updated_at = datetime('now'), last_sync_error = NULL
          WHERE id = ?
        `).run(...params);
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

  return { accounts_synced: accounts.length, transactions_imported: totalTxns, errors };
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');

  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Never stack on top of the 30-min tick or another manual run — concurrent
  // full syncs double peak memory (the OOM pattern) and hammer external APIs.
  if (!acquireSyncLock('cron-route')) {
    return NextResponse.json({ skipped: true, reason: `sync "${activeSyncLock()}" already running` }, { status: 409 });
  }
  try {

  const { results, logId } = await syncAllStores();
  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const errors = results.filter(r => r.error);

  // Also sync Facebook ad spend for all active profiles
  const fbResult = await syncFacebookAds();

  // Sync bank accounts + credit cards (Teller)
  const bankResult = await syncBankAccounts();

  // Shopify Payments (payouts + balance txns + disputes) for every connected store.
  // Tokens auto-re-mint via client_credentials when the cached 24h token expires.
  const shopifyPayments: any[] = [];
  try {
    const { getDb } = await import('@/lib/db');
    const { ensureShopifyCredsTable, syncShopifyPayments } = await import('@/lib/shopify-sync');
    const db = getDb();
    ensureShopifyCredsTable(db);
    const connected: any[] = db.prepare('SELECT store_id FROM shopify_credentials').all();
    for (const c of connected) {
      try {
        const s = await syncShopifyPayments(db, c.store_id, Date.now());
        shopifyPayments.push({ store_id: c.store_id, note: s.note });
      } catch (e: any) {
        shopifyPayments.push({ store_id: c.store_id, error: (e?.message || String(e)).slice(0, 200) });
      }
    }
  } catch (e: any) {
    shopifyPayments.push({ error: (e?.message || String(e)).slice(0, 200) });
  }

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
    shopifyPayments: shopifyPayments.length > 0 ? shopifyPayments : undefined,
    logId,
  });

  } finally {
    releaseSyncLock();
  }
}
