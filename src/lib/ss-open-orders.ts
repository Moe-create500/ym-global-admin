import type DatabaseType from 'better-sqlite3';
import { getOpenOrders, type SSOpenOrdersResponse } from './shipsourced';

/** The unfulfilled-orders liability, priced by ShipSourced.
 *
 *  ShipSourced knows exactly which orders are open and what it will charge
 *  for them: the product cost is exact per line (unit cost × qty from its
 *  catalogue, zero when the client owns the goods), and the non-product part
 *  (label, pick/pack, China fee, manager fee) is the client's own average
 *  over its last 60 days of real billed charges. That replaces YM's old
 *  projection from historical averages. When the feed is unavailable the
 *  caller keeps the projection and says so — an unknown never reads as $0. */

export interface OpenOrdersEstimate {
  source: 'shipsourced';
  asOf: string;
  openCount: number;
  byStatus: Record<string, number>;
  productCostCents: number;          // exact, Σ per order
  productCostIncomplete: number;     // orders with a SKU whose cost ShipSourced doesn't have
  perOrderOtherCents: number;        // client's recent avg label + pick/pack + China fee + manager fee
  otherCents: number;                // openCount × perOrderOtherCents
  estimatedCents: number;
  recentCharges: number;
  recentAvgTotalCents: number;
  clientOwned: boolean;
  clients: { id: string; name: string; openCount: number; estimatedCents: number }[];
}

export function estimateFromFeed(feeds: SSOpenOrdersResponse[]): OpenOrdersEstimate {
  const out: OpenOrdersEstimate = { source: 'shipsourced', asOf: feeds[0]?.asOf || new Date().toISOString(), openCount: 0, byStatus: {}, productCostCents: 0, productCostIncomplete: 0, perOrderOtherCents: 0, otherCents: 0, estimatedCents: 0, recentCharges: 0, recentAvgTotalCents: 0, clientOwned: false, clients: [] };
  let otherWeighted = 0, weight = 0;
  for (const f of feeds) {
    const other = Math.max(0, f.recent.avgLabelCents + f.recent.avgPickPackCents + f.recent.avgChinaFeeCents + f.recent.avgManagerCents);
    const product = f.openOrders.reduce((s, o) => s + o.productCostCents, 0);
    const est = product + f.openCount * other;
    out.openCount += f.openCount;
    for (const [k, v] of Object.entries(f.byStatus)) out.byStatus[k] = (out.byStatus[k] || 0) + v;
    out.productCostCents += product;
    out.productCostIncomplete += f.openOrders.filter(o => !o.productCostComplete).length;
    out.otherCents += f.openCount * other;
    out.estimatedCents += est;
    out.recentCharges += f.recent.charges;
    otherWeighted += other * Math.max(1, f.openCount); weight += Math.max(1, f.openCount);
    out.recentAvgTotalCents = Math.max(out.recentAvgTotalCents, f.recent.avgTotalCents);
    out.clientOwned = out.clientOwned || f.client.productCostExempt;
    out.clients.push({ id: f.client.id, name: f.client.name, openCount: f.openCount, estimatedCents: est });
  }
  out.perOrderOtherCents = weight ? Math.round(otherWeighted / weight) : 0;
  return out;
}

/** All ShipSourced client ids a store bills through (primary + extras). */
export function storeClientIds(db: DatabaseType.Database, storeId: string): string[] {
  const s: any = db.prepare('SELECT shipsourced_client_id, shipsourced_extra_client_ids FROM stores WHERE id = ?').get(storeId);
  if (!s) return [];
  const ids = [s.shipsourced_client_id, ...String(s.shipsourced_extra_client_ids || '').split(',')].map(x => String(x || '').trim()).filter(Boolean);
  return [...new Set(ids)];
}

export async function fetchOpenOrdersEstimate(db: DatabaseType.Database, storeId: string): Promise<{ ok: true; estimate: OpenOrdersEstimate } | { ok: false; reason: string }> {
  const ids = storeClientIds(db, storeId);
  if (!ids.length) return { ok: false, reason: 'store has no ShipSourced client id' };
  if (!process.env.SHIPSOURCED_API_TOKEN) return { ok: false, reason: 'SHIPSOURCED_API_TOKEN not set' };
  try {
    const feeds = await Promise.all(ids.map(id => getOpenOrders(id)));
    return { ok: true, estimate: estimateFromFeed(feeds) };
  } catch (e: any) {
    const msg = String(e?.message || e);
    return { ok: false, reason: / 40[134]:|error 40[134]/.test(msg) ? 'ShipSourced does not serve this feed yet — the open-orders feed is on the PR branch, not deployed' : msg.slice(0, 140) };
  }
}
