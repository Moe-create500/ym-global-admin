import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { classifyRow, setRowClass, SS_LINE_LABEL, SS_CENTER_LABEL } from '@/lib/cfo/ss-costs';

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
      -- Charges already represented by the invoice systems on the CFO sheet
      -- (Shopify app bills, FB invoices, Google invoices) are EXCLUDED —
      -- this section is only the store's OTHER card spend (software fees,
      -- one-off purchases) that nothing else accounts for.
      AND COALESCE(r.method, '') != 'INVOICE_MATCH'
      AND COALESCE(r.merchant_name, '') NOT IN ('Meta', 'Google Ads', 'Shopify')
      AND LOWER(bt.description) NOT LIKE '%shopify%'
      AND LOWER(bt.description) NOT LIKE '%facebk%'
      AND LOWER(bt.description) NOT LIKE '%facebook%'
      AND LOWER(bt.description) NOT LIKE '%google%'
    ORDER BY bt.date DESC, bt.id DESC LIMIT 500`).all(storeId);
  const openCents = charges.filter(c => !c.settled_at).reduce((s, c) => s + Math.abs(c.amount_cents), 0);
  const settledCents = charges.filter(c => c.settled_at).reduce((s, c) => s + Math.abs(c.amount_cents), 0);
  // ShipSourced's own charges also carry a fulfilment line × centre so the
  // 3PL P&L can be built from them (defaults from merchant rules, worker
  // overrides remembered per merchant).
  const store: any = db.prepare('SELECT name FROM stores WHERE id = ?').get(storeId);
  const isSs = store?.name === 'ShipSourced';
  const byLine: Record<string, number> = {};
  for (const c of charges) {
    if (!isSs) continue;
    const k = classifyRow(db, c.id, c.description);
    c.fulfilment = { ...k, lineLabel: SS_LINE_LABEL[k.line], centerLabel: SS_CENTER_LABEL[k.center] };
    if (!c.settled_at && k.line !== 'movement') byLine[k.line] = (byLine[k.line] || 0) + Math.abs(c.amount_cents);
  }
  return NextResponse.json({
    charges,
    summary: { count: charges.length, open_cents: openCents, settled_cents: settledCents, by_line: isSs ? byLine : null },
    fulfilment: isSs ? { lines: SS_LINE_LABEL, centers: SS_CENTER_LABEL } : null,
  });
}

// PATCH { txnId, settled } — mark one charge individually paid/unpaid.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { txnId, settled } = body;
  if (!txnId) return NextResponse.json({ error: 'txnId required' }, { status: 400 });
  const db = getDb();
  ensureSettlementSchema(db);
  // { txnId, line, center, remember } — classify a ShipSourced charge for the 3PL P&L
  if (body.line || body.center) {
    if (!(body.line in SS_LINE_LABEL) || !(body.center in SS_CENTER_LABEL)) return NextResponse.json({ error: 'bad line/center' }, { status: 400 });
    const row: any = db.prepare('SELECT description FROM bank_transactions WHERE id = ?').get(txnId);
    if (!row) return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
    return NextResponse.json(setRowClass(db, txnId, body.line, body.center, body.actor || 'admin', !!body.remember, row.description));
  }
  const r = db.prepare("UPDATE bank_transactions SET settled_at = ? WHERE id = ?")
    .run(settled ? new Date().toISOString() : null, txnId);
  if (r.changes === 0) return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
