import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { analyzeReconciliation, ensureAiAnalysisTable } from '@/lib/ai-reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Fable 5 deep analysis can take minutes

// GET /api/cfo/reconcile/ai?storeId=...&reconciliationId=...  → saved analysis (if any)
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const reconciliationId = req.nextUrl.searchParams.get('reconciliationId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  ensureAiAnalysisTable(db);

  const row: any = reconciliationId
    ? db.prepare('SELECT * FROM cfo_ai_analyses WHERE reconciliation_id = ?').get(reconciliationId)
    : db.prepare('SELECT * FROM cfo_ai_analyses WHERE store_id = ? ORDER BY created_at DESC LIMIT 1').get(storeId);

  if (!row) return NextResponse.json({ analysis: null });
  return NextResponse.json({
    analysis: JSON.parse(row.analysis_json),
    model: row.model,
    created_at: row.created_at,
    reconciliation_id: row.reconciliation_id,
  });
}

// POST /api/cfo/reconcile/ai  { storeId, reconciliationId? }  → run the AI investigation
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { storeId, reconciliationId } = body;
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();

  let reconId = reconciliationId;
  if (!reconId) {
    const latest: any = db.prepare(
      'SELECT id FROM cfo_reconciliations WHERE store_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(storeId);
    if (!latest) return NextResponse.json({ error: 'No reconciliation found for store' }, { status: 404 });
    reconId = latest.id;
  }

  try {
    const analysis = await analyzeReconciliation(db, storeId, reconId);
    const saved: any = getDb().prepare('SELECT model FROM cfo_ai_analyses WHERE reconciliation_id = ?').get(reconId);
    return NextResponse.json({ success: true, analysis, reconciliation_id: reconId, model: saved?.model });
  } catch (err: any) {
    console.error('[ai-reconcile]', err?.message || err);
    return NextResponse.json({ error: err?.message || 'analysis failed' }, { status: 500 });
  }
}
