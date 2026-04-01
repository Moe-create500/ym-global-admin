import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const date = searchParams.get('date');
  const storeId = searchParams.get('storeId');

  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 });
  }

  const db = getDb();

  let where = 'WHERE dp.date = ?';
  const params: any[] = [date];

  if (storeId) {
    where += ' AND dp.store_id = ?';
    params.push(storeId);
  }

  const rows = db.prepare(`
    SELECT dp.*, s.name as store_name
    FROM daily_pnl dp
    JOIN stores s ON s.id = dp.store_id
    ${where}
    ORDER BY s.name
  `).all(...params);

  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, date, adSpendCents, shopifyFeesCents, otherCostsCents, confirm } = body;

  if (!storeId || !date) {
    return NextResponse.json({ error: 'storeId and date are required' }, { status: 400 });
  }

  const db = getDb();

  const existing: any = db.prepare(
    'SELECT * FROM daily_pnl WHERE store_id = ? AND date = ?'
  ).get(storeId, date);

  if (existing) {
    const adSpend = adSpendCents !== undefined ? adSpendCents : existing.ad_spend_cents;
    const shopifyFees = shopifyFeesCents !== undefined ? shopifyFeesCents : existing.shopify_fees_cents;
    const otherCosts = otherCostsCents !== undefined ? otherCostsCents : existing.other_costs_cents;
    const totalCosts = (existing.shipping_cost_cents || 0) +
      (existing.pick_pack_cents || 0) + (existing.packaging_cents || 0) + adSpend + shopifyFees + otherCosts;
    const netProfit = (existing.revenue_cents || 0) - totalCosts;
    const margin = existing.revenue_cents > 0 ? (netProfit / existing.revenue_cents) * 100 : 0;
    const isConfirmed = confirm !== undefined ? (confirm ? 1 : 0) : existing.is_confirmed;

    db.prepare(`
      UPDATE daily_pnl SET
        ad_spend_cents = ?, shopify_fees_cents = ?, other_costs_cents = ?,
        net_profit_cents = ?, margin_pct = ?, is_confirmed = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(adSpend, shopifyFees, otherCosts, netProfit, margin, isConfirmed, existing.id);
  } else {
    const adSpend = adSpendCents || 0;
    const shopifyFees = shopifyFeesCents || 0;
    const otherCosts = otherCostsCents || 0;
    const totalCosts = adSpend + shopifyFees + otherCosts;
    const netProfit = -totalCosts;

    db.prepare(`
      INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count, cogs_cents,
        shipping_cost_cents, pick_pack_cents, packaging_cents,
        ad_spend_cents, shopify_fees_cents, other_costs_cents,
        net_profit_cents, margin_pct, is_confirmed, source)
      VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, 0, ?, 'manual')
    `).run(crypto.randomUUID(), storeId, date, adSpend, shopifyFees, otherCosts, netProfit, confirm ? 1 : 0);
  }

  // Log manual entry
  if (adSpendCents !== undefined || shopifyFeesCents !== undefined || otherCostsCents !== undefined) {
    db.prepare(`
      INSERT INTO manual_entries (id, store_id, date, entry_type, amount_cents, description)
      VALUES (?, ?, ?, 'daily_update', ?, ?)
    `).run(
      crypto.randomUUID(), storeId, date,
      (adSpendCents || 0) + (shopifyFeesCents || 0) + (otherCostsCents || 0),
      `Updated: ad=${adSpendCents || 0}, shopify=${shopifyFeesCents || 0}, other=${otherCostsCents || 0}`
    );
  }

  return NextResponse.json({ success: true });
}
