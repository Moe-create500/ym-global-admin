import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { syncStore } from '@/lib/sync';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(params.id);
  if (!store) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Compute SS charge breakdown: confirmed vs estimated (from per-order data)
  const ssBreakdown: any = db.prepare(`
    SELECT
      SUM(CASE WHEN ss_charge_is_estimate = 0 THEN ss_charge_cents ELSE 0 END) as charged_cents,
      SUM(CASE WHEN ss_charge_is_estimate = 1 AND fulfillment_status IN ('unfulfilled', 'partial') THEN ss_charge_cents ELSE 0 END) as estimated_cents,
      COUNT(CASE WHEN ss_charge_is_estimate = 1 AND fulfillment_status IN ('unfulfilled', 'partial') THEN 1 END) as estimated_order_count,
      SUM(ss_charge_cents) as total_cents
    FROM orders WHERE store_id = ? AND ss_charge_cents > 0
  `).get(params.id);

  const s = store as any;

  return NextResponse.json({
    store,
    ssCharges: {
      billed_cents: s.ss_charges_pending_cents || 0,
      balance_cents: s.ss_net_owed_cents || 0,
      charged_cents: ssBreakdown?.charged_cents || 0,
      estimated_cents: ssBreakdown?.estimated_cents || 0,
      estimated_order_count: ssBreakdown?.estimated_order_count || 0,
      total_cents: ssBreakdown?.total_cents || 0,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const db = getDb();

  // Check if shipsourced_client_id is being set for the first time
  const oldStore: any = db.prepare('SELECT shipsourced_client_id FROM stores WHERE id = ?').get(params.id);
  const isNewConnection = body.shipsourcedClientId && body.shipsourcedClientId !== oldStore?.shipsourced_client_id;

  const fields: string[] = [];
  const values: any[] = [];

  const allowed = ['name', 'shopify_domain', 'shopify_access_token', 'shipsourced_client_id', 'shipsourced_client_name',
    'shopify_monthly_plan_cents', 'notes', 'is_active', 'auto_sync', 'sync_start_date', 'chargeflow_api_key',
    'platform', 'platform_fee_pct', 'amazon_category'];
  const mapping: Record<string, string> = {
    shopifyDomain: 'shopify_domain',
    shopifyAccessToken: 'shopify_access_token',
    shipsourcedClientId: 'shipsourced_client_id',
    shipsourcedClientName: 'shipsourced_client_name',
    shopifyMonthlyPlanCents: 'shopify_monthly_plan_cents',
    isActive: 'is_active',
    autoSync: 'auto_sync',
    syncStartDate: 'sync_start_date',
    chargeflowApiKey: 'chargeflow_api_key',
    platformFeePct: 'platform_fee_pct',
    amazonCategory: 'amazon_category',
  };

  for (const [key, val] of Object.entries(body)) {
    const col = mapping[key] || key;
    if (allowed.includes(col)) {
      fields.push(`"${col}" = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  fields.push('"updated_at" = datetime(\'now\')');
  values.push(params.id);

  db.prepare(`UPDATE stores SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  // Auto-sync if ShipSourced client ID was just connected
  let syncResult = null;
  if (isNewConnection) {
    syncResult = await syncStore(params.id);
  }

  return NextResponse.json({ success: true, syncResult });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare('UPDATE stores SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(params.id);
  return NextResponse.json({ success: true });
}
