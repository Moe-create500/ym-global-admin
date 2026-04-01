const Database = require('better-sqlite3');
const db = new Database('prisma/dev.db');
const profile = db.prepare("SELECT access_token, ad_account_id, store_id FROM fb_profiles WHERE profile_name = 'SINO'").get();

async function pullMonth(since, until) {
  const url = `https://graph.facebook.com/v21.0/${profile.ad_account_id}/insights?fields=spend,impressions,clicks,actions,action_values&time_range={"since":"${since}","until":"${until}"}&time_increment=1&level=account&limit=100&access_token=${profile.access_token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) { console.log('API error:', data.error.message); return []; }
  return data.data || [];
}

async function main() {
  const months = [
    ['2025-02-01','2025-02-28'], ['2025-03-01','2025-03-31'],
    ['2025-04-01','2025-04-30'], ['2025-05-01','2025-05-31'],
  ];
  
  let total = 0;
  for (const [since, until] of months) {
    const days = await pullMonth(since, until);
    const spend = days.reduce((s,d) => s + parseFloat(d.spend||'0'), 0);
    console.log(since.slice(0,7) + ': ' + days.length + ' days, spend: $' + spend.toFixed(2));
    
    for (const day of days) {
      const date = day.date_start;
      const spendCents = Math.round(parseFloat(day.spend || '0') * 100);
      
      const existing = db.prepare('SELECT id, revenue_cents, shipping_cost_cents, shopify_fees_cents, other_costs_cents, pick_pack_cents, packaging_cents, chargeback_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?').get(profile.store_id, date);
      if (existing) {
        const totalCosts = (existing.shipping_cost_cents || 0) + (existing.pick_pack_cents || 0) + (existing.packaging_cents || 0) + spendCents + (existing.shopify_fees_cents || 0) + (existing.other_costs_cents || 0) + (existing.chargeback_cents || 0) + (existing.app_costs_cents || 0);
        const netProfit = (existing.revenue_cents || 0) - totalCosts;
        const margin = existing.revenue_cents > 0 ? (netProfit / existing.revenue_cents) * 100 : 0;
        db.prepare("UPDATE daily_pnl SET ad_spend_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now') WHERE id = ?").run(spendCents, netProfit, margin, existing.id);
        total++;
      }
    }
  }
  console.log('Updated ' + total + ' PNL rows');
  
  // Check Marroomi ShipSourced
  const store = db.prepare("SELECT shipsourced_client_id FROM stores WHERE id = ?").get(profile.store_id);
  console.log('ShipSourced client:', store.shipsourced_client_id || 'NOT LINKED');
}
main().catch(e => console.error(e));
