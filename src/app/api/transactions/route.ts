import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Unified transaction feed: every bank + credit-card transaction in one
// stream. Merged duplicate accounts are excluded; each row carries its
// account identity. Cursor pagination by (date, id).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim().toLowerCase();
  const accountId = sp.get('accountId') || '';
  const kind = sp.get('kind') || 'all'; // all | bank | card
  const limit = Math.min(Number(sp.get('limit')) || 100, 500);
  const beforeDate = sp.get('beforeDate') || '';
  const beforeId = sp.get('beforeId') || '';

  const db = getDb();
  const where: string[] = ["a.status != 'merged'"];
  const params: any[] = [];
  if (accountId) { where.push('bt.bank_account_id = ?'); params.push(accountId); }
  if (kind === 'card') where.push("a.account_type = 'credit'");
  if (kind === 'bank') where.push("a.account_type != 'credit'");
  if (q) {
    // match description/counterparty/category, or exact dollar amount
    const asCents = Math.round(Math.abs(parseFloat(q)) * 100);
    if (!Number.isNaN(asCents) && /^[\d.,$-]+$/.test(q)) {
      where.push('ABS(bt.amount_cents) = ?');
      params.push(asCents);
    } else {
      where.push("(LOWER(bt.description) LIKE ? OR LOWER(COALESCE(bt.counterparty,'')) LIKE ? OR LOWER(COALESCE(bt.custom_category, bt.category, '')) LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
  }
  if (beforeDate && beforeId) {
    where.push('(bt.date < ? OR (bt.date = ? AND bt.id < ?))');
    params.push(beforeDate, beforeDate, beforeId);
  }

  // Reconciliation surfaced inline: each row carries its classification
  // verdict (category/store/method/confidence/evidence) and, when paired,
  // a summary of the OTHER leg — so "what's connected to what" is visible.
  const rows: any[] = db.prepare(`
    SELECT bt.id, bt.date, bt.description, bt.amount_cents, bt.status,
      bt.counterparty, bt.category, bt.custom_category,
      a.id AS account_id, a.institution_name, a.account_name, a.nickname, a.last_four, a.account_type,
      r.category AS cls_category, r.method AS cls_method, r.confidence AS cls_confidence,
      r.reason AS cls_reason, r.evidence_json, r.needs_review AS cls_needs_review,
      s.name AS store_name,
      pt.description AS pair_description, pt.date AS pair_date,
      pa.institution_name AS pair_institution, pa.last_four AS pair_last_four,
      pa.nickname AS pair_nickname, pa.account_name AS pair_account_name
    FROM bank_transactions bt
    JOIN bank_accounts a ON a.id = bt.bank_account_id
    LEFT JOIN classification_results r ON r.txn_id = bt.id
    LEFT JOIN stores s ON s.id = r.store_id
    LEFT JOIN bank_transactions pt ON pt.id = r.related_txn_id
    LEFT JOIN bank_accounts pa ON pa.id = pt.bank_account_id
    WHERE ${where.join(' AND ')}
    ORDER BY bt.date DESC, bt.id DESC
    LIMIT ?
  `).all(...params, limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  // Totals for the CURRENT FILTER (whole matching set, not just the page)
  const totals: any = db.prepare(`
    SELECT COUNT(*) n,
      COALESCE(SUM(CASE WHEN bt.amount_cents > 0 THEN bt.amount_cents END), 0) inflow_cents,
      COALESCE(SUM(CASE WHEN bt.amount_cents < 0 THEN bt.amount_cents END), 0) outflow_cents
    FROM bank_transactions bt
    JOIN bank_accounts a ON a.id = bt.bank_account_id
    WHERE ${where.filter(w => !w.startsWith('(bt.date <')).join(' AND ')}
  `).get(...params.slice(0, beforeDate && beforeId ? -3 : params.length));

  const accounts = db.prepare(`
    SELECT id, institution_name, account_name, nickname, last_four, account_type
    FROM bank_accounts WHERE status IN ('active','disconnected')
    ORDER BY account_type, institution_name, account_name
  `).all();

  return NextResponse.json({
    transactions: page,
    hasMore,
    nextCursor: hasMore ? { beforeDate: page[page.length - 1].date, beforeId: page[page.length - 1].id } : null,
    totals,
    accounts,
  });
}

// PATCH { transactionId, category } — manual categorization.
// The correction is recorded as FEEDBACK: it locks this transaction (MANUAL,
// automation can't override) and becomes a verified retrieval example that
// makes future classification smarter.
export async function PATCH(req: NextRequest) {
  const { transactionId, category } = await req.json().catch(() => ({}));
  if (!transactionId) return NextResponse.json({ error: 'transactionId required' }, { status: 400 });
  const db = getDb();
  const txn: any = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(transactionId);
  if (!txn) return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
  db.prepare('UPDATE bank_transactions SET custom_category = ? WHERE id = ?').run(category || null, transactionId);
  if (category) {
    const { ensureCategorizeSchema, recordFeedback, resolveMerchant } = await import('@/lib/categorize/merchants');
    ensureCategorizeSchema(db);
    const prior: any = db.prepare('SELECT category, method FROM classification_results WHERE txn_id = ?').get(transactionId);
    recordFeedback(db, {
      txnId: transactionId,
      predictedCategory: prior?.category ?? null,
      predictedMethod: prior?.method ?? null,
      correctedCategory: category,
      merchantName: resolveMerchant(db, txn.description || '')?.name,
      description: txn.description,
      amountCents: txn.amount_cents,
      accountId: txn.bank_account_id,
      actor: 'admin',
    });
  }
  return NextResponse.json({ success: true });
}
