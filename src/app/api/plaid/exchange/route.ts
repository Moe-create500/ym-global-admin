import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { exchangeAndImport, syncPlaidItems } from '@/lib/plaid';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST { publicToken, storeId? } → exchange + import accounts + first sync
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { publicToken } = body || {};
  if (!publicToken) return NextResponse.json({ error: 'publicToken required' }, { status: 400 });
  const db = getDb();
  const storeId = body.storeId
    || (db.prepare('SELECT id FROM stores ORDER BY name LIMIT 1').get() as any)?.id;
  if (!storeId) return NextResponse.json({ error: 'No stores exist' }, { status: 400 });

  try {
    const r = await exchangeAndImport(db, publicToken, storeId);
    // Backfill immediately so the UI shows fresh data right after connecting
    const sync = await syncPlaidItems(db);
    return NextResponse.json({ success: true, ...r, transactions_imported: sync.transactions_imported, sync_errors: sync.errors.length ? sync.errors : undefined });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 250) }, { status: 500 });
  }
}
