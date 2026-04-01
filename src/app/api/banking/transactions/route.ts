import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100');
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0');

  const db = getDb();

  const transactions = db.prepare(
    'SELECT * FROM bank_transactions WHERE bank_account_id = ? ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?'
  ).all(accountId, limit, offset);

  const total = db.prepare(
    'SELECT COUNT(*) as cnt FROM bank_transactions WHERE bank_account_id = ?'
  ).get(accountId) as any;

  const summary = db.prepare(`
    SELECT
      SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) as inflow_cents,
      SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END) as outflow_cents,
      COUNT(*) as total_count
    FROM bank_transactions WHERE bank_account_id = ?
  `).get(accountId) as any;

  // Category breakdown
  const categoryBreakdown = db.prepare(`
    SELECT COALESCE(custom_category, 'Uncategorized') as category,
      SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) as inflow_cents,
      SUM(CASE WHEN amount_cents < 0 THEN ABS(amount_cents) ELSE 0 END) as outflow_cents,
      COUNT(*) as count
    FROM bank_transactions WHERE bank_account_id = ?
    GROUP BY COALESCE(custom_category, 'Uncategorized')
    ORDER BY outflow_cents DESC
  `).all(accountId);

  return NextResponse.json({
    transactions,
    total: total?.cnt || 0,
    summary: {
      inflow_cents: summary?.inflow_cents || 0,
      outflow_cents: summary?.outflow_cents || 0,
      total_count: summary?.total_count || 0,
    },
    categoryBreakdown,
  });
}

// PATCH: Update transaction category
export async function PATCH(req: NextRequest) {
  const { transactionId, category, note } = await req.json();
  if (!transactionId) return NextResponse.json({ error: 'transactionId required' }, { status: 400 });

  const db = getDb();
  if (category !== undefined) {
    db.prepare('UPDATE bank_transactions SET custom_category = ? WHERE id = ?').run(category || null, transactionId);
  }
  if (note !== undefined) {
    db.prepare('UPDATE bank_transactions SET custom_note = ? WHERE id = ?').run(note || null, transactionId);
  }
  return NextResponse.json({ success: true });
}
