import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function ensureSettlementSchema(db: any) {
  // Settlement is manual business state on the SOURCE row — survives every
  // categorizer re-run (classification_results is a rebuildable projection).
  try { db.exec('ALTER TABLE bank_transactions ADD COLUMN settled_at TEXT'); } catch { /* exists */ }
}

// GET ?storeId= — card charges attributed to this store (proven evidence),
// newest first, each with its individual settled state.
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  const db = getDb();
  ensureSettlementSchema(db);
  const charges: any[] = db.prepare(`
    SELECT bt.id, bt.date, bt.description, bt.amount_cents, bt.settled_at,
      COALESCE(a.nickname, a.account_name) || ' ····' || a.last_four AS card,
      r.method, r.evidence_json
    FROM bank_transactions bt
    JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.account_type = 'credit' AND a.status = 'active'
    JOIN classification_results r ON r.txn_id = bt.id AND r.store_id = ?
    WHERE bt.amount_cents < 0
      AND COALESCE(r.category, '') NOT IN ('Credit Card Payment', 'Transfer Out', 'Transfer In')
    ORDER BY bt.date DESC, bt.id DESC LIMIT 500`).all(storeId);
  const openCents = charges.filter(c => !c.settled_at).reduce((s, c) => s + Math.abs(c.amount_cents), 0);
  const settledCents = charges.filter(c => c.settled_at).reduce((s, c) => s + Math.abs(c.amount_cents), 0);
  return NextResponse.json({
    charges,
    summary: { count: charges.length, open_cents: openCents, settled_cents: settledCents },
  });
}

// PATCH { txnId, settled } — mark one charge individually paid/unpaid.
export async function PATCH(req: NextRequest) {
  const { txnId, settled } = await req.json().catch(() => ({}));
  if (!txnId) return NextResponse.json({ error: 'txnId required' }, { status: 400 });
  const db = getDb();
  ensureSettlementSchema(db);
  const r = db.prepare("UPDATE bank_transactions SET settled_at = ? WHERE id = ?")
    .run(settled ? new Date().toISOString() : null, txnId);
  if (r.changes === 0) return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
