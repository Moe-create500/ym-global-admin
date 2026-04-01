const Database = require('better-sqlite3');
const db = new Database('prisma/dev.db');
const storeId = '5981c048-ab3f-41ad-84a8-cc2770160476';

// Recalculate fulfillment from per-order ss_charge_cents grouped by order_date
const dailyCharges = db.prepare(`
  SELECT order_date as date, SUM(ss_charge_cents) as total
  FROM orders
  WHERE store_id = ? AND ss_charge_cents > 0 AND order_date IS NOT NULL
  GROUP BY order_date
  ORDER BY order_date
`).all(storeId);

console.log('Days with order charges:', dailyCharges.length);

let updated = 0;
for (const day of dailyCharges) {
  const pnl = db.prepare(
    'SELECT id, revenue_cents, ad_spend_cents, shopify_fees_cents, other_costs_cents, pick_pack_cents, packaging_cents, chargeback_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
  ).get(storeId, day.date);
  
  if (pnl) {
    const totalCosts = day.total + (pnl.pick_pack_cents || 0) + (pnl.packaging_cents || 0) +
      (pnl.ad_spend_cents || 0) + (pnl.shopify_fees_cents || 0) + (pnl.other_costs_cents || 0) +
      (pnl.chargeback_cents || 0) + (pnl.app_costs_cents || 0);
    const netProfit = (pnl.revenue_cents || 0) - totalCosts;
    const margin = pnl.revenue_cents > 0 ? (netProfit / pnl.revenue_cents) * 100 : 0;
    db.prepare("UPDATE daily_pnl SET shipping_cost_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now') WHERE id = ?")
      .run(day.total, netProfit, margin, pnl.id);
    updated++;
  }
}

console.log('Updated', updated, 'PNL rows with per-order fulfillment');

// Verify
const months = db.prepare("SELECT substr(date,1,7) as month, SUM(shipping_cost_cents)/100 as fulfill FROM daily_pnl WHERE store_id = ? AND shipping_cost_cents > 0 GROUP BY month ORDER BY month").all(storeId);
months.forEach(m => console.log(m.month, '$' + m.fulfill.toFixed(2)));
