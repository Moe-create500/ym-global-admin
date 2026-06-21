import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { referralFeePerUnit, isKnownCategory, AMAZON_CATEGORIES, EBAY_FEE_PCT } from '@/lib/amazon-fees';

export const dynamic = 'force-dynamic';

// GET /api/orders/breakdown?storeId=&from=&to=&page=&limit=
// Per-order revenue → COGS → fulfillment → Amazon referral fee → net → margin, plus range totals.
// Amazon fees are computed Sellerboard-style: per item, by the product's category (with the
// $0.30/item minimum and price tiers), falling back to the store's category.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const storeId = sp.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  const from = sp.get('from'); const to = sp.get('to');
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || '100')));

  const db = getDb();
  const store: any = db.prepare('SELECT id, name, platform, platform_fee_pct, amazon_category FROM stores WHERE id = ?').get(storeId);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  const storeCat: string = isKnownCategory(store.amazon_category) ? store.amazon_category : 'default';

  // SKU → {cost, category} from products. cost drives COGS; category drives per-item referral fee.
  const products: any[] = db.prepare(
    "SELECT sku, cost_cents, us_cost_cents, china_cost_cents, category FROM products WHERE store_id = ? AND sku IS NOT NULL AND sku != ''"
  ).all(storeId);
  const costMap: Record<string, number> = {};
  const catMap: Record<string, string> = {};
  let cogsAvailable = false; let productCatCount = 0;
  for (const p of products) {
    const unit = ((p.us_cost_cents || 0) + (p.china_cost_cents || 0)) || (p.cost_cents || 0);
    costMap[p.sku] = unit;
    if (unit > 0) cogsAvailable = true;
    if (isKnownCategory(p.category)) { catMap[p.sku] = p.category; productCatCount++; }
  }

  const isAmazon = store.platform === 'amazon';
  const isEbay = store.platform === 'ebay';

  // Parse one order: COGS + Amazon per-item referral fee + item list.
  // Variant SKUs "BASE-N" = N units of BASE (same rule as CFO/sync).
  function parseOrder(json: string | null): { cogs: number; amazonFee: number; items: any[] } {
    let cogs = 0, amazonFee = 0; const items: any[] = [];
    try {
      for (const it of (JSON.parse(json || '[]') || [])) {
        const qty = it.qty || 1;
        const unitPrice = it.priceCents || 0;
        items.push({ name: it.name || '', sku: it.sku || null, qty, priceCents: unitPrice });
        // COGS
        if (it.sku) {
          let unit = costMap[it.sku];
          if (unit === undefined) {
            const m = String(it.sku).match(/^(.+)-(\d+)$/);
            if (m && costMap[m[1]] !== undefined) {
              const mult = parseInt(m[2]);
              if (mult > 0 && mult <= 100) unit = costMap[m[1]] * mult;
            }
          }
          cogs += (unit || 0) * qty;
        }
        // Amazon referral fee — per item, by product category (fallback store category)
        if (isAmazon) {
          const cat = (it.sku && catMap[it.sku]) ? catMap[it.sku] : storeCat;
          amazonFee += referralFeePerUnit(cat, unitPrice) * qty;
        }
      }
    } catch {}
    return { cogs, amazonFee, items };
  }

  function feeForOrder(amazonFee: number, totalCents: number): number {
    if (isAmazon) return amazonFee;
    if (isEbay) return Math.round(totalCents * EBAY_FEE_PCT / 100);
    return 0;
  }

  let where = "WHERE store_id = ? AND financial_status != 'voided'";
  const params: any[] = [storeId];
  if (from) { where += ' AND order_date >= ?'; params.push(from); }
  if (to) { where += ' AND order_date <= ?'; params.push(to); }

  // Totals across the FULL filtered range.
  const allRows: any[] = db.prepare(`SELECT total_cents, refunded_cents, ss_charge_cents, line_items FROM orders ${where}`).all(...params);
  let tRev = 0, tRef = 0, tCogs = 0, tFulfill = 0, tFee = 0;
  for (const o of allRows) {
    const rev = o.total_cents || 0;
    const { cogs, amazonFee } = parseOrder(o.line_items);
    tRev += rev; tRef += o.refunded_cents || 0;
    tCogs += cogs; tFulfill += o.ss_charge_cents || 0;
    tFee += feeForOrder(amazonFee, rev);
  }
  const totalCost = tCogs + tFulfill + tFee;
  const netProfit = tRev - tRef - totalCost;

  // Paginated per-order rows.
  const offset = (page - 1) * limit;
  const rows: any[] = db.prepare(
    `SELECT id, order_number, order_name, order_date, total_cents, refunded_cents, ss_charge_cents,
            ss_charge_is_estimate, line_items, fulfillment_status FROM orders ${where}
     ORDER BY order_date DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const orders = rows.map((o: any) => {
    const rev = o.total_cents || 0;
    const { cogs, amazonFee, items } = parseOrder(o.line_items);
    const fee = feeForOrder(amazonFee, rev);
    const fulfill = o.ss_charge_cents || 0;
    const refund = o.refunded_cents || 0;
    const net = rev - refund - cogs - fulfill - fee;
    return {
      id: o.id, order_number: o.order_number, order_name: o.order_name, order_date: o.order_date,
      revenue_cents: rev, refund_cents: refund, cogs_cents: cogs, fulfillment_cents: fulfill,
      ss_charge_is_estimate: o.ss_charge_is_estimate, fee_cents: fee, net_cents: net,
      margin_pct: rev > 0 ? (net / rev) * 100 : 0, items, fulfillment_status: o.fulfillment_status,
    };
  });

  return NextResponse.json({
    store: { id: store.id, name: store.name, platform: store.platform },
    cogs_available: cogsAvailable,
    fee_model: {
      store_category: store.amazon_category || 'default',
      categories: AMAZON_CATEGORIES,
      products_with_category: productCatCount,
      products_total: products.length,
    },
    totals: {
      revenue_cents: tRev, refund_cents: tRef, cogs_cents: tCogs, fulfillment_cents: tFulfill,
      fee_cents: tFee, total_cost_cents: totalCost, net_profit_cents: netProfit,
      margin_pct: tRev > 0 ? (netProfit / tRev) * 100 : 0, order_count: allRows.length,
    },
    orders, page, limit, total: allRows.length, totalPages: Math.max(1, Math.ceil(allRows.length / limit)),
  });
}
