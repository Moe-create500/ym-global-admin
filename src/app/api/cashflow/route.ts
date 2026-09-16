import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildCashflowProjection } from '@/lib/cashflow';
import { buildCashPosition } from '@/lib/cash-position';

export const dynamic = 'force-dynamic';

// A view must never wait on Shopify. If a connected store's payments sync is
// stale (>10 min) we kick a refresh in the background and answer from what we
// have; the next load (or the page's own refresh) shows the fresh state.
const syncing = new Set<string>();
function refreshStaleInBackground(db: any, storeId?: string) {
  import('@/lib/shopify-sync').then(({ ensureShopifyCredsTable, syncShopifyPayments }) => {
    ensureShopifyCredsTable(db);
    const connected: any[] = db.prepare(`SELECT store_id, last_synced_at FROM shopify_credentials ${storeId ? 'WHERE store_id = ?' : ''}`).all(...(storeId ? [storeId] : []));
    for (const c of connected) {
      const ageMin = c.last_synced_at ? (Date.now() - new Date(String(c.last_synced_at).replace(' ', 'T') + 'Z').getTime()) / 60000 : Infinity;
      if (ageMin <= 10 || syncing.has(c.store_id)) continue;
      syncing.add(c.store_id);
      syncShopifyPayments(db, c.store_id, Date.now()).catch((e: any) => console.warn('[cashflow] background sync failed:', c.store_id, e?.message)).finally(() => syncing.delete(c.store_id));
    }
  }).catch(e => console.warn('[cashflow] background sync skipped:', e?.message));
}

// GET /api/cashflow?storeId=...&horizon=14 → position (scope-correct) + dated landing projection
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId') || undefined;
  const horizon = Math.min(30, Math.max(7, parseInt(req.nextUrl.searchParams.get('horizon') || '14', 10) || 14));
  try {
    const db = getDb();
    const t0 = Date.now();
    refreshStaleInBackground(db, storeId);
    // Two passes: the projection measures ad burn; the position needs it; the calendar needs the position's cash + obligations.
    const probe = buildCashPosition(db, storeId, 0);           // resolves the scope (a non-Shopify store falls back to all Shopify stores)
    const effective = probe.scope.storeId || undefined;
    const first = buildCashflowProjection(db, effective, horizon);
    const position = buildCashPosition(db, effective, first.position.ad_burn_daily_cents, first.generated_at_date);
    if (probe.scope.note) position.scope.note = probe.scope.note;
    const projection = buildCashflowProjection(db, effective, horizon, { cashAvailableCents: position.cash.cents, obligationsCents: position.obligations.totalCents - position.obligations.adBurn7d.cents! });
    return NextResponse.json({ projection, position, syncing: [...syncing], took_ms: Date.now() - t0 }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'CDN-Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    console.error('[cashflow]', err?.message || err);
    return NextResponse.json({ error: err?.message || 'projection failed' }, { status: 500 });
  }
}
