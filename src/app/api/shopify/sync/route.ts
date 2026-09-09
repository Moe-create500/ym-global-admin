import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { syncShopifyPayments, getCreds } from '@/lib/shopify-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/shopify/sync { storeId } → pull payouts + transactions + disputes + balance
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { storeId } = body || {};
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  if (!getCreds(db, storeId)) {
    return NextResponse.json({ error: 'No Shopify credentials saved for this store. Add them first.' }, { status: 400 });
  }

  try {
    const summary = await syncShopifyPayments(db, storeId, Date.now());
    return NextResponse.json({ success: true, summary });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'sync failed' }, { status: 502 });
  }
}
