// ============================================================================
// FINANCE CORE — the ONE canonical definition of P&L math.
//
// Every writer of daily_pnl.net_profit_cents / margin_pct and every reader
// that derives profit MUST go through these functions. Do not re-implement
// this arithmetic anywhere else — that is how the system ended up with five
// disagreeing profit formulas (audit 2026-09-09).
//
// Conventions:
//  - All money is INTEGER CENTS. Never floats, never dollars.
//  - Cost columns are stored as POSITIVE cents and subtracted here.
//  - NULL/undefined cost inputs are treated as 0 for arithmetic; whether a
//    zero means "known zero" or "missing" is a data-quality concern handled
//    upstream (sync status signals), not by inventing numbers here.
//
// Refund semantics (decided 2026-09-09, evidence in audit):
//  - Rows whose revenue comes from ShipSourced orders / CSV / fb_sync carry
//    GROSS revenue (verified: revenue_cents == SUM(orders.total_cents) even on
//    refund days), so refunds_cents must be subtracted to reach net revenue.
//  - Rows with source='shopify' get revenue from Shopify's "Total sales"
//    metric, which is ALREADY net of refunds — subtracting again would
//    double-count, so refunds are informational there.
// ============================================================================

export interface PnlComputeRow {
  revenue_cents: number;
  refunds_cents?: number | null;
  /** daily_pnl.source of the row's revenue ('shopify' = revenue already net of refunds) */
  source?: string | null;
  cogs_cents?: number | null;
  shipping_cost_cents?: number | null;
  pick_pack_cents?: number | null;
  packaging_cents?: number | null;
  ad_spend_cents?: number | null;
  shopify_fees_cents?: number | null;
  other_costs_cents?: number | null;
  chargeback_cents?: number | null;
  app_costs_cents?: number | null;
}

/** True when the row's revenue figure already has refunds netted out. */
export function revenueIsNetOfRefunds(source: string | null | undefined): boolean {
  return source === 'shopify';
}

/** Refunds that still need to be subtracted from this row's revenue. */
export function refundsAppliedCents(row: PnlComputeRow): number {
  if (revenueIsNetOfRefunds(row.source)) return 0;
  return row.refunds_cents || 0;
}

/** Sum of ALL nine cost columns. Positive cents. */
export function totalCostsCents(row: PnlComputeRow): number {
  return (
    (row.cogs_cents || 0) +
    (row.shipping_cost_cents || 0) +
    (row.pick_pack_cents || 0) +
    (row.packaging_cents || 0) +
    (row.ad_spend_cents || 0) +
    (row.shopify_fees_cents || 0) +
    (row.other_costs_cents || 0) +
    (row.chargeback_cents || 0) +
    (row.app_costs_cents || 0)
  );
}

/** Net revenue after refunds (per-source semantics above). */
export function netRevenueCents(row: PnlComputeRow): number {
  return (row.revenue_cents || 0) - refundsAppliedCents(row);
}

/** CANONICAL net profit: net revenue minus all costs. */
export function netProfitCents(row: PnlComputeRow): number {
  return netRevenueCents(row) - totalCostsCents(row);
}

/** CANONICAL margin: profit over NET revenue, in percent. 0 when no revenue. */
export function marginPct(profitCents: number, revenueCents: number): number {
  return revenueCents > 0 ? (profitCents / revenueCents) * 100 : 0;
}

/** Convenience: profit + margin together, from one row. */
export function computePnl(row: PnlComputeRow): { netProfitCents: number; marginPct: number } {
  const profit = netProfitCents(row);
  return { netProfitCents: profit, marginPct: marginPct(profit, netRevenueCents(row)) };
}
