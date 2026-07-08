import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildCashflowProjection } from '@/lib/cashflow';

export const dynamic = 'force-dynamic';

// GET /api/cashflow?storeId=...&horizon=14 → date-by-date landing projection + card obligations
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId') || undefined;
  const horizon = Math.min(30, Math.max(7, parseInt(req.nextUrl.searchParams.get('horizon') || '14', 10) || 14));
  try {
    const db = getDb();
    // Freshness on view: if a connected store's payments sync is >10 min old, re-sync it
    // right now so the calendar always reflects Shopify's CURRENT state — Shopify creates
    // payouts continuously (reserve releases etc.) and stale-by-minutes reads as "wrong".
    try {
      const { ensureShopifyCredsTable, syncShopifyPayments } = await import('@/lib/shopify-sync');
      ensureShopifyCredsTable(db);
      const connected: any[] = db.prepare(
        `SELECT store_id, last_synced_at FROM shopify_credentials ${storeId ? 'WHERE store_id = ?' : ''}`
      ).all(...(storeId ? [storeId] : []));
      for (const c of connected) {
        const ageMin = c.last_synced_at ? (Date.now() - new Date(String(c.last_synced_at).replace(' ', 'T') + 'Z').getTime()) / 60000 : Infinity;
        if (ageMin > 10) await syncShopifyPayments(db, c.store_id, Date.now());
      }
    } catch (e: any) { console.warn('[cashflow] freshness sync skipped:', e?.message); }

    const projection = buildCashflowProjection(db, storeId, horizon);
    return NextResponse.json({ projection }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'CDN-Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    console.error('[cashflow]', err?.message || err);
    return NextResponse.json({ error: err?.message || 'projection failed' }, { status: 500 });
  }
}
