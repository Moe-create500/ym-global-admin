import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureReconcileTable } from '@/lib/cfo-reconcile';

export const dynamic = 'force-dynamic';

// GET: Return most recent CFO snapshot for every store
export async function GET() {
  const db = getDb();

  const stores: any[] = db.prepare('SELECT id, name FROM stores ORDER BY name').all();

  // Get most recent snapshot per store using a subquery
  const snapshots: any[] = db.prepare(`
    SELECT s.id, s.store_id, s.snapshot_date, s.assets_cents, s.liabilities_cents, s.equity_cents, s.created_at, s.data
    FROM cfo_snapshots s
    INNER JOIN (
      SELECT store_id, MAX(created_at) as max_created
      FROM cfo_snapshots
      GROUP BY store_id
    ) latest ON s.store_id = latest.store_id AND s.created_at = latest.max_created
    ORDER BY s.snapshot_date DESC
  `).all();

  // Map store_id -> snapshot
  const snapshotMap: Record<string, any> = {};
  for (const snap of snapshots) {
    snapshotMap[snap.store_id] = snap;
  }

  // Also get the second-most-recent snapshot for each store (for change calculation)
  const prevSnapshots: any[] = db.prepare(`
    SELECT s.store_id, s.equity_cents
    FROM cfo_snapshots s
    INNER JOIN (
      SELECT store_id, MAX(created_at) as max_created
      FROM cfo_snapshots
      WHERE (store_id, created_at) NOT IN (
        SELECT store_id, MAX(created_at) FROM cfo_snapshots GROUP BY store_id
      )
      GROUP BY store_id
    ) prev ON s.store_id = prev.store_id AND s.created_at = prev.max_created
  `).all();

  const prevMap: Record<string, number> = {};
  for (const p of prevSnapshots) {
    prevMap[p.store_id] = p.equity_cents;
  }

  // Latest reconciliation status per store (drift detection).
  ensureReconcileTable(db);
  const recons: any[] = db.prepare(`
    SELECT r.store_id, r.status, r.residual_cents, r.tolerance_cents, r.period_end
    FROM cfo_reconciliations r
    INNER JOIN (
      SELECT store_id, MAX(period_end) AS mpe FROM cfo_reconciliations GROUP BY store_id
    ) latest ON r.store_id = latest.store_id AND r.period_end = latest.mpe
  `).all();
  const reconMap: Record<string, any> = {};
  for (const r of recons) reconMap[r.store_id] = r;

  // Build result: all stores with their latest snapshot
  const storeData = stores.map(store => {
    const snap = snapshotMap[store.id];
    const prevEquity = prevMap[store.id];
    const recon = reconMap[store.id];
    return {
      store_id: store.id,
      store_name: store.name,
      has_snapshot: !!snap,
      snapshot_date: snap?.snapshot_date || null,
      assets_cents: snap?.assets_cents || 0,
      liabilities_cents: snap?.liabilities_cents || 0,
      equity_cents: snap?.equity_cents || 0,
      created_at: snap?.created_at || null,
      equity_change_cents: snap && prevEquity !== undefined ? snap.equity_cents - prevEquity : null,
      recon_status: recon?.status || null,
      recon_residual_cents: recon?.residual_cents ?? null,
    };
  });

  // Totals across all stores with snapshots
  const withSnaps = storeData.filter(s => s.has_snapshot);
  const totals = {
    total_assets_cents: withSnaps.reduce((s, d) => s + d.assets_cents, 0),
    total_liabilities_cents: withSnaps.reduce((s, d) => s + d.liabilities_cents, 0),
    total_equity_cents: withSnaps.reduce((s, d) => s + d.equity_cents, 0),
    store_count: withSnaps.length,
  };

  return NextResponse.json({ stores: storeData, totals });
}
