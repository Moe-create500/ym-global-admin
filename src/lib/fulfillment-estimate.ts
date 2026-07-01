import { getClientOrdersList, SSOrder } from '@/lib/shipsourced';

/**
 * Fulfillment cost estimation for orders ShipSourced hasn't billed yet.
 *
 * ShipSourced bills orders in arrears — recent orders have no billingCharges,
 * so daily_pnl understates fulfillment (and overstates profit) for recent days.
 * This module learns recent invoiced prices per exact product mix from billed
 * orders and estimates the un-billed ones. Estimates live in
 * daily_pnl.fulfillment_est_cents and are folded into shipping_cost_cents;
 * every sync recomputes from scratch, so once ShipSourced prices an order the
 * actual charge replaces the estimate automatically.
 */

const RATE_LOOKBACK_DAYS = 60;  // billed-order window used to learn prices
const EST_WINDOW_DAYS = 45;     // only estimate un-billed orders newer than this
const MAX_PAGES = 8;            // cap on orders-list pages per full sync
const TZ_OFFSET_MIN = 420;      // match ShipSourced dailyRevenue day bucketing (UTC-7)

interface RateEntry { total: number; n: number }

export interface FulfillmentRates {
  combos: Record<string, RateEntry>;  // exact product mix → total invoiced cents
  skus: Record<string, RateEntry>;    // single-SKU per-unit invoiced cents
  store: RateEntry;                   // per-order average across all billed orders
}

export interface EstimateResult {
  estByDay: Record<string, number>;   // day (UTC-7) → estimated cents
  estimatedOrders: number;
  skippedOrders: number;              // un-billed orders we had no rate for
}

function shipDay(iso: string): string {
  return new Date(new Date(iso).getTime() - TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

function parseItems(o: SSOrder): { sku: string; qty: number }[] {
  try {
    const items = JSON.parse(o.lineItems || '[]');
    return items
      .map((i: any) => ({ sku: String(i.sku || i.name || ''), qty: Math.max(1, parseInt(i.quantity, 10) || 1) }))
      .filter((i: any) => i.sku);
  } catch {
    return [];
  }
}

function comboKey(items: { sku: string; qty: number }[]): string {
  return items.map(i => `${i.sku}x${i.qty}`).sort().join('|');
}

function billedCents(o: SSOrder): number {
  return Math.round((o.billingCharges || []).reduce((s, c) => s + (c.totalCharge || 0), 0) * 100);
}

function isCancelled(o: SSOrder): boolean {
  return /cancel|void/i.test(o.status || '');
}

function avg(e: RateEntry | undefined, minSamples = 1): number | null {
  if (!e || e.n < minSamples) return null;
  return Math.round(e.total / e.n);
}

export function buildRates(orders: SSOrder[], sinceIso: string): FulfillmentRates {
  const rates: FulfillmentRates = { combos: {}, skus: {}, store: { total: 0, n: 0 } };
  for (const o of orders) {
    if (isCancelled(o)) continue;
    if ((o.createdAt || '') < sinceIso) continue;
    const charge = billedCents(o);
    if (charge <= 0) continue;
    const items = parseItems(o);
    if (items.length === 0) continue;

    const key = comboKey(items);
    const combo = rates.combos[key] || (rates.combos[key] = { total: 0, n: 0 });
    combo.total += charge; combo.n++;

    if (items.length === 1) {
      const sku = rates.skus[items[0].sku] || (rates.skus[items[0].sku] = { total: 0, n: 0 });
      sku.total += charge / items[0].qty; sku.n++;
    }

    rates.store.total += charge; rates.store.n++;
  }
  return rates;
}

export function estimateOrderCents(o: SSOrder, rates: FulfillmentRates): number | null {
  const items = parseItems(o);
  if (items.length === 0) return avg(rates.store, 3);

  const exact = avg(rates.combos[comboKey(items)]);
  if (exact !== null) return exact;

  if (items.length === 1) {
    const perUnit = avg(rates.skus[items[0].sku]);
    if (perUnit !== null) return Math.round(perUnit * items[0].qty);
  }

  return avg(rates.store, 3);
}

function ensureCacheTable(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS fulfillment_rate_cache (
    store_id TEXT PRIMARY KEY,
    rates_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

/**
 * Fetch recent orders and compute per-day fulfillment estimates for un-billed ones.
 *
 * full=true  (syncStore): pages back ~60 days, rebuilds rates, caches them.
 * full=false (today fast-path): fetches 1 page, uses cached rates (falls back to
 *            rates built from that single page if no cache exists yet).
 */
export async function computeFulfillmentEstimates(
  db: any,
  store: any,
  opts: { full: boolean }
): Promise<EstimateResult> {
  const result: EstimateResult = { estByDay: {}, estimatedOrders: 0, skippedOrders: 0 };
  if (!store?.shipsourced_client_id) return result;

  const now = Date.now();
  const rateCutoff = new Date(now - RATE_LOOKBACK_DAYS * 86400000).toISOString();
  const estCutoff = new Date(now - EST_WINDOW_DAYS * 86400000).toISOString();

  // Orders list is sorted newest-first; page until we're past the rate window.
  const orders: SSOrder[] = [];
  const maxPages = opts.full ? MAX_PAGES : 1;
  for (let page = 1; page <= maxPages; page++) {
    const data = await getClientOrdersList(store.shipsourced_client_id, page, 200);
    const batch = data.orders || [];
    orders.push(...batch);
    if (batch.length === 0 || orders.length >= (data.total || 0)) break;
    const oldest = batch[batch.length - 1];
    if ((oldest?.createdAt || '') < rateCutoff) break;
  }
  if (orders.length === 0) return result;

  ensureCacheTable(db);

  let rates: FulfillmentRates | null = null;
  if (opts.full) {
    rates = buildRates(orders, rateCutoff);
    if (rates.store.n > 0) {
      db.prepare(`INSERT INTO fulfillment_rate_cache (store_id, rates_json, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(store_id) DO UPDATE SET rates_json = excluded.rates_json, updated_at = datetime('now')`)
        .run(store.id, JSON.stringify(rates));
    }
  } else {
    const cached: any = db.prepare('SELECT rates_json FROM fulfillment_rate_cache WHERE store_id = ?').get(store.id);
    if (cached?.rates_json) {
      try { rates = JSON.parse(cached.rates_json); } catch { rates = null; }
    }
    if (!rates) rates = buildRates(orders, rateCutoff);
  }
  if (!rates || rates.store.n === 0) return result;

  for (const o of orders) {
    if (isCancelled(o)) continue;
    if (billedCents(o) > 0) continue;
    const created = o.orderDate || o.createdAt || '';
    if (created < estCutoff) continue;
    const est = estimateOrderCents(o, rates);
    if (est === null || est <= 0) { result.skippedOrders++; continue; }
    const day = shipDay(created);
    result.estByDay[day] = (result.estByDay[day] || 0) + est;
    result.estimatedOrders++;
  }

  return result;
}
