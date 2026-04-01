import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const range = searchParams.get('range') || 'monthly';

  // Use Pacific time for date comparisons
  const pacificNow = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const pacificMonth = pacificNow.slice(0, 7) + '-01';
  const pacificYear = pacificNow.slice(0, 4) + '-01-01';

  let dateFilter: string;
  switch (range) {
    case 'daily':
      dateFilter = `dp.date = '${pacificNow}'`;
      break;
    case 'yearly':
      dateFilter = `dp.date >= '${pacificYear}'`;
      break;
    case 'monthly':
    default:
      dateFilter = `dp.date >= '${pacificMonth}'`;
      break;
  }

  const stores = db.prepare(`
    SELECT s.*,
      (SELECT SUM(dp.revenue_cents) FROM daily_pnl dp WHERE dp.store_id = s.id AND ${dateFilter}) as mtd_revenue,
      (SELECT SUM(dp.net_profit_cents) FROM daily_pnl dp WHERE dp.store_id = s.id AND ${dateFilter}) as mtd_profit,
      (SELECT SUM(dp.order_count) FROM daily_pnl dp WHERE dp.store_id = s.id AND ${dateFilter}) as mtd_orders,
      (SELECT COUNT(*) FROM fb_profiles fp WHERE fp.store_id = s.id AND fp.is_active = 1 AND fp.ad_account_id IS NOT NULL) as fb_connected,
      CASE WHEN s.chargeflow_api_key IS NOT NULL AND s.chargeflow_api_key != '' THEN 1 ELSE 0 END as chargeflow_connected,
      COALESCE(s.invoices_verified, 0) as invoices_verified
    FROM stores s
    WHERE s.is_active = 1
    ORDER BY s.name
  `).all();

  // Fetch action-required notes
  const alerts: any[] = db.prepare(`
    SELECT sn.id, sn.store_id, s.name as store_name, sn.note, sn.category, sn.created_at
    FROM store_notes sn
    JOIN stores s ON s.id = sn.store_id
    WHERE sn.category = 'action_required'
    ORDER BY sn.created_at DESC
  `).all();

  return NextResponse.json({ stores, alerts });
}

export async function PATCH(req: NextRequest) {
  const { storeId, invoices_verified } = await req.json();
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  const db = getDb();
  db.prepare('UPDATE stores SET invoices_verified = ? WHERE id = ?').run(invoices_verified ? 1 : 0, storeId);
  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  const { name, shopifyDomain, shipsourcedClientId, shipsourcedClientName, shopifyMonthlyPlanCents, notes } = await req.json();

  if (!name) {
    return NextResponse.json({ error: 'Store name is required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO stores (id, name, shopify_domain, shipsourced_client_id, shipsourced_client_name, shopify_monthly_plan_cents, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, shopifyDomain || null, shipsourcedClientId || null, shipsourcedClientName || null, shopifyMonthlyPlanCents || 0, notes || null);

  return NextResponse.json({ success: true, id });
}
