import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureReconcileTable, reconcileSnapshot, reconcile, saveReconciliation } from '@/lib/cfo-reconcile';

export const dynamic = 'force-dynamic';

// POST /api/cfo/reconcile  → backfill: reconcile every consecutive snapshot pair for every store.
export async function POST() {
  const db = getDb();
  ensureReconcileTable(db);

  const stores: any[] = db.prepare('SELECT DISTINCT store_id FROM cfo_snapshots').all();
  let pairs = 0;
  let flagged = 0;
  const perStore: Record<string, { pairs: number; flagged: number }> = {};

  for (const { store_id } of stores) {
    const snaps: any[] = db.prepare(
      'SELECT id, store_id, snapshot_date, equity_cents, data, created_at FROM cfo_snapshots WHERE store_id = ? ORDER BY created_at ASC'
    ).all(store_id);
    perStore[store_id] = { pairs: 0, flagged: 0 };
    for (let i = 1; i < snaps.length; i++) {
      const result = reconcile(db, store_id, snaps[i - 1], snaps[i]);
      if (result.status === 'insufficient_data') continue;
      saveReconciliation(db, result);
      pairs++;
      perStore[store_id].pairs++;
      if (result.status === 'flagged') { flagged++; perStore[store_id].flagged++; }
    }
  }

  return NextResponse.json({ success: true, stores: stores.length, pairs, flagged, perStore });
}

// GET /api/cfo/reconcile?storeId=...  → latest reconciliation + history for a store.
// GET /api/cfo/reconcile?storeId=...&recompute=1 → re-run against the latest snapshot first.
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const recompute = req.nextUrl.searchParams.get('recompute') === '1';
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  ensureReconcileTable(db);

  if (recompute) {
    const latest: any = db.prepare(
      'SELECT id FROM cfo_snapshots WHERE store_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(storeId);
    if (latest) {
      try { reconcileSnapshot(db, storeId, latest.id); } catch {}
    }
  }

  const rows: any[] = db.prepare(`
    SELECT id, period_start, period_end, delta_equity_cents, net_income_cents, gap_cents,
           explained_cents, residual_cents, tolerance_cents, status, result, created_at
    FROM cfo_reconciliations
    WHERE store_id = ?
    ORDER BY period_end DESC, created_at DESC
    LIMIT 30
  `).all(storeId);

  const history = rows.map(r => ({
    id: r.id,
    period_start: r.period_start,
    period_end: r.period_end,
    delta_equity_cents: r.delta_equity_cents,
    net_income_cents: r.net_income_cents,
    gap_cents: r.gap_cents,
    explained_cents: r.explained_cents,
    residual_cents: r.residual_cents,
    tolerance_cents: r.tolerance_cents,
    status: r.status,
    created_at: r.created_at,
  }));

  let latest = null;
  if (rows.length > 0 && rows[0].result) {
    try { latest = JSON.parse(rows[0].result); } catch {}
  }

  return NextResponse.json({ latest, history });
}
