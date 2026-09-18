import { NextRequest, NextResponse } from 'next/server';
import { syncAllStores, syncFacebookAds, acquireSyncLock, releaseSyncLock, activeSyncLock } from '@/lib/sync';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET || '';

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

  // Bank balances + transactions (Plaid). Teller was retired 2026-09-14 — it
  // stored credit-card charges with the opposite sign to every other account,
  // and its last live feed died in July.
  const bankResult = await (async () => {
    const { syncPlaidItems } = await import('@/lib/plaid');
    return syncPlaidItems(getDb());
  })();

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

  // Link each invoice to the card charge that paid it, now that ad payments,
  // Shopify invoices and card transactions are all current. Without this every
  // invoice reads "NO CARD CHARGE" even when the charge is sitting on the card.
  let chargeMatch: any = null;
  try {
    const { matchInvoicesToCharges } = await import('@/lib/charge-matching');
    chargeMatch = matchInvoicesToCharges(getDb(), { days: 60 });
  } catch (e: any) {
    chargeMatch = { error: (e?.message || String(e)).slice(0, 200) };
  }

  return NextResponse.json({
    success: true,
    synced: totalSynced,
    chargeMatch,
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
