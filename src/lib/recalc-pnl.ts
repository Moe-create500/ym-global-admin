import { getDb } from '@/lib/db';
import crypto from 'crypto';

/** Shopify payment processing fee rate (2.6% + 30c on Basic plan) */
const SHOPIFY_FEE_RATE = 0.026;
const SHOPIFY_FEE_PER_TXN_CENTS = 30;

/** Standard Shopify payment-processing fee for a day: 2.6% of revenue + 30c per order. */
export function calculateShopifyFees(revenueCents: number, orderCount: number): number {
  if (revenueCents <= 0) return 0;
  return Math.round(revenueCents * SHOPIFY_FEE_RATE) + (orderCount || 0) * SHOPIFY_FEE_PER_TXN_CENTS;
}

/**
 * Single source of truth for daily P&L recalculation.
 * Derives:
 *   - shipping_cost_cents from SUM(orders.ss_charge_cents) per day
 *   - shopify_fees_cents from 2.6% of revenue + 30c per order
 *   - net_profit including ALL cost columns (COGS, fulfillment, ad spend, fees, chargebacks, app costs)
 *
 * All paths (sync, pull-shipsourced, apply-pricing) should call this after updating orders.
 */
export function recalcDailyPnl(
  storeId: string,
  dates?: string[],
  fallbackCharges?: Record<string, number>,
): number {
  const db = getDb();

  // Get per-order charge totals grouped by date
  let orderChargesQuery: string;
  let orderChargesParams: any[];

  if (dates && dates.length > 0) {
    const placeholders = dates.map(() => '?').join(',');
    orderChargesQuery = `
      SELECT order_date as date,
        SUM(ss_charge_cents) as total_charges,
        SUM(net_revenue_cents) as total_revenue,
        COUNT(*) as order_count
      FROM orders
      WHERE store_id = ? AND order_date IN (${placeholders})
      GROUP BY order_date
    `;
    orderChargesParams = [storeId, ...dates];
  } else {
    orderChargesQuery = `
      SELECT order_date as date,
        SUM(ss_charge_cents) as total_charges,
        SUM(net_revenue_cents) as total_revenue,
        COUNT(*) as order_count
      FROM orders
      WHERE store_id = ?
      GROUP BY order_date
    `;
    orderChargesParams = [storeId];
  }

  const orderDays: any[] = db.prepare(orderChargesQuery).all(...orderChargesParams);

  const handledDates = new Set<string>();
  let recalculated = 0;

  // Hoisted statements + one transaction — full-store recalcs touch thousands
  // of days; per-day prepare + autocommit was the slow path.
  const selectPnl = db.prepare(
    `SELECT id, revenue_cents, cogs_cents, ad_spend_cents,
            other_costs_cents, chargeback_cents, app_costs_cents, is_confirmed,
            order_count
     FROM daily_pnl WHERE store_id = ? AND date = ?`);
  const updatePnl = db.prepare(`
    UPDATE daily_pnl SET
      shipping_cost_cents = ?, pick_pack_cents = 0, packaging_cents = 0,
      shopify_fees_cents = ?,
      net_profit_cents = ?, margin_pct = ?,
      updated_at = datetime('now')
    WHERE id = ?`);
  const insertPnl = db.prepare(`
    INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count,
      cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents,
      ad_spend_cents, shopify_fees_cents, other_costs_cents, chargeback_cents, app_costs_cents,
      net_profit_cents, margin_pct, source)
    VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 0, ?, 0, 0, 0, ?, ?, 'orders')`);

  db.transaction(() => {
  for (const day of orderDays) {
    handledDates.add(day.date);

    const fulfillmentCents = day.total_charges || 0;

    const pnl: any = selectPnl.get(storeId, day.date);

    if (pnl) {
      if (pnl.is_confirmed) continue;

      const revenue = pnl.revenue_cents || 0;
      const cogs = pnl.cogs_cents || 0;
      const orders = pnl.order_count || day.order_count || 0;
      const adSpend = pnl.ad_spend_cents || 0;
      const otherCosts = pnl.other_costs_cents || 0;
      const chargebacks = pnl.chargeback_cents || 0;
      const appCosts = pnl.app_costs_cents || 0;

      // Auto-calculate Shopify fees: 2.6% of revenue + 30c per order
      const shopifyFees = Math.round(revenue * SHOPIFY_FEE_RATE) + (orders * SHOPIFY_FEE_PER_TXN_CENTS);

      const totalCosts = cogs + fulfillmentCents + adSpend + shopifyFees + otherCosts + chargebacks + appCosts;
      const netProfit = revenue - totalCosts;
      const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

      updatePnl.run(fulfillmentCents, shopifyFees, netProfit, margin, pnl.id);
    } else {
      const revenue = day.total_revenue || 0;
      const orders = day.order_count || 0;
      const shopifyFees = Math.round(revenue * SHOPIFY_FEE_RATE) + (orders * SHOPIFY_FEE_PER_TXN_CENTS);
      const totalCosts = fulfillmentCents + shopifyFees;
      const netProfit = revenue - totalCosts;
      const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

      insertPnl.run(crypto.randomUUID(), storeId, day.date, revenue, orders,
        fulfillmentCents, shopifyFees, netProfit, margin);
    }
    recalculated++;
  }

  // Handle fallback dates (billing-only days with no per-order data)
  if (fallbackCharges) {
    for (const [date, lumpSumCents] of Object.entries(fallbackCharges)) {
      if (handledDates.has(date)) continue;

      const pnl: any = selectPnl.get(storeId, date);

      if (pnl) {
        if (pnl.is_confirmed) continue;

        const revenue = pnl.revenue_cents || 0;
        const cogs = pnl.cogs_cents || 0;
        const orders = pnl.order_count || 0;
        const adSpend = pnl.ad_spend_cents || 0;
        const otherCosts = pnl.other_costs_cents || 0;
        const chargebacks = pnl.chargeback_cents || 0;
        const appCosts = pnl.app_costs_cents || 0;
        const shopifyFees = Math.round(revenue * SHOPIFY_FEE_RATE) + (orders * SHOPIFY_FEE_PER_TXN_CENTS);

        const totalCosts = cogs + lumpSumCents + adSpend + shopifyFees + otherCosts + chargebacks + appCosts;
        const netProfit = revenue - totalCosts;
        const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

        updatePnl.run(lumpSumCents, shopifyFees, netProfit, margin, pnl.id);
      }
      recalculated++;
    }
  }
  })();

  return recalculated;
}
