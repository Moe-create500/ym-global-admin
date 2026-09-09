import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { categorizeTransaction, saveResult } from '@/lib/categorize/engine';
import { ensureCategorizeSchema } from '@/lib/categorize/merchants';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST { days?, limit?, force?, allowLlm? } — batch-categorize recent
// transactions. Idempotent: MANUAL results are never overwritten; existing
// results are skipped unless force. Returns a method/confidence breakdown.
export async function POST(req: NextRequest) {
  const { days = 60, limit = 500, force = false, allowLlm = false } = await req.json().catch(() => ({}));
  const db = getDb();
  ensureCategorizeSchema(db);
  const txns: any[] = db.prepare(`
    SELECT bt.* FROM bank_transactions bt
    JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.status = 'active'
    ${force ? '' : 'LEFT JOIN classification_results r ON r.txn_id = bt.id'}
    WHERE bt.date > date('now', ?) ${force ? '' : 'AND r.txn_id IS NULL'}
    ORDER BY bt.date DESC LIMIT ?`).all(`-${Math.min(days, 400)} days`, Math.min(limit, 2000));

  const byMethod: Record<string, number> = {};
  let reviewCount = 0;
  for (const t of txns) {
    const r = await categorizeTransaction(db, t, { allowLlm });
    saveResult(db, r);
    byMethod[r.method] = (byMethod[r.method] || 0) + 1;
    if (r.needs_review) reviewCount++;
  }
  return NextResponse.json({ processed: txns.length, by_method: byMethod, needs_review: reviewCount });
}

// GET ?review=1 — the review queue: abstentions + low-confidence results with
// full evidence so a human can verify in seconds.
export async function GET(req: NextRequest) {
  const db = getDb();
  ensureCategorizeSchema(db);
  if (req.nextUrl.searchParams.get('review')) {
    const rows: any[] = db.prepare(`
      SELECT r.*, bt.date, bt.description, bt.amount_cents, a.institution_name, a.last_four, a.nickname, a.account_name
      FROM classification_results r
      JOIN bank_transactions bt ON bt.id = r.txn_id
      JOIN bank_accounts a ON a.id = bt.bank_account_id
      WHERE r.needs_review = 1 ORDER BY ABS(bt.amount_cents) DESC LIMIT 200`).all();
    return NextResponse.json({ queue: rows.map(r => ({ ...r, evidence: JSON.parse(r.evidence_json || '[]') })) });
  }
  // metrics: is the categorizer getting smarter?
  const stats: any[] = db.prepare(`
    SELECT method, COUNT(*) n, ROUND(AVG(confidence), 3) avg_conf, SUM(needs_review) review_n
    FROM classification_results GROUP BY method ORDER BY n DESC`).all();
  const ai: any = db.prepare('SELECT COUNT(*) calls, COALESCE(SUM(input_tokens),0) in_tok, COALESCE(SUM(output_tokens),0) out_tok, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) failures FROM ai_calls').get();
  return NextResponse.json({ methods: stats, ai });
}
