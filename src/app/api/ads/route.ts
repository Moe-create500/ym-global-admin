import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const platform = searchParams.get('platform');

  const db = getDb();

  // Exclude ad-level rows (ad_set_id IS NOT NULL) — those are for the Creatives performance view only
  let where = 'WHERE a.ad_set_id IS NULL';
  const params: any[] = [];

  if (storeId) { where += ' AND a.store_id = ?'; params.push(storeId); }
  if (from) { where += ' AND a.date >= ?'; params.push(from); }
  if (to) { where += ' AND a.date <= ?'; params.push(to); }
  if (platform) { where += ' AND a.platform = ?'; params.push(platform); }

  // Aggregate at campaign level per day (ad-level detail is on the Creatives page)
  const rows = db.prepare(`
    SELECT
      MIN(a.id) as id,
      a.store_id,
      s.name as store_name,
      a.date,
      a.platform,
      a.campaign_id,
      a.campaign_name,
      SUM(a.spend_cents) as spend_cents,
      SUM(a.impressions) as impressions,
      SUM(a.clicks) as clicks,
      SUM(COALESCE(a.purchases, 0)) as purchases,
      SUM(COALESCE(a.purchase_value_cents, 0)) as purchase_value_cents,
      CASE WHEN SUM(a.spend_cents) > 0
        THEN ROUND(CAST(SUM(COALESCE(a.purchase_value_cents, 0)) AS REAL) / SUM(a.spend_cents), 2)
        ELSE 0 END as roas,
      MAX(a.source) as source
    FROM ad_spend a
    JOIN stores s ON s.id = a.store_id
    ${where}
    GROUP BY a.store_id, a.date, a.platform, a.campaign_id
    ORDER BY a.date DESC, s.name, SUM(a.spend_cents) DESC
    LIMIT 500
  `).all(...params);

  // Summary by platform
  const summary = db.prepare(`
    SELECT
      a.platform,
      SUM(a.spend_cents) as total_spend_cents,
      SUM(a.impressions) as total_impressions,
      SUM(a.clicks) as total_clicks,
      COUNT(*) as entries
    FROM ad_spend a
    ${where}
    GROUP BY a.platform
  `).all(...params);

  return NextResponse.json({ rows, summary });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, date, platform, campaignName, spendCents, impressions, clicks, roas } = body;

  if (!storeId || !date || !platform) {
    return NextResponse.json({ error: 'storeId, date, and platform are required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO ad_spend (id, store_id, date, platform, campaign_name, spend_cents, impressions, clicks, roas, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
  `).run(id, storeId, date, platform, campaignName || null, spendCents || 0, impressions || 0, clicks || 0, roas || 0);

  // Also update daily_pnl ad_spend_cents total for that day
  const totalAdSpend: any = db.prepare(
    'SELECT SUM(spend_cents) as total FROM ad_spend WHERE store_id = ? AND date = ? AND ad_set_id IS NULL'
  ).get(storeId, date);

  const existing: any = db.prepare(
    'SELECT id, revenue_cents, cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, shopify_fees_cents, other_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
  ).get(storeId, date);

  if (existing) {
    const adSpend = totalAdSpend?.total || 0;
    const totalCosts = (existing.cogs_cents || 0) + (existing.shipping_cost_cents || 0) +
      (existing.pick_pack_cents || 0) + (existing.packaging_cents || 0) +
      adSpend + (existing.shopify_fees_cents || 0) + (existing.other_costs_cents || 0);
    const netProfit = (existing.revenue_cents || 0) - totalCosts;
    const margin = existing.revenue_cents > 0 ? (netProfit / existing.revenue_cents) * 100 : 0;

    db.prepare(`
      UPDATE daily_pnl SET ad_spend_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(adSpend, netProfit, margin, existing.id);
  }

  return NextResponse.json({ success: true, id });
}
