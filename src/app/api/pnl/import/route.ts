import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, rows } = body;

  if (!storeId || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'storeId and rows[] are required' }, { status: 400 });
  }

  const db = getDb();

  // Verify store exists
  const store: any = db.prepare('SELECT id, name FROM stores WHERE id = ?').get(storeId);
  if (!store) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const date = row.date;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`Row ${i + 1}: invalid date "${date}"`);
      skipped++;
      continue;
    }

    const revenueCents = Math.round((parseFloat(row.revenue) || 0) * 100);
    const orderCount = parseInt(row.orders) || 0;
    const cogsCents = Math.round((parseFloat(row.cogs) || 0) * 100);
    const shippingCents = Math.round((parseFloat(row.shipping) || 0) * 100);
    const pickPackCents = Math.round((parseFloat(row.pick_pack) || 0) * 100);
    const packagingCents = Math.round((parseFloat(row.packaging) || 0) * 100);
    const adSpendCents = Math.round((parseFloat(row.ad_spend) || 0) * 100);
    const shopifyFeesCents = Math.round((parseFloat(row.shopify_fees) || 0) * 100);
    const otherCostsCents = Math.round((parseFloat(row.other_costs) || 0) * 100);

    const totalCosts = cogsCents + shippingCents + pickPackCents + packagingCents +
      adSpendCents + shopifyFeesCents + otherCostsCents;
    const netProfit = revenueCents - totalCosts;
    const margin = revenueCents > 0 ? (netProfit / revenueCents) * 100 : 0;

    const existing: any = db.prepare(
      'SELECT id FROM daily_pnl WHERE store_id = ? AND date = ?'
    ).get(storeId, date);

    if (existing) {
      db.prepare(`
        UPDATE daily_pnl SET
          revenue_cents = ?, order_count = ?, cogs_cents = ?,
          shipping_cost_cents = ?, pick_pack_cents = ?, packaging_cents = ?,
          ad_spend_cents = ?, shopify_fees_cents = ?, other_costs_cents = ?,
          net_profit_cents = ?, margin_pct = ?,
          source = 'import', updated_at = datetime('now')
        WHERE id = ?
      `).run(revenueCents, orderCount, cogsCents,
        shippingCents, pickPackCents, packagingCents,
        adSpendCents, shopifyFeesCents, otherCostsCents,
        netProfit, margin, existing.id);
      updated++;
    } else {
      db.prepare(`
        INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count, cogs_cents,
          shipping_cost_cents, pick_pack_cents, packaging_cents,
          ad_spend_cents, shopify_fees_cents, other_costs_cents,
          net_profit_cents, margin_pct, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import')
      `).run(crypto.randomUUID(), storeId, date, revenueCents, orderCount, cogsCents,
        shippingCents, pickPackCents, packagingCents,
        adSpendCents, shopifyFeesCents, otherCostsCents,
        netProfit, margin);
      imported++;
    }
  }

  return NextResponse.json({
    success: true,
    imported,
    updated,
    skipped,
    total: rows.length,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}
