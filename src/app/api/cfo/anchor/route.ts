import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { reconcileAnchor } from '@/lib/shopify-sync';

export const dynamic = 'force-dynamic';

// POST /api/cfo/anchor { storeId, balanceCents }
// Updates the Main (Shopify Balance) anchor THROUGH the reconciliation gate:
// conservation-checks the new balance against payouts + card debits since the old anchor,
// auto-flags payouts that haven't posted as in-transit exceptions, and reports any
// unexplained gap (unlogged withdrawal/deposit) instead of silently accepting drift.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { storeId, balanceCents } = body || {};
  if (!storeId || typeof balanceCents !== 'number') {
    return NextResponse.json({ error: 'storeId and balanceCents required' }, { status: 400 });
  }
  const db = getDb();
  const exists: any = db.prepare(
    "SELECT id FROM bank_accounts WHERE store_id = ? AND institution_name = 'Shopify Balance' AND status = 'active'"
  ).get(storeId);
  if (!exists) {
    return NextResponse.json({ error: 'No Shopify Balance account on this store — add it to the balance sheet first.' }, { status: 404 });
  }
  try {
    const result = await reconcileAnchor(db, storeId, Math.round(balanceCents), Date.now());
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'anchor reconciliation failed' }, { status: 502 });
  }
}
