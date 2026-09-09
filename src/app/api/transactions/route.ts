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
  try { db.exec('ALTER TABLE bank_transactions ADD COLUMN settled_at TEXT'); } catch { /* exists */ }
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
  // Reconciliation filters — every dimension of the verdict is filterable
  const status = sp.get('status') || 'all';
  if (status === 'categorized') where.push('r.category IS NOT NULL');
  if (status === 'suggested') where.push('r.category IS NULL AND r.suggested_category IS NOT NULL');
  if (status === 'uncategorized') where.push("(r.txn_id IS NULL OR (r.category IS NULL AND COALESCE(bt.custom_category, '') = ''))");
  if (status === 'review') where.push('r.needs_review = 1');
  if (status === 'paired') where.push('r.related_txn_id IS NOT NULL');
  const storeFilter = sp.get('store') || '';
  if (storeFilter === 'unattributed') where.push('r.store_id IS NULL');
  else if (storeFilter === 'paired') where.push('r.store_id IS NOT NULL');
  else if (storeFilter) { where.push('r.store_id = ?'); params.push(storeFilter); }
  const method = sp.get('method') || '';
  if (method) { where.push('r.method = ?'); params.push(method); }
  const paid = sp.get('paid') || '';
  if (paid === 'paid') where.push('bt.settled_at IS NOT NULL');
  if (paid === 'unpaid') where.push('bt.settled_at IS NULL');
  const conf = sp.get('conf') || '';
  if (conf === 'high') where.push('r.confidence >= 0.95');
  if (conf === 'mid') where.push('r.confidence >= 0.8 AND r.confidence < 0.95');
  if (conf === 'low') where.push('(r.txn_id IS NULL OR r.confidence < 0.8)');

  if (beforeDate && beforeId) {
    where.push('(bt.date < ? OR (bt.date = ? AND bt.id < ?))');
    params.push(beforeDate, beforeDate, beforeId);
  }

  // Reconciliation surfaced inline: each row carries its classification
  // verdict (category/store/method/confidence/evidence) and, when paired,
  // a summary of the OTHER leg — so "what's connected to what" is visible.
  const rows: any[] = db.prepare(`
    SELECT bt.id, bt.date, bt.description, bt.amount_cents, bt.status, bt.settled_at,
      bt.counterparty, bt.category, bt.custom_category,
      a.id AS account_id, a.institution_name, a.account_name, a.nickname, a.last_four, a.account_type,
      r.category AS cls_category, r.suggested_category, r.method AS cls_method, r.confidence AS cls_confidence,
      r.reason AS cls_reason, r.evidence_json, r.needs_review AS cls_needs_review,
      s.name AS store_name, ss.name AS suggested_store_name,
      pt.description AS pair_description, pt.date AS pair_date, pt.amount_cents AS pair_amount_cents,
      pa.institution_name AS pair_institution, pa.last_four AS pair_last_four,
      pa.nickname AS pair_nickname, pa.account_name AS pair_account_name
    FROM bank_transactions bt
    JOIN bank_accounts a ON a.id = bt.bank_account_id
    LEFT JOIN classification_results r ON r.txn_id = bt.id
    LEFT JOIN stores s ON s.id = r.store_id
    LEFT JOIN stores ss ON ss.id = r.suggested_store_id
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
    LEFT JOIN classification_results r ON r.txn_id = bt.id
    WHERE ${where.filter(w => !w.startsWith('(bt.date <')).join(' AND ')}
  `).get(...params.slice(0, beforeDate && beforeId ? -3 : params.length));

  const accounts = db.prepare(`
    SELECT id, institution_name, account_name, nickname, last_four, account_type
    FROM bank_accounts WHERE status IN ('active','disconnected')
    ORDER BY account_type, institution_name, account_name
  `).all();
  const stores = db.prepare('SELECT id, name FROM stores WHERE is_active = 1 OR is_active IS NULL ORDER BY name').all();

  // Global reconciliation coverage (not filter-scoped) — the progress numbers
  const coverage: any = db.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN r.store_id IS NOT NULL THEN 1 ELSE 0 END) attributed,
      SUM(CASE WHEN r.store_id IS NOT NULL THEN ABS(bt.amount_cents) ELSE 0 END) attributed_cents,
      SUM(CASE WHEN r.store_id IS NULL THEN ABS(bt.amount_cents) ELSE 0 END) unattributed_cents
    FROM bank_transactions bt
    JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.status != 'merged'
    LEFT JOIN classification_results r ON r.txn_id = bt.id`).get();

  return NextResponse.json({
    transactions: page,
    hasMore,
    nextCursor: hasMore ? { beforeDate: page[page.length - 1].date, beforeId: page[page.length - 1].id } : null,
    totals,
    accounts,
    stores,
    coverage,
  });
}

// PATCH { transactionId | transactionIds[], category } — manual categorization,
// single or BULK. Every row is recorded as FEEDBACK (locks as MANUAL,
// becomes verified learning). Bulk is capped and audited per-row — the UI
// shows count + dollar impact before applying (mass-action safety).
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.transactionIds)
    ? body.transactionIds
    : body.transactionId ? [body.transactionId] : [];
  const category = body.category;
  const storeId = body.storeId; // 'none' clears the manual pairing
  if (ids.length === 0) return NextResponse.json({ error: 'transactionId(s) required' }, { status: 400 });
  if (ids.length > 500) return NextResponse.json({ error: 'max 500 per bulk action' }, { status: 400 });

  const db = getDb();
  const { ensureCategorizeSchema, recordFeedback, resolveMerchant } = await import('@/lib/categorize/merchants');
  ensureCategorizeSchema(db);
  if (storeId !== undefined) {
    if (storeId !== 'none' && !db.prepare('SELECT id FROM stores WHERE id = ?').get(storeId)) {
      return NextResponse.json({ error: 'store not found' }, { status: 404 });
    }
    const { categorizeTransaction, saveResult } = await import('@/lib/categorize/engine');
    let paired = 0, totalCents = 0;
    for (const id of ids) {
      const txn: any = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
      if (!txn) continue;
      db.prepare('UPDATE bank_transactions SET custom_store_id = ? WHERE id = ?').run(storeId === 'none' ? null : storeId, id);
      const fresh: any = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
      const r = await categorizeTransaction(db, fresh, { allowLlm: false });
      saveResult(db, r);
      // MANUAL-category rows are upsert-protected — apply the store directly
      db.prepare("UPDATE classification_results SET store_id = ? WHERE txn_id = ? AND method = 'MANUAL'")
        .run(storeId === 'none' ? null : storeId, id);
      paired++; totalCents += Math.abs(txn.amount_cents || 0);
    }
    return NextResponse.json({ success: true, paired, total_cents: totalCents });
  }
  let updated = 0;
  let totalCents = 0;
  const apply = db.transaction(() => {
    for (const id of ids) {
      const txn: any = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
      if (!txn) continue;
      db.prepare('UPDATE bank_transactions SET custom_category = ? WHERE id = ?').run(category || null, id);
      if (category) {
        const prior: any = db.prepare('SELECT category, method FROM classification_results WHERE txn_id = ?').get(id);
        recordFeedback(db, {
          txnId: id,
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
      updated++;
      totalCents += Math.abs(txn.amount_cents || 0);
    }
  });
  apply();
  return NextResponse.json({ success: true, updated, total_cents: totalCents });
}
