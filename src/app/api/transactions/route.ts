import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  ensureTxnIntelTables, runTransactionScan,
  getLedger, getCardIntel, getPaymentsView, getSummary, getCardClarity, getTruth,
} from '@/lib/transactions-intel';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  ensureTxnIntelTables(db);
  const sp = req.nextUrl.searchParams;
  const view = sp.get('view') || 'summary';
  const days = Number(sp.get('days')) || undefined;

  if (view === 'summary') {
    const stores = db.prepare('SELECT id, name FROM stores ORDER BY name').all();
    const accounts = db.prepare(`SELECT id, institution_name, account_name, account_type, last_four FROM bank_accounts WHERE status = 'active' ORDER BY account_type, institution_name`).all();
    return NextResponse.json({ ...getSummary(db), stores, accounts });
  }
  if (view === 'cards') return NextResponse.json({ cards: getCardIntel(db, days || 30), clarity: getCardClarity(db) });
  if (view === 'truth') return NextResponse.json(getTruth(db, days || 90));
  if (view === 'payments') return NextResponse.json({ payments: getPaymentsView(db, days || 60) });
  if (view === 'ledger') {
    return NextResponse.json(getLedger(db, {
      accountId: sp.get('accountId') || undefined,
      storeId: sp.get('storeId') || undefined,
      cls: sp.get('class') || undefined,
      q: sp.get('q') || undefined,
      unattributed: sp.get('unattributed') === '1',
      days,
      limit: Number(sp.get('limit')) || undefined,
      offset: Number(sp.get('offset')) || undefined,
    }));
  }
  return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const b = await req.json().catch(() => ({}));
  if (b.action === 'scan') {
    const stats = runTransactionScan(db, { days: Number(b.days) || 365, force: !!b.force });
    return NextResponse.json({ success: true, stats });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// Manual attribution: assign store and/or class to a transaction.
export async function PATCH(req: NextRequest) {
  const db = getDb();
  ensureTxnIntelTables(db);
  const b = await req.json().catch(() => ({}));
  if (!b.txnId) return NextResponse.json({ error: 'txnId required' }, { status: 400 });
  const txn = db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(b.txnId);
  if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  const existing: any = db.prepare('SELECT class FROM txn_links WHERE txn_id = ?').get(b.txnId);
  db.prepare(`INSERT INTO txn_links (txn_id, class, store_id, store_source, confidence, updated_at)
    VALUES (?, ?, ?, 'manual', 'manual', datetime('now'))
    ON CONFLICT(txn_id) DO UPDATE SET
      store_id = excluded.store_id, store_source = 'manual',
      class = CASE WHEN ? IS NOT NULL THEN ? ELSE txn_links.class END,
      confidence = 'manual', updated_at = datetime('now')`)
    .run(b.txnId, b.class || existing?.class || 'other', b.storeId || null, b.class || null, b.class || null);
  return NextResponse.json({ success: true });
}
