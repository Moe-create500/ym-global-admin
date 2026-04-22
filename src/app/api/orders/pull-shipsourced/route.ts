import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAllClientOrdersList, getNewClientOrders, getClientBillingConfig, SSBillingProfileRate } from '@/lib/shipsourced';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function estimatePerSkuCharge(
  lineItems: { sku: string; qty: number }[],
  skuRateMap: Map<string, SSBillingProfileRate>
): number {
  if (skuRateMap.size === 0 || lineItems.length === 0) return 0;

  // Sort: most expensive SKU first (gets full base rate)
  const sorted = [...lineItems].sort((a, b) => {
    const rA = skuRateMap.get(a.sku);
    const rB = skuRateMap.get(b.sku);
    const fA = rA ? (rA.pickFee || 0) + (rA.packFee || 0) : 0;
    const fB = rB ? (rB.pickFee || 0) + (rB.packFee || 0) : 0;
    return fB - fA;
  });

  let totalCents = 0;
  let isFirst = true;

  for (const li of sorted) {
    const rate = skuRateMap.get(li.sku);
    if (!rate) continue;
    const qty = Math.max(li.qty, 1);
    const step = Math.max(1, rate.extraUnitStepQty || 1);
    const shipping = (rate.shippingFee || 0) * qty;
    let pick: number, pack: number;
    if (isFirst) {
      const extraUnits = Math.max(0, Math.ceil(qty / step) - 1);
      pick = (rate.pickFee || 0) + extraUnits * (rate.extraUnitPickFee || 0);
      pack = (rate.packFee || 0) + extraUnits * (rate.extraUnitPackFee || 0);
      isFirst = false;
    } else {
      pick = qty * (rate.extraUnitPickFee || 0);
      pack = qty * (rate.extraUnitPackFee || 0);
    }
    totalCents += Math.round((pick + pack + shipping) * 100);
  }

  return totalCents;
}

export async function POST(req: NextRequest) {
  const { storeId, full } = await req.json();

  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  const db = getDb();
  const store: any = db.prepare('SELECT * FROM stores WHERE id = ? AND is_active = 1').get(storeId);

  if (!store?.shipsourced_client_id) {
    return NextResponse.json({ error: 'Store has no ShipSourced client ID' }, { status: 400 });
  }

  // Get known order numbers for incremental sync
  const knownRows: any[] = db.prepare(
    'SELECT order_number FROM orders WHERE store_id = ?'
  ).all(storeId);
  const knownOrderNumbers = new Set(knownRows.map((r: any) => r.order_number));

  // Fetch billing config and orders in parallel
  // Use incremental mode by default (only new orders), full mode if requested
  const [ssOrders, billingConfig] = await Promise.all([
    full ? getAllClientOrdersList(store.shipsourced_client_id)
         : getNewClientOrders(store.shipsourced_client_id, knownOrderNumbers),
    getClientBillingConfig(store.shipsourced_client_id).catch(() => null),
  ]);

  // Build SKU rate maps from billing config (china rates used — most orders ship from China)
  const chinaRateMap = new Map<string, SSBillingProfileRate>();
  const usRateMap = new Map<string, SSBillingProfileRate>();
  const isPerSku = billingConfig?.china?.pricingType === 'per_sku' || billingConfig?.us?.pricingType === 'per_sku';
  const excludeLabelCost = billingConfig?.china?.settings?.excludeLabelCost || billingConfig?.us?.settings?.excludeLabelCost;

  if (billingConfig?.china?.rates) {
    for (const r of billingConfig.china.rates) {
      if (r.sku) chinaRateMap.set(r.sku, r);
    }
  }
  if (billingConfig?.us?.rates) {
    for (const r of billingConfig.us.rates) {
      if (r.sku) usRateMap.set(r.sku, r);
    }
  }

  // Import/update products (SKUs) from billing config
  let skusImported = 0;
  if (billingConfig?.clientSkus) {
    const findProduct = db.prepare('SELECT id FROM products WHERE store_id = ? AND sku = ?');
    const insertProduct = db.prepare(`
      INSERT INTO products (id, store_id, title, sku, cost_cents, china_cost_cents, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `);
    const updateProduct = db.prepare(`
      UPDATE products SET title = ?, cost_cents = ?, china_cost_cents = ?, updated_at = datetime('now')
      WHERE store_id = ? AND sku = ?
    `);

    for (const skuInfo of billingConfig.clientSkus) {
      if (!skuInfo.sku) continue;
      const chinaRate = chinaRateMap.get(skuInfo.sku);
      const chinaChargeCents = chinaRate ? Math.round((chinaRate.packFee + chinaRate.pickFee) * 100) : 0;
      const existing = findProduct.get(storeId, skuInfo.sku);
      if (existing) {
        updateProduct.run(skuInfo.name || '', skuInfo.unitCostCents || 0, chinaChargeCents, storeId, skuInfo.sku);
      } else {
        insertProduct.run(crypto.randomUUID(), storeId, skuInfo.name || '', skuInfo.sku, skuInfo.unitCostCents || 0, chinaChargeCents);
      }
      skusImported++;
    }
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  const insertStmt = db.prepare(`
    INSERT INTO orders (id, store_id, order_number, order_name, created_at_shopify,
      order_date, financial_status, fulfillment_status, total_cents, subtotal_cents,
      shipping_cents, taxes_cents, discount_cents, refunded_cents, net_revenue_cents,
      line_items, line_item_count, customer_email, currency, source,
      ss_charge_cents, ss_charge_is_estimate, tracking_number, carrier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'shipsourced', ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE orders SET
      fulfillment_status = ?,
      order_name = ?,
      total_cents = CASE WHEN total_cents = 0 THEN ? ELSE total_cents END,
      line_items = COALESCE(?, line_items),
      line_item_count = CASE WHEN line_item_count = 0 THEN ? ELSE line_item_count END,
      ss_charge_cents = ?, ss_charge_is_estimate = ?,
      tracking_number = COALESCE(?, tracking_number),
      carrier = COALESCE(?, carrier)
    WHERE store_id = ? AND order_number = ?
  `);

  for (const order of ssOrders) {
    // Extract order number — e.g. "SHIPHERO-p65anj-zr-#5041" → "5041"
    const rawExtId = order.externalOrderId || '';
    const hashIdx = rawExtId.lastIndexOf('#');
    let orderNumber = hashIdx >= 0 ? rawExtId.slice(hashIdx + 1) : rawExtId;
    // Fallback: strip any remaining prefixes
    orderNumber = orderNumber.replace(/^(SHIPHERO-|SH-)?/, '').trim();
    if (!orderNumber) { skipped++; continue; }

    // Parse date — convert to Pacific time
    const createdAt = order.orderDate || order.createdAt || '';
    let orderDate = '';
    if (createdAt) {
      try {
        const d = new Date(createdAt);
        orderDate = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD
      } catch { skipped++; continue; }
    }
    if (!orderDate) { skipped++; continue; }

    const totalCents = Math.round((order.totalPrice || 0) * 100);

    // Parse line items
    let lineItems: { name: string; qty: number; priceCents: number; sku: string }[] = [];
    if (order.lineItems) {
      try {
        const items = typeof order.lineItems === 'string' ? JSON.parse(order.lineItems) : order.lineItems;
        if (Array.isArray(items)) {
          lineItems = items.map((item: any) => ({
            name: item.name || item.title || '',
            qty: item.quantity || 1,
            priceCents: Math.round((item.price || 0) * 100),
            sku: item.sku || '',
          }));
        }
      } catch {}
    }

    const lineItemsJson = lineItems.length > 0 ? JSON.stringify(lineItems) : null;

    // Extract tracking from shipments array (first shipment with tracking wins)
    let trackingNumber: string | null = null;
    let carrier: string | null = null;
    if (Array.isArray(order.shipments) && order.shipments.length > 0) {
      for (const s of order.shipments) {
        if (s?.trackingNumber) {
          trackingNumber = String(s.trackingNumber);
          carrier = s.carrier ? String(s.carrier) : null;
          break;
        }
      }
    }

    // Map ShipSourced status to fulfillment status
    const fulfillmentStatus = order.status === 'SHIPPED' ? 'fulfilled'
      : order.status === 'NEW' ? 'unfulfilled'
      : (order.status || '').toLowerCase();

    // Compute charge: actual from billingCharge or estimate from rates
    let chargeCents = 0;
    let isEstimate = 0;

    if (order.billingCharges && order.billingCharges.length > 0) {
      // Actual charge exists — use markup (what client pays) if excludeLabelCost, else totalCharge
      for (const bc of order.billingCharges) {
        if (bc.status === 'VOIDED') continue;
        chargeCents += Math.round((excludeLabelCost ? bc.markup : bc.totalCharge) * 100);
      }
    } else if (isPerSku && lineItems.length > 0) {
      // Estimate from per-SKU rates — use china rates first, fall back to US
      const rateMap = chinaRateMap.size > 0 ? chinaRateMap : usRateMap;
      chargeCents = estimatePerSkuCharge(lineItems, rateMap);
      isEstimate = chargeCents > 0 ? 1 : 0;
    }

    const existing: any = db.prepare(
      'SELECT id, source FROM orders WHERE store_id = ? AND order_number = ?'
    ).get(storeId, orderNumber);

    const orderName = `#${orderNumber}`;

    if (existing) {
      // Don't overwrite CSV-imported orders' revenue — only update fulfillment + charge info
      updateStmt.run(
        fulfillmentStatus, orderName, totalCents,
        lineItemsJson, lineItems.length,
        chargeCents, isEstimate,
        trackingNumber, carrier,
        storeId, orderNumber
      );
      updated++;
    } else {
      insertStmt.run(
        crypto.randomUUID(), storeId, orderNumber, orderName, createdAt,
        orderDate, 'paid', fulfillmentStatus, totalCents, totalCents,
        0, 0, 0, 0, totalCents,
        lineItemsJson, lineItems.length, null,
        chargeCents, isEstimate, trackingNumber, carrier
      );
      imported++;
    }
  }

  // Recalculate daily_pnl revenue from all orders for affected dates
  const affectedDates: any[] = db.prepare(`
    SELECT order_date as date, SUM(net_revenue_cents) as revenue, COUNT(*) as orders
    FROM orders WHERE store_id = ? GROUP BY order_date
  `).all(storeId);

  let recalculated = 0;
  for (const day of affectedDates) {
    const pnl: any = db.prepare(
      'SELECT id, ad_spend_cents, shopify_fees_cents, other_costs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, chargeback_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
    ).get(storeId, day.date);

    if (pnl) {
      const shopifyFee = Math.round((day.revenue || 0) * 0.025);
      const totalCosts = (pnl.shipping_cost_cents || 0) + (pnl.pick_pack_cents || 0) +
        (pnl.packaging_cents || 0) + (pnl.ad_spend_cents || 0) + shopifyFee +
        (pnl.other_costs_cents || 0) + (pnl.chargeback_cents || 0) + (pnl.app_costs_cents || 0);
      const netProfit = day.revenue - totalCosts;
      const margin = day.revenue > 0 ? (netProfit / day.revenue) * 100 : 0;
      db.prepare(`
        UPDATE daily_pnl SET revenue_cents = ?, order_count = ?, shopify_fees_cents = ?,
          net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(day.revenue, day.orders, shopifyFee, netProfit, margin, pnl.id);
      recalculated++;
    } else {
      const shopifyFee = Math.round((day.revenue || 0) * 0.025);
      const netProfit = day.revenue - shopifyFee;
      const margin = day.revenue > 0 ? (netProfit / day.revenue) * 100 : 0;
      db.prepare(`
        INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count,
          cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents,
          ad_spend_cents, shopify_fees_cents, other_costs_cents, chargeback_cents,
          net_profit_cents, margin_pct, source)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, 0, 0, ?, ?, 'shipsourced')
      `).run(crypto.randomUUID(), storeId, day.date, day.revenue, day.orders,
        shopifyFee, netProfit, margin);
      recalculated++;
    }
  }

  return NextResponse.json({
    success: true,
    imported,
    updated,
    skipped,
    skusImported,
    recalculated,
    total: ssOrders.length,
  });
}
