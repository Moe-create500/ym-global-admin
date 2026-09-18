import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { classifyRow, setRowClass, SS_LINE_LABEL, SS_CENTER_LABEL } from '@/lib/cfo/ss-costs';
import { merchantKey } from '@/lib/subscriptions/normalize';
import { logChargePayment, paymentsForCharges, deleteChargePayment } from '@/lib/charge-payments';

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
    SELECT bt.id, bt.date, bt.description, bt.amount_cents, bt.settled_at, bt.custom_category,
      COALESCE(a.nickname, a.account_name) || ' ····' || a.last_four AS card, a.id AS card_id, a.last_four AS card_last4,
      r.method, r.category, r.confidence, r.evidence_json
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
    ORDER BY bt.date DESC, bt.id DESC LIMIT 5000`).all(storeId);
  for (const c of charges) c.merchant = merchantKey(c.description)?.key || null;
  // Which logged payment (if any) paid each charge off.
  const paidBy = paymentsForCharges(db, charges.map(c => c.id));
  for (const c of charges) { const p = paidBy.get(c.id); if (p) c.paid_by = p; }
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
// PATCH — one charge (`txnId`) or many (`txnIds`):
//   { settled }                      mark paid / unpaid
//   { line, center, remember }       classify for the ShipSourced P&L (remember = rule for the merchant)
// Moving a charge to another store stays on /api/transactions (same pairing rules as the Transactions page).
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.txnIds) ? body.txnIds.map(String) : body.txnId ? [String(body.txnId)] : [];
  if (!ids.length || ids.length > 2000) return NextResponse.json({ error: 'txnId or txnIds (≤2000) required' }, { status: 400 });
  const db = getDb();
  ensureSettlementSchema(db);
  if (body.line || body.center) {
    if (!(body.line in SS_LINE_LABEL) || !(body.center in SS_CENTER_LABEL)) return NextResponse.json({ error: 'bad line/center' }, { status: 400 });
    const get = db.prepare('SELECT description FROM bank_transactions WHERE id = ?');
    let changed = 0; const rules = new Set<string>();
    const run = db.transaction(() => {
      for (const id of ids) {
        const row: any = get.get(id); if (!row) continue;
        const r = setRowClass(db, id, body.line, body.center, body.actor || 'admin', !!body.remember, row.description);
        changed++; if (r.ruleKey) rules.add(r.ruleKey);
      }
    });
    run();
    if (!changed) return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
    return NextResponse.json({ ok: true, changed, rules: [...rules] });
  }
  // { txnIds, payment: {...} } — record the payment that pays these charges off.
  // Ad spend and app invoices have their own logs; this is every OTHER card
  // charge (software, supplies, Whop…), which had nowhere to record a payment.
  if (body.payment) {
    const p = body.payment;
    try {
      const store: any = db.prepare('SELECT id FROM stores WHERE id = ?').get(p.storeId);
      if (!store) return NextResponse.json({ error: 'unknown store' }, { status: 400 });
      const r = logChargePayment(db, {
        storeId: p.storeId, cardLast4: String(p.cardLast4 || '').trim(), date: String(p.date || '').slice(0, 10),
        amountCents: Math.round(Number(p.amountCents)), txnIds: ids,
        method: p.method || null, notes: p.notes || null, actor: body.actor || 'admin',
      });
      return NextResponse.json({ success: true, ...r });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'could not record the payment' }, { status: 400 });
    }
  }

  if (typeof body.settled !== 'boolean') return NextResponse.json({ error: 'settled, line/center or payment required' }, { status: 400 });
  const upd = db.prepare('UPDATE bank_transactions SET settled_at = ? WHERE id = ?');
  const at = body.settled ? new Date().toISOString() : null;
  let changed = 0;
  db.transaction(() => { for (const id of ids) changed += upd.run(at, id).changes; })();
  if (!changed) return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
  return NextResponse.json({ success: true, changed });
}

// DELETE ?paymentId= — undo a logged charge payment; its charges go back to unpaid.
export async function DELETE(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get('paymentId');
  if (!paymentId) return NextResponse.json({ error: 'paymentId required' }, { status: 400 });
  const db = getDb();
  const r = deleteChargePayment(db, paymentId);
  if (!r.deleted) return NextResponse.json({ error: 'payment not found' }, { status: 404 });
  return NextResponse.json({ success: true, ...r });
}
