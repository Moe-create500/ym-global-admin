import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureShopifyCredsTable, saveShopifyCreds, getCreds, probeStore, normalizeShopDomain } from '@/lib/shopify-sync';

export const dynamic = 'force-dynamic';

// GET /api/shopify/credentials → which stores have creds (masked, never returns the secret)
export async function GET() {
  const db = getDb();
  ensureShopifyCredsTable(db);
  const rows = db.prepare(
    'SELECT store_id, shop_domain, last_synced_at, last_sync_note, updated_at FROM shopify_credentials'
  ).all();
  return NextResponse.json({ credentials: rows });
}

// POST /api/shopify/credentials { storeId, shopDomain, clientId, clientSecret }
// Saves creds, then live-probes the store to confirm the token mints and payments scope is granted.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { storeId, shopDomain, clientId, clientSecret } = body || {};
  if (!storeId || !shopDomain || !clientId || !clientSecret) {
    return NextResponse.json({ error: 'storeId, shopDomain, clientId, clientSecret all required' }, { status: 400 });
  }

  const db = getDb();
  saveShopifyCreds(db, storeId, shopDomain, clientId, clientSecret);

  try {
    const probe = await probeStore(db, storeId, Date.now());
    return NextResponse.json({
      success: true,
      shop_domain: normalizeShopDomain(shopDomain),
      probe,
      warning: probe.payouts_visible ? null : 'Token works, but payouts are not visible — add the read_shopify_payments_payouts scope to the custom app.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Saved, but the live check failed: ${err?.message || err}` }, { status: 502 });
  }
}

// DELETE /api/shopify/credentials?storeId=... → revoke stored creds
export async function DELETE(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  const db = getDb();
  ensureShopifyCredsTable(db);
  db.prepare('DELETE FROM shopify_credentials WHERE store_id = ?').run(storeId);
  return NextResponse.json({ success: true });
}
