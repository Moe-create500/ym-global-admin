import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession, getAccessibleStoreIds, requireStoreAccess } from '@/lib/auth-tenant';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const period = searchParams.get('period') || 'daily';

  // ═══ AUTH CHECK ═══
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = session.role === 'admin' || session.role === 'data_corrector';

  // If specific storeId requested, verify access
  if (storeId) {
    const auth = requireStoreAccess(req, storeId);
    if (!auth.authorized) return auth.response;
  }

  const db = getDb();

  let dateGroup: string;
  switch (period) {
    case 'weekly':
      dateGroup = "strftime('%Y-W%W', date)";
      break;
    case 'monthly':
      dateGroup = "strftime('%Y-%m', date)";
      break;
    default:
      dateGroup = 'date';
  }

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (storeId) {
    // Specific store requested (already authorized above)
    where += ' AND dp.store_id = ?';
    params.push(storeId);
  } else if (!isAdmin) {
    // No storeId requested by non-admin — scope to their accessible stores
    const accessibleIds = getAccessibleStoreIds(session.employeeId, session.role);
    if (accessibleIds.length === 0) {
      return NextResponse.json({ rows: [], totals: {} });
    }
    const placeholders = accessibleIds.map(() => '?').join(',');
    where += ` AND dp.store_id IN (${placeholders})`;
    params.push(...accessibleIds);
  }
  // Admin with no storeId = global view (allowed)

  if (from) { where += ' AND dp.date >= ?'; params.push(from); }
  if (to) { where += ' AND dp.date <= ?'; params.push(to); }

  const rows = db.prepare(`
    SELECT
      ${dateGroup} as period,
      SUM(dp.revenue_cents) as revenue_cents,
      SUM(dp.cogs_cents) as cogs_cents,
      SUM(dp.shipping_cost_cents) as shipping_cents,
      SUM(dp.pick_pack_cents) as pick_pack_cents,
      SUM(dp.packaging_cents) as packaging_cents,
      SUM(dp.ad_spend_cents) as ad_spend_cents,
      SUM(dp.shopify_fees_cents) as shopify_fees_cents,
      SUM(dp.other_costs_cents) as other_costs_cents,
      SUM(dp.chargeback_cents) as chargeback_cents,
      SUM(dp.app_costs_cents) as app_costs_cents,
      SUM(dp.net_profit_cents) as net_profit_cents,
      SUM(dp.order_count) as order_count
    FROM daily_pnl dp
    ${where}
    GROUP BY ${dateGroup}
    ORDER BY period DESC
    LIMIT 365
  `).all(...params);

  const data = rows.map((r: any) => ({
    ...r,
    margin_pct: r.revenue_cents > 0 ? (r.net_profit_cents / r.revenue_cents) * 100 : 0,
  }));

  const totals = db.prepare(`
    SELECT
      SUM(dp.revenue_cents) as revenue_cents,
      SUM(dp.cogs_cents) as cogs_cents,
      SUM(dp.shipping_cost_cents) as shipping_cents,
      SUM(dp.pick_pack_cents) as pick_pack_cents,
      SUM(dp.packaging_cents) as packaging_cents,
      SUM(dp.ad_spend_cents) as ad_spend_cents,
      SUM(dp.shopify_fees_cents) as shopify_fees_cents,
      SUM(dp.other_costs_cents) as other_costs_cents,
      SUM(dp.chargeback_cents) as chargeback_cents,
      SUM(dp.app_costs_cents) as app_costs_cents,
      SUM(dp.net_profit_cents) as net_profit_cents,
      SUM(dp.order_count) as order_count
    FROM daily_pnl dp
    ${where}
  `).get(...params) as any;

  if (totals) {
    totals.margin_pct = totals.revenue_cents > 0 ? (totals.net_profit_cents / totals.revenue_cents) * 100 : 0;
  }

  return NextResponse.json({ rows: data, totals: totals || {} });
}
