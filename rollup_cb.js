const Database = require('better-sqlite3');
const db = new Database('prisma/dev.db');
const storeId = '5981c048-ab3f-41ad-84a8-cc2770160476';

const days = db.prepare("SELECT chargeback_date as date, SUM(amount_cents) as total FROM chargebacks WHERE store_id = ? AND status = 'lost' GROUP BY chargeback_date").all(storeId);
console.log('Lost chargeback days:', days.length);

db.prepare('UPDATE daily_pnl SET chargeback_cents = 0 WHERE store_id = ?').run(storeId);

let updated = 0;
for (const day of days) {
  const pnl = db.prepare('SELECT id, revenue_cents, ad_spend_cents, shipping_cost_cents, shopify_fees_cents, pick_pack_cents, packaging_cents, other_costs_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?').get(storeId, day.date);
  if (pnl) {
    const totalCosts = (pnl.shipping_cost_cents || 0) + (pnl.pick_pack_cents || 0) + (pnl.packaging_cents || 0) + (pnl.ad_spend_cents || 0) + (pnl.shopify_fees_cents || 0) + (pnl.other_costs_cents || 0) + (pnl.app_costs_cents || 0) + day.total;
    const netProfit = (pnl.revenue_cents || 0) - totalCosts;
    const margin = pnl.revenue_cents > 0 ? (netProfit / pnl.revenue_cents) * 100 : 0;
    db.prepare("UPDATE daily_pnl SET chargeback_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now') WHERE id = ?").run(day.total, netProfit, margin, pnl.id);
    updated++;
  }
}
console.log('Updated', updated, 'PNL rows');
const total = db.prepare('SELECT SUM(chargeback_cents) as t FROM daily_pnl WHERE store_id = ? AND chargeback_cents > 0').get(storeId);
console.log('Total chargebacks in PNL: $' + (total.t ? (total.t/100).toFixed(2) : '0'));
