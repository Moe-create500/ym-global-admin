import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureShopifyCredsTable, syncShopifyPayments } from '@/lib/shopify-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Single-flight guard — repeated clicks must not stack full payment syncs.
let running = false;

// POST /api/chargebacks/sync-shopify → pull disputes (via the full Shopify
// Payments sync) for every store connected on the Cashflow connections page.
export async function POST() {
  if (running) {
    return NextResponse.json({ error: 'Sync already running' }, { status: 409 });
  }
  running = true;
  try {
    const db = getDb();
    ensureShopifyCredsTable(db);
    const connected: any[] = db.prepare('SELECT store_id FROM shopify_credentials').all();
    const results: any[] = [];
    for (const c of connected) {
      try {
        const s = await syncShopifyPayments(db, c.store_id, Date.now());
        results.push({ store_id: c.store_id, disputes: s.disputes });
      } catch (e: any) {
        results.push({ store_id: c.store_id, error: (e?.message || String(e)).slice(0, 200) });
      }
    }
    return NextResponse.json({ success: true, stores: results.length, results });
  } finally {
    running = false;
  }
}
