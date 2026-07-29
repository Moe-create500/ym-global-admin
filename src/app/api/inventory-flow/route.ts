import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getClientInventory, SSInventoryProduct } from '@/lib/shipsourced';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ── Inventory Flow — how much stock to buy to stay in stock ─────────────────
// Per SKU: demand velocity (blend of 7d and 30d rates, recent-weighted),
// days of stock left, and the buy quantity that covers the restock lead time
// plus the coverage target:
//   buy = ceil(velocity × (lead_days + cover_days) − stock − inbound)
// Lead/cover are per-store settings, editable on the page.

function ensureSettings(db: any) {
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_flow_settings (
    store_id TEXT PRIMARY KEY,
    lead_days INTEGER NOT NULL DEFAULT 21,
    cover_days INTEGER NOT NULL DEFAULT 30,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
}

function classify(row: { stock: number; inbound: number; velocity: number; daysLeft: number | null; leadDays: number }): string {
  if (row.velocity <= 0) return row.stock > 0 ? 'dead' : 'inactive';
  if (row.stock <= 0 && row.inbound <= 0) return 'out';
  if (row.daysLeft != null && row.daysLeft < row.leadDays) return 'critical';   // stockout before a reorder could arrive
  if (row.daysLeft != null && row.daysLeft < row.leadDays + 14) return 'reorder';
  if (row.daysLeft != null && row.daysLeft > 120) return 'overstocked';
  return 'ok';
}

export async function GET(req: NextRequest) {
  const db = getDb();
  ensureSettings(db);
  const storeIdParam = req.nextUrl.searchParams.get('storeId');

  const stores: any[] = db.prepare(
    `SELECT id, name, shipsourced_client_id, shipsourced_extra_client_ids FROM stores
     WHERE is_active = 1 AND shipsourced_client_id IS NOT NULL AND shipsourced_client_id != ''
     ${storeIdParam ? 'AND id = ?' : ''} ORDER BY name`
  ).all(...(storeIdParam ? [storeIdParam] : []));

  const results: any[] = [];
  for (const store of stores) {
    const settings: any = db.prepare('SELECT lead_days, cover_days FROM inventory_flow_settings WHERE store_id = ?').get(store.id)
      || { lead_days: 21, cover_days: 30 };
    const leadDays = settings.lead_days;
    const coverDays = settings.cover_days;

    // Primary + extra client ids, merged per sku
    const clientIds: string[] = [store.shipsourced_client_id];
    try {
      const extras = JSON.parse(store.shipsourced_extra_client_ids || '[]');
      if (Array.isArray(extras)) for (const id of extras) if (id && !clientIds.includes(id)) clientIds.push(id);
    } catch { /* extras optional */ }

    const merged = new Map<string, SSInventoryProduct>();
    let feedError: string | null = null;
    for (const cid of clientIds) {
      try {
        const feed = await getClientInventory(cid);
        for (const p of feed.products || []) {
          const ex = merged.get(p.sku);
          if (!ex) merged.set(p.sku, { ...p });
          else {
            ex.units7 += p.units7; ex.units30 += p.units30; ex.units180 += p.units180;
            ex.inboundUnits += p.inboundUnits;
            // stock is warehouse-global per sku — same number from both feeds, don't sum
          }
        }
      } catch (e: any) {
        feedError = String(e?.message || e).slice(0, 150);
      }
    }

    // Fee/service line items are not purchasable stock — keep them out of a
    // purchasing view entirely.
    const SERVICE_RE = /shipping protection|priority handling|skip the line|ships first|route package|order protection|insurance|tip\b|gift wrap/i;

    const skus = [...merged.values()]
      // ignore junk skus the warehouse has never heard of with almost no sales
      .filter(p => p.stockQty != null || p.units30 >= 3)
      .filter(p => !SERVICE_RE.test(p.name || ''))
      .map(p => {
        const v7 = p.units7 / 7;
        const v30 = p.units30 / 30;
        // Recent-weighted blend; if 7d is dead but 30d isn't, trust 30d (spiky ads)
        const velocity = v7 > 0 || v30 > 0 ? 0.6 * v7 + 0.4 * v30 : 0;
        const stock = p.stockQty ?? 0;
        const daysLeft = velocity > 0 ? (stock + p.inboundUnits) / velocity : null;
        const need = velocity * (leadDays + coverDays) - stock - p.inboundUnits;
        const packSize = p.packSize > 1 ? p.packSize : 1;
        const buyQty = need > 0 ? Math.ceil(need / packSize) * packSize : 0;
        const row = {
          sku: p.sku, name: p.name, imageUrl: p.imageUrl,
          stock, inbound: p.inboundUnits,
          homeWarehouse: p.homeWarehouse, unitCostCents: p.unitCostCents, packSize,
          units7: p.units7, units30: p.units30,
          velocityPerDay: Math.round(velocity * 100) / 100,
          daysLeft: daysLeft != null ? Math.round(daysLeft * 10) / 10 : null,
          buyQty,
          buyCostCents: p.unitCostCents > 0 ? buyQty * p.unitCostCents : null,
          leadDays,
          status: '',
        };
        row.status = classify({ stock, inbound: p.inboundUnits, velocity, daysLeft, leadDays });
        return row;
      })
      .filter(r => r.status !== 'inactive')
      .sort((a, b) => {
        const rank: Record<string, number> = { out: 0, critical: 1, reorder: 2, ok: 3, overstocked: 4, dead: 5 };
        return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9);
      });

    results.push({
      storeId: store.id, storeName: store.name,
      leadDays, coverDays, feedError, skus,
      totals: {
        skusToBuy: skus.filter(s => s.buyQty > 0).length,
        unitsToBuy: skus.reduce((s, r) => s + r.buyQty, 0),
        buyCostCents: skus.reduce((s, r) => s + (r.buyCostCents || 0), 0),
        outCount: skus.filter(s => s.status === 'out').length,
        criticalCount: skus.filter(s => s.status === 'critical').length,
      },
    });
  }

  return NextResponse.json({ stores: results });
}

// PATCH { storeId, leadDays?, coverDays? } → per-store replenishment settings
export async function PATCH(req: NextRequest) {
  const db = getDb();
  ensureSettings(db);
  const b = await req.json().catch(() => ({}));
  if (!b.storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  const lead = Math.min(Math.max(Number(b.leadDays) || 21, 1), 180);
  const cover = Math.min(Math.max(Number(b.coverDays) || 30, 7), 365);
  db.prepare(`INSERT INTO inventory_flow_settings (store_id, lead_days, cover_days, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(store_id) DO UPDATE SET lead_days = excluded.lead_days, cover_days = excluded.cover_days, updated_at = datetime('now')`)
    .run(b.storeId, lead, cover);
  return NextResponse.json({ success: true, leadDays: lead, coverDays: cover });
}
