import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStaleStores, syncStore, syncFacebookAds, acquireSyncLock, releaseSyncLock } from '@/lib/sync';
import { pullNewOrders } from '@/lib/order-pull';
import { refreshOrderStatuses } from '@/lib/order-status-refresh';
import { getDisputes } from '@/lib/chargeflow';
import { rollUpChargebacks } from '@/lib/chargeback-rollup';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Pull new ShipSourced orders incrementally for a store


// Update fulfillment statuses for orders still marked as unfulfilled.
// Delegates to the bounded status-refresh (open+cancelled sets, capped pages) —
// the old implementation paged the client's ENTIRE order history into memory
// via getAllClientOrdersList, a prime OOM suspect on this 2GB box.
async function updateUnfulfilledStatuses(storeId: string, clientId: string) {
  const db = getDb();
  const r = await refreshOrderStatuses(db, storeId, clientId);
  return { updated: r.fulfilled + r.cancelled + r.reopened };
}

// Called by the dashboard on load to sync stale stores + Facebook ads
export async function POST() {
  // Two dashboard tabs opening at once (or a tab during the 30-min tick) must
  // not stack full pipelines — skip quietly, data is at most minutes stale.
  if (!acquireSyncLock('dashboard-auto')) {
    return NextResponse.json({ synced: false, message: 'Sync already in progress' });
  }
  try {
  const stale = getStaleStores(60); // stores not synced in last 60 minutes

  const results = [];
  for (const store of stale) {
    const result = await syncStore(store.id);
    results.push(result);
  }

  // Pull new ShipSourced orders for ALL active stores (fast — incremental)
  const db = getDb();
  const activeStores: any[] = db.prepare(
    'SELECT id, shipsourced_client_id FROM stores WHERE is_active = 1 AND shipsourced_client_id IS NOT NULL'
  ).all();

  let totalPulled = 0;
  let totalStatusUpdated = 0;
  for (const s of activeStores) {
    try {
      const pullResult = await pullNewOrders(s.id, s.shipsourced_client_id);
      totalPulled += pullResult.imported;
    } catch {}
    try {
      const statusResult = await updateUnfulfilledStatuses(s.id, s.shipsourced_client_id);
      totalStatusUpdated += statusResult.updated;
    } catch {}
  }

  // Sync Chargeflow disputes for stores with API keys
  const cfStores: any[] = db.prepare(
    'SELECT id, name, chargeflow_api_key FROM stores WHERE is_active = 1 AND chargeflow_api_key IS NOT NULL'
  ).all();

  let cfImported = 0;
  for (const s of cfStores) {
    try {
      // Pull recent pages only (first 5 pages = 500 disputes) for regular syncs
      // New disputes appear on page 1, so this catches all recent activity
      const maxPages = 5;
      let page = 1;
      let storeImported = 0;

      while (page <= maxPages) {
        const data = await getDisputes(s.chargeflow_api_key, page, 100);
        if (!data.disputes || data.disputes.length === 0) break;

        let allKnown = true;
        for (const d of data.disputes) {
          const chargebackDate = d.created_at.substring(0, 10);
          const amountCents = Math.round(d.amount * 100);
          const status = d.status === 'won' ? 'won' : d.status === 'lost' ? 'lost' : 'open';

          const existing: any = db.prepare(
            'SELECT id, status FROM chargebacks WHERE store_id = ? AND dispute_id = ?'
          ).get(s.id, d.id);

          if (existing) {
            if (existing.status !== status) {
              db.prepare('UPDATE chargebacks SET status = ?, amount_cents = ?, reason = ?, updated_at = datetime(\'now\') WHERE id = ?')
                .run(status, amountCents, d.reason || null, existing.id);
              storeImported++;
              allKnown = false;
            }
          } else {
            db.prepare(`
              INSERT INTO chargebacks (id, store_id, dispute_id, order_number, chargeback_date, amount_cents, reason, status, source, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'chargeflow', ?)
            `).run(crypto.randomUUID(), s.id, d.id, d.order || null, chargebackDate, amountCents, d.reason || null, status, d.stage || null);
            storeImported++;
            allKnown = false;
          }
        }

        // Stop early if all disputes on this page were already known
        if (allKnown) break;
        if (data.disputes.length < 100) break;
        page++;
      }

      cfImported += storeImported;

      // Rollup lost chargebacks into P&L (shared scoped rollup — the inline
      // copy this replaces reset every row and omitted COGS from net profit)
      if (storeImported > 0) {
        rollUpChargebacks(db, s.id);
      }

      console.log(`[chargeflow] ${s.name}: ${storeImported} imported/updated`);
    } catch (cfErr: any) {
      console.error(`[chargeflow] ${s.name}: ${cfErr.message}`);
    }
  }

  // Also sync Facebook ad spend for any profiles not synced in last 60 minutes
  const fbResult = await syncFacebookAds(60);

  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const anythingSynced = stale.length > 0 || fbResult.synced > 0 || totalPulled > 0 || cfImported > 0 || totalStatusUpdated > 0;

  if (!anythingSynced) {
    return NextResponse.json({ synced: false, message: 'All stores up to date' });
  }

  return NextResponse.json({
    synced: true,
    staleStores: stale.length,
    recordsSynced: totalSynced,
    ordersPulled: totalPulled,
    ordersStatusUpdated: totalStatusUpdated,
    chargeflowSynced: cfImported,
    fbAdsSynced: fbResult.synced,
    fbInvoicesImported: fbResult.invoicesImported,
    results,
  });
  } finally {
    releaseSyncLock();
  }
}
