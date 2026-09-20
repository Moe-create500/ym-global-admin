import type DatabaseType from 'better-sqlite3';

/** What the orders you still owe fulfilment on will cost.
 *
 *  This used to come from ShipSourced's open-orders feed, which has never been
 *  deployed, so it fell back to YM's own `orders` table — and that table has
 *  been frozen since 2026-08-31, when ShipSourced locked `/api/orders/list` to
 *  browser sessions. The result was a stale count priced at a guessed rate:
 *  Elvris showed "56 unfulfilled @ $6.15" when Shopify had 157 open.
 *
 *  Shopify already knows which orders are unfulfilled, and we hold each
 *  store's own Shopify token. So ask the store. Price it at what ShipSourced
 *  has actually been billing that store per order, measured from the ledger,
 *  not a guess.
 *
 *  Orders left unfulfilled for months are not a fulfilment liability — they
 *  are abandoned or a data-quality problem — so they are counted and reported
 *  separately instead of being quietly added to the bill. */

export const STALE_AFTER_DAYS = 45;
const CACHE_MS = 5 * 60_000;

export interface PerOrderRate { cents: number | null; basisOrders: number; basisDays: number; note: string }

/** What ShipSourced actually bills this store per order, from the P&L ledger.
 *  Median of the daily rate so one re-billed day cannot skew it. Estimated
 *  days are excluded — pricing an estimate off an estimate compounds it. */
export function measurePerOrderCents(db: DatabaseType.Database, storeId: string, days = 30): PerOrderRate {
  const rows: any[] = db.prepare(`
    SELECT order_count AS n, (COALESCE(shipping_cost_cents,0) - COALESCE(fulfillment_est_cents,0)) AS billed
    FROM daily_pnl
    WHERE store_id = ? AND date >= date('now', ?) AND order_count > 0
      AND COALESCE(shipping_cost_cents,0) - COALESCE(fulfillment_est_cents,0) > 0`).all(storeId, `-${days} days`);
  if (rows.length < 3) return { cents: null, basisOrders: 0, basisDays: rows.length, note: 'not enough billed history to price an order' };
  const rates = rows.map(r => r.billed / r.n).sort((a, b) => a - b);
  const mid = rates.length % 2 ? rates[(rates.length - 1) / 2] : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;
  const orders = rows.reduce((s, r) => s + r.n, 0);
  return { cents: Math.round(mid), basisOrders: orders, basisDays: rows.length, note: `median of ${rows.length} billed days (${orders} orders) in the last ${days}` };
}

export interface UnfulfilledLiability {
  source: 'shopify' | 'local_orders';
  asOf: string;
  openCount: number;            // orders that still genuinely need fulfilling
  staleCount: number;           // unfulfilled for longer than STALE_AFTER_DAYS
  perOrderCents: number | null;
  cents: number | null;         // null when we cannot price an order — never a guess
  rate: PerOrderRate;
  note: string;
}

const cache = new Map<string, { at: number; value: UnfulfilledLiability }>();
export function _clearUnfulfilledCache() { cache.clear(); }

async function shopifyUnfulfilledCounts(db: DatabaseType.Database, storeId: string): Promise<{ open: number; stale: number } | null> {
  const { getCreds, shopifyGet } = await import('./shopify-sync');
  if (!getCreds(db, storeId)) return null;
  const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86400000).toISOString();
  const base = 'orders/count.json?status=open&fulfillment_status=unfulfilled';
  const now = Date.now();
  const [all, recent] = await Promise.all([
    shopifyGet(db, storeId, base, now),
    shopifyGet(db, storeId, `${base}&created_at_min=${encodeURIComponent(cutoff)}`, now),
  ]);
  const total = Number(all?.count ?? 0), open = Number(recent?.count ?? 0);
  return { open, stale: Math.max(0, total - open) };
}

/** The unfulfilled-orders bill for one store. */
export async function getUnfulfilledLiability(db: DatabaseType.Database, storeId: string): Promise<UnfulfilledLiability> {
  const hit = cache.get(storeId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const rate = measurePerOrderCents(db, storeId);
  const price = (n: number) => (rate.cents == null ? null : n * rate.cents);

  let value: UnfulfilledLiability;
  let counts: { open: number; stale: number } | null = null;
  let shopifyError: string | null = null;
  try { counts = await shopifyUnfulfilledCounts(db, storeId); }
  catch (e: any) { counts = null; shopifyError = String(e?.message || e).slice(0, 120); }

  if (counts) {
    value = {
      source: 'shopify', asOf: new Date().toISOString(),
      openCount: counts.open, staleCount: counts.stale,
      perOrderCents: rate.cents, cents: price(counts.open), rate,
      note: `${counts.open} unfulfilled order${counts.open === 1 ? '' : 's'} from the last ${STALE_AFTER_DAYS} days, live from Shopify`
        + (counts.stale ? ` · ${counts.stale} older than ${STALE_AFTER_DAYS} days excluded — those are abandoned or never marked fulfilled` : '')
        + (rate.cents == null ? ' · no billed history yet, so the cost is unknown' : ` · priced at ${(rate.cents / 100).toFixed(2)}/order (${rate.note})`),
    };
  } else {
    // No Shopify connection for this store: fall back to YM's own orders table
    // and say plainly how old it is, rather than presenting stale as live.
    const local: any = db.prepare(
      `SELECT COUNT(*) n, MAX(order_date) newest FROM orders WHERE store_id = ? AND COALESCE(fulfillment_status,'') IN ('unfulfilled','partial')`
    ).get(storeId);
    const n = local?.n || 0;
    value = {
      source: 'local_orders', asOf: local?.newest || 'unknown',
      openCount: n, staleCount: 0, perOrderCents: rate.cents, cents: price(n), rate,
      note: `${n} unfulfilled in YM's own order table, last updated ${local?.newest || 'never'}`
        + ` — connect this store's Shopify app for a live count`
        + (shopifyError ? ` (Shopify said: ${shopifyError})` : ''),
    };
  }

  cache.set(storeId, { at: Date.now(), value });
  return value;
}
