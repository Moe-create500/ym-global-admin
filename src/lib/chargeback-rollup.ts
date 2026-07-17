import type Database from 'better-sqlite3';

/** Roll lost chargebacks into daily_pnl.chargeback_cents and recalc net profit.
 *  Shared by the chargebacks API routes and the Shopify Payments dispute sync.
 *
 *  Scoped: only rows whose chargeback amount actually changed get rewritten —
 *  the old version reset every daily_pnl row the store ever had, which meant
 *  thousands of writes per call on mature stores. */
export function rollUpChargebacks(db: Database.Database, storeId: string) {
  const days: any[] = db.prepare(`
    SELECT chargeback_date as date, SUM(amount_cents) as total
    FROM chargebacks WHERE store_id = ? AND status = 'lost'
    GROUP BY chargeback_date
  `).all(storeId);
  const target = new Map<string, number>(days.map((d: any) => [d.date, d.total || 0]));

  // Candidate rows: days that should carry a chargeback amount, plus days that
  // currently carry one (so cleared/won disputes reset back to 0).
  const dates = Array.from(target.keys());
  const placeholders = dates.map(() => '?').join(',');
  const rows: any[] = db.prepare(`
    SELECT id, date, revenue_cents, cogs_cents, shipping_cost_cents, pick_pack_cents,
      packaging_cents, ad_spend_cents, shopify_fees_cents, other_costs_cents,
      app_costs_cents, chargeback_cents
    FROM daily_pnl
    WHERE store_id = ? AND (chargeback_cents != 0${dates.length ? ` OR date IN (${placeholders})` : ''})
  `).all(storeId, ...dates);

  const update = db.prepare(`
    UPDATE daily_pnl SET chargeback_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  db.transaction(() => {
    for (const row of rows) {
      const want = target.get(row.date) || 0;
      if ((row.chargeback_cents || 0) === want) continue;
      const totalCosts = (row.cogs_cents || 0) + (row.shipping_cost_cents || 0) + (row.pick_pack_cents || 0) +
        (row.packaging_cents || 0) + (row.ad_spend_cents || 0) + (row.shopify_fees_cents || 0) +
        (row.other_costs_cents || 0) + (row.app_costs_cents || 0) + want;
      const netProfit = (row.revenue_cents || 0) - totalCosts;
      const margin = row.revenue_cents > 0 ? (netProfit / row.revenue_cents) * 100 : 0;
      update.run(want, netProfit, margin, row.id);
    }
  })();
}
