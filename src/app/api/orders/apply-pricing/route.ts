import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { storeId } = await req.json();
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();

  // Fetch all pricing rules for this store
  const rules: any[] = db.prepare(
    'SELECT * FROM sku_pricing WHERE store_id = ? ORDER BY effective_from DESC'
  ).all(storeId);

  if (rules.length === 0) {
    return NextResponse.json({ error: 'No pricing rules configured' }, { status: 400 });
  }

  // Normalize special characters for flexible matching (™ vs TM, ® vs R, etc.)
  function normalizeName(s: string): string {
    return s.toLowerCase()
      .replace(/™/g, 'tm')
      .replace(/®/g, 'r')
      .replace(/©/g, 'c')
      .replace(/['']/g, "'")
      .replace(/[""]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Build lookups: by exact SKU code AND by name pattern (normalized for flexible matching)
  const rulesBySku = new Map<string, any[]>();
  const rulesByName: { key: string; rules: any[] }[] = [];

  for (const r of rules) {
    const key = r.sku;
    // Index by exact SKU code
    const skuList = rulesBySku.get(key) || [];
    skuList.push(r);
    rulesBySku.set(key, skuList);

    // Also index by normalized name for flexible matching
    const normalizedKey = normalizeName(key);
    const existing = rulesByName.find(e => e.key === normalizedKey);
    if (existing) {
      existing.rules.push(r);
    } else {
      rulesByName.push({ key: normalizedKey, rules: [r] });
    }
  }

  // Find matching rule for a line item
  function findRule(sku: string, name: string, orderDate: string): any | null {
    // 1. Try exact SKU match
    if (sku) {
      const skuRules = rulesBySku.get(sku);
      if (skuRules) {
        const rule = skuRules.find(r => {
          if (orderDate < r.effective_from) return false;
          if (r.effective_to && orderDate > r.effective_to) return false;
          return true;
        });
        if (rule) return rule;
      }
    }

    // 2. Try name matching with normalized comparison (handles ™ vs TM, etc.)
    const normalizedName = normalizeName(name || '');
    if (normalizedName) {
      for (const entry of rulesByName) {
        // Exact match or contains match (either direction)
        if (normalizedName === entry.key || normalizedName.includes(entry.key) || entry.key.includes(normalizedName)) {
          const rule = entry.rules.find(r => {
            if (orderDate < r.effective_from) return false;
            if (r.effective_to && orderDate > r.effective_to) return false;
            return true;
          });
          if (rule) return rule;
        }
      }
    }

    return null;
  }

  // Fetch orders needing pricing: csv_import with no charge, OR any source with estimated charges
  const orders: any[] = db.prepare(
    `SELECT id, order_date, line_items, line_item_count FROM orders WHERE store_id = ? AND line_items IS NOT NULL AND (
      ((source = 'csv_import' OR source IS NULL) AND (ss_charge_cents = 0 OR ss_charge_cents IS NULL))
      OR ss_charge_is_estimate = 1
    )`
  ).all(storeId);

  const updateStmt = db.prepare(
    'UPDATE orders SET ss_charge_cents = ?, ss_charge_is_estimate = 1 WHERE id = ?'
  );

  let updated = 0;
  let skipped = 0;

  for (const order of orders) {
    let lineItems: { sku: string; qty: number; name: string }[];
    try {
      lineItems = JSON.parse(order.line_items);
      if (!Array.isArray(lineItems) || lineItems.length === 0) { skipped++; continue; }
    } catch { skipped++; continue; }

    // Find matching pricing rule for each line item (skip "Shipping Protection" type items)
    const pricedItems: { baseCharge: number; extraCharge: number; extraAfter: number; qty: number }[] = [];

    for (const li of lineItems) {
      const name = li.name || '';
      if (name.toLowerCase().includes('shipping protection')) continue;

      const rule = findRule(li.sku || '', name, order.order_date);
      if (rule) {
        pricedItems.push({
          baseCharge: rule.base_charge_cents,
          extraCharge: rule.extra_unit_charge_cents,
          extraAfter: rule.extra_unit_after || 1,
          qty: Math.max(li.qty || 1, 1),
        });
      }
    }

    if (pricedItems.length === 0) { skipped++; continue; }

    // Calculate total charge: most expensive SKU first gets base rate
    pricedItems.sort((a, b) => b.baseCharge - a.baseCharge);

    let totalCents = 0;
    let isFirst = true;

    for (const item of pricedItems) {
      if (isFirst) {
        // First SKU: flat base charge + extra charge for units beyond threshold
        const extraUnits = Math.max(0, item.qty - item.extraAfter);
        totalCents += item.baseCharge + item.extraCharge * extraUnits;
        isFirst = false;
      } else {
        // Additional SKUs: extra charge per unit
        totalCents += item.extraCharge * item.qty;
      }
    }

    if (totalCents > 0) {
      updateStmt.run(totalCents, order.id);
      updated++;
    } else {
      skipped++;
    }
  }

  // Roll up ss_charge_cents into daily_pnl.shipping_cost_cents
  if (updated > 0) {
    const dailyCharges: any[] = db.prepare(`
      SELECT order_date as date, SUM(ss_charge_cents) as total_charges
      FROM orders WHERE store_id = ? AND ss_charge_cents > 0
      GROUP BY order_date
    `).all(storeId);

    for (const day of dailyCharges) {
      const pnlRow: any = db.prepare(
        'SELECT id, revenue_cents, ad_spend_cents, shopify_fees_cents, other_costs_cents, pick_pack_cents, packaging_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
      ).get(storeId, day.date);
      if (pnlRow) {
        const shopifyFee = Math.round((pnlRow.revenue_cents || 0) * 0.025);
        const totalCosts = day.total_charges + (pnlRow.pick_pack_cents || 0) +
          (pnlRow.packaging_cents || 0) + (pnlRow.ad_spend_cents || 0) +
          shopifyFee + (pnlRow.other_costs_cents || 0);
        const netProfit = (pnlRow.revenue_cents || 0) - totalCosts;
        const margin = pnlRow.revenue_cents > 0 ? (netProfit / pnlRow.revenue_cents) * 100 : 0;
        db.prepare(`
          UPDATE daily_pnl SET shipping_cost_cents = ?, shopify_fees_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(day.total_charges, shopifyFee, netProfit, margin, pnlRow.id);
      }
    }
  }

  return NextResponse.json({ success: true, updated, skipped, total: orders.length });
}
