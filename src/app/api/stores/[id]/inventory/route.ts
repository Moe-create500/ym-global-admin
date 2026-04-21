import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const storeId = params.id;

  // All inventory purchases
  const purchases = db.prepare(
    'SELECT * FROM inventory_purchases WHERE store_id = ? ORDER BY purchase_date DESC'
  ).all(storeId);

  // Units sold per SKU (from order line_items)
  const orders = db.prepare(
    "SELECT line_items FROM orders WHERE store_id = ? AND line_items IS NOT NULL AND financial_status != 'voided'"
  ).all(storeId) as { line_items: string }[];

  // soldMap counts by exact SKU, variantSoldMap rolls up variants (e.g. "12345-2" → 2 units of "12345")
  const soldMap: Record<string, number> = {};
  for (const order of orders) {
    try {
      const items = JSON.parse(order.line_items);
      for (const item of items) {
        if (item.sku) {
          soldMap[item.sku] = (soldMap[item.sku] || 0) + (item.qty || 1);
        }
      }
    } catch {}
  }

  // No variant rollup — only count exact SKU matches for accurate inventory

  // Build per-product summary
  const productMap: Record<string, {
    product_name: string; sku: string | null;
    total_purchased: number; total_cost_cents: number;
    avg_cost_cents: number; total_sold: number;
    remaining: number; asset_value_cents: number;
    purchases: any[];
  }> = {};

  for (const p of purchases as any[]) {
    const key = p.sku || p.product_name;
    if (!productMap[key]) {
      productMap[key] = {
        product_name: p.product_name, sku: p.sku,
        total_purchased: 0, total_cost_cents: 0, avg_cost_cents: 0,
        total_sold: 0, remaining: 0, asset_value_cents: 0, purchases: [],
      };
    }
    productMap[key].total_purchased += p.qty_purchased;
    productMap[key].total_cost_cents += p.total_cost_cents;
    productMap[key].purchases.push(p);
  }

  let totalAssetValue = 0;
  let totalCostBasis = 0;
  let totalSoldValue = 0;

  for (const [key, product] of Object.entries(productMap)) {
    product.avg_cost_cents = product.total_purchased > 0
      ? Math.round(product.total_cost_cents / product.total_purchased) : 0;
    // Count direct SKU sales only
    product.total_sold = product.sku ? (soldMap[product.sku] || 0) : 0;
    product.remaining = Math.max(0, product.total_purchased - product.total_sold);
    product.asset_value_cents = product.remaining * product.avg_cost_cents;
    totalAssetValue += product.asset_value_cents;
    totalCostBasis += product.total_cost_cents;
    totalSoldValue += product.total_sold * product.avg_cost_cents;
  }

  return NextResponse.json({
    purchases,
    products: Object.values(productMap),
    summary: {
      total_asset_value_cents: totalAssetValue,
      total_cost_basis_cents: totalCostBasis,
      total_sold_value_cents: totalSoldValue,
      product_count: Object.keys(productMap).length,
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { sku, productName, qty, costPerUnit, purchaseDate, supplier, note } = await req.json();

  if (!productName || !qty || !costPerUnit || !purchaseDate) {
    return NextResponse.json({ error: 'productName, qty, costPerUnit, and purchaseDate are required' }, { status: 400 });
  }

  const costPerUnitCents = Math.round(parseFloat(costPerUnit) * 100);
  const totalCostCents = costPerUnitCents * parseInt(qty);

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO inventory_purchases (id, store_id, sku, product_name, qty_purchased, cost_per_unit_cents, total_cost_cents, purchase_date, supplier, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.id, sku || null, productName, parseInt(qty), costPerUnitCents, totalCostCents, purchaseDate, supplier || null, note || null);

  return NextResponse.json({ success: true, id });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const purchaseId = searchParams.get('purchaseId');
  if (!purchaseId) return NextResponse.json({ error: 'purchaseId required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM inventory_purchases WHERE id = ? AND store_id = ?').run(purchaseId, params.id);
  return NextResponse.json({ success: true });
}
