import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/pnl/same-time-yesterday?storeId=&visibleOnly=1
// Yesterday's performance UP TO THE SAME TIME OF DAY as right now — the apples-to-apples
// baseline for the dashboard's "Today" comparison. Comparing 11 AM today against
// yesterday's FULL day reads as a fake crash every morning.
//   revenue + orders: EXACT, from order timestamps (created_at_shopify UTC ISO)
//   ads + apps:       pro-rated by elapsed fraction of the Pacific day (billed by time)
//   fees/fulfillment/other/chargebacks: pro-rated by revenue share (they follow orders)
export async function GET(req: NextRequest) {
  const db = getDb();
  const storeId = req.nextUrl.searchParams.get('storeId');
  const visibleOnly = req.nextUrl.searchParams.get('visibleOnly') === '1' && !storeId;

  const now = new Date();
  const pacDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const yesterday = pacDate(new Date(now.getTime() - 86_400_000));
  const cutoffIso = new Date(now.getTime() - 86_400_000).toISOString(); // same instant, 24h ago

  // elapsed fraction of the Pacific day (for time-billed costs)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
  const pv = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  const tf = Math.min(1, (pv('hour') * 3600 + pv('minute') * 60 + pv('second')) / 86_400);

  const VISIBLE = "(SELECT id FROM stores WHERE is_active = 1 AND COALESCE(dashboard_hidden, 0) = 0 AND COALESCE(platform, 'shopify') = 'shopify')";

  let oWhere = 'o.order_date = ? AND o.created_at_shopify <= ?';
  const oArgs: any[] = [yesterday, cutoffIso];
  if (storeId) { oWhere += ' AND o.store_id = ?'; oArgs.push(storeId); }
  else if (visibleOnly) oWhere += ` AND o.store_id IN ${VISIBLE}`;
  const ord: any = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(net_revenue_cents), 0) AS rev FROM orders o WHERE ${oWhere}`
  ).get(...oArgs);

  let pWhere = 'dp.date = ?';
  const pArgs: any[] = [yesterday];
  if (storeId) { pWhere += ' AND dp.store_id = ?'; pArgs.push(storeId); }
  else if (visibleOnly) pWhere += ` AND dp.store_id IN ${VISIBLE}`;
  const day: any = db.prepare(
    `SELECT COALESCE(SUM(revenue_cents),0) AS rev, COALESCE(SUM(shopify_fees_cents),0) AS fees,
            COALESCE(SUM(ad_spend_cents),0) AS ad,
            COALESCE(SUM(cogs_cents + shipping_cost_cents + pick_pack_cents + packaging_cents),0) AS fulfill,
            COALESCE(SUM(app_costs_cents),0) AS app, COALESCE(SUM(other_costs_cents),0) AS other,
            COALESCE(SUM(chargeback_cents),0) AS cb
     FROM daily_pnl dp WHERE ${pWhere}`
  ).get(...pArgs);

  const rf = day.rev > 0 ? Math.min(1, ord.rev / day.rev) : tf; // revenue share of the day so far
  const ad = Math.round(day.ad * tf);
  const net = ord.rev - Math.round(day.fees * rf) - Math.round(day.fulfill * rf) - ad
    - Math.round(day.app * tf) - Math.round(day.other * rf) - Math.round(day.cb * rf);
  const margin = ord.rev > 0 ? (net / ord.rev) * 100 : 0;

  return NextResponse.json({
    totals: {
      revenue_cents: ord.rev,
      order_count: ord.n,
      ad_spend_cents: ad,
      net_profit_cents: net,
      margin_pct: margin,
    },
    yesterday,
    cutoff: cutoffIso,
    elapsed_day_fraction: Math.round(tf * 1000) / 1000,
  });
}
