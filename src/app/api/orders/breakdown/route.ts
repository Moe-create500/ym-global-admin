import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Platform-fee logic mirrored from src/lib/sync.ts (source of truth there). Kept local so this
// read-only breakdown endpoint doesn't pull in the heavy sync module. Update both if fees change.
const AMAZON_FEE_SCHEDULE: Record<string, { maxCents?: number; pct: number }[]> = {
  health_personal_care: [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  beauty: [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  grocery: [{ maxCents: 1500, pct: 8 }, { pct: 15 }],
  clothing: [{ maxCents: 2000, pct: 17 }, { pct: 17 }],
  electronics: [{ pct: 8 }], computers: [{ pct: 6 }], automotive: [{ pct: 12 }],
  home_garden: [{ pct: 15 }], kitchen: [{ pct: 15 }], sports: [{ pct: 15 }],
  toys: [{ pct: 15 }], pet_supplies: [{ pct: 15 }],
  baby: [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  supplements: [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  default: [{ pct: 15 }],
};
const EBAY_FEE_PCT = 13.25;

function platformFee(platform: string, category: string | null, totalCents: number): number {
  if (platform === 'ebay') return Math.round(totalCents * EBAY_FEE_PCT / 100);
  if (platform === 'amazon') {
    const tiers = AMAZON_FEE_SCHEDULE[category || 'default'] || AMAZON_FEE_SCHEDULE.default;
    for (const t of tiers) if (!t.maxCents || totalCents <= t.maxCents) return Math.round(totalCents * t.pct / 100);
    return Math.round(totalCents * tiers[tiers.length - 1].pct / 100);
  }
  return 0;
}

// GET /api/orders/breakdown?storeId=&from=&to=&page=&limit=
// Per-order revenue → COGS → fulfillment → platform fee → net → margin, plus full-range totals.
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

  // SKU → unit cost map (US + China, fallback to cost_cents). Drives per-order COGS.
  const products: any[] = db.prepare(
    "SELECT sku, cost_cents, us_cost_cents, china_cost_cents FROM products WHERE store_id = ? AND sku IS NOT NULL AND sku != ''"
  ).all(storeId);
  const costMap: Record<string, number> = {};
  let cogsAvailable = false;
  for (const p of products) {
    const unit = ((p.us_cost_cents || 0) + (p.china_cost_cents || 0)) || (p.cost_cents || 0);
    costMap[p.sku] = unit;
    if (unit > 0) cogsAvailable = true;
  }

  // COGS for one order's line_items JSON. Handles variant SKUs "BASE-N" = N units of BASE
  // (same rule used in CFO/sync). Returns {cogs, items}.
  function parseOrder(json: string | null): { cogs: number; items: { name: string; sku: string | null; qty: number; priceCents: number }[] } {
    let cogs = 0; const items: any[] = [];
    try {
      for (const it of (JSON.parse(json || '[]') || [])) {
        const qty = it.qty || 1;
        items.push({ name: it.name || '', sku: it.sku || null, qty, priceCents: it.priceCents || 0 });
        if (!it.sku) continue;
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
    } catch {}
    return { cogs, items };
  }

  let where = "WHERE store_id = ? AND financial_status != 'voided'";
  const params: any[] = [storeId];
  if (from) { where += ' AND order_date >= ?'; params.push(from); }
  if (to) { where += ' AND order_date <= ?'; params.push(to); }

  // Totals across the FULL filtered range (not just the page).
  const allRows: any[] = db.prepare(`SELECT total_cents, refunded_cents, ss_charge_cents, line_items FROM orders ${where}`).all(...params);
  let tRev = 0, tRef = 0, tCogs = 0, tFulfill = 0, tFee = 0;
  for (const o of allRows) {
    const rev = o.total_cents || 0;
    tRev += rev; tRef += o.refunded_cents || 0;
    tCogs += parseOrder(o.line_items).cogs;
    tFulfill += o.ss_charge_cents || 0;
    tFee += platformFee(store.platform, store.amazon_category, rev);
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
    const { cogs, items } = parseOrder(o.line_items);
    const fee = platformFee(store.platform, store.amazon_category, rev);
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
    totals: {
      revenue_cents: tRev, refund_cents: tRef, cogs_cents: tCogs, fulfillment_cents: tFulfill,
      fee_cents: tFee, total_cost_cents: totalCost, net_profit_cents: netProfit,
      margin_pct: tRev > 0 ? (netProfit / tRev) * 100 : 0, order_count: allRows.length,
    },
    orders, page, limit, total: allRows.length, totalPages: Math.max(1, Math.ceil(allRows.length / limit)),
  });
}
