// ── Order-level pull from ShipSourced (number+date identity) ────────────────
// Single source shared by the 30-min autonomous loop and /api/sync/auto.
// Identity is order_number + pacific order_date: numbers alone collide across
// store migrations (Purebite re-used numbers after cutover).

import { getDb } from '@/lib/db';
import { getNewClientOrders, getClientBillingConfig, ssOrderKey } from '@/lib/shipsourced';
import crypto from 'crypto';

export async function pullNewOrders(storeId: string, clientId: string) {
  const db = getDb();

  // Identity is number+date: numbers alone collide across store migrations
  // (Purebite's new SHIPHERO numbering restarted below old csv numbers, which
  // made every new order look "already known" and froze imports for 2 months)
  const knownRows: any[] = db.prepare('SELECT order_number, order_date FROM orders WHERE store_id = ?').all(storeId);
  const knownKeys = new Set(knownRows.map((r: any) => ssOrderKey(String(r.order_number), String(r.order_date || ''))));

  const [ssOrders, billingConfig] = await Promise.all([
    getNewClientOrders(clientId, knownKeys),
    getClientBillingConfig(clientId).catch(() => null),
  ]);

  if (ssOrders.length === 0) return { imported: 0 };

  // Build rate maps
  const chinaRateMap = new Map<string, any>();
  const isPerSku = billingConfig?.china?.pricingType === 'per_sku' || billingConfig?.us?.pricingType === 'per_sku';
  const excludeLabelCost = billingConfig?.china?.settings?.excludeLabelCost || billingConfig?.us?.settings?.excludeLabelCost;
  if (billingConfig?.china?.rates) {
    for (const r of billingConfig.china.rates) { if (r.sku) chinaRateMap.set(r.sku, r); }
  }

  const insertStmt = db.prepare(`
    INSERT INTO orders (id, store_id, order_number, order_name, created_at_shopify,
      order_date, financial_status, fulfillment_status, total_cents, subtotal_cents,
      shipping_cents, taxes_cents, discount_cents, refunded_cents, net_revenue_cents,
      line_items, line_item_count, customer_email, currency, source,
      ss_charge_cents, ss_charge_is_estimate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'shipsourced', ?, ?)
  `);

  let imported = 0;
  for (const order of ssOrders) {
    const rawExtId = order.externalOrderId || '';
    const hashIdx = rawExtId.lastIndexOf('#');
    let orderNumber = hashIdx >= 0 ? rawExtId.slice(hashIdx + 1) : rawExtId;
    orderNumber = orderNumber.replace(/^(SHIPHERO-|SH-)?/, '').trim();
    if (!orderNumber) continue;

    const createdAt = order.orderDate || order.createdAt || '';
    let orderDate = '';
    if (createdAt) {
      try {
        const d = new Date(createdAt);
        orderDate = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      } catch { continue; }
    }
    if (!orderDate) continue;

    // Skip if already exists (number+date identity)
    if (knownKeys.has(ssOrderKey(orderNumber, orderDate))) continue;

    const totalCents = Math.round((order.totalPrice || 0) * 100);
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

    const fulfillmentStatus = order.status === 'SHIPPED' ? 'fulfilled'
      : order.status === 'NEW' ? 'unfulfilled'
      : (order.status || '').toLowerCase();

    let chargeCents = 0;
    let isEstimate = 0;
    if (order.billingCharges && order.billingCharges.length > 0) {
      for (const bc of order.billingCharges) {
        if (bc.status === 'VOIDED') continue;
        chargeCents += Math.round((excludeLabelCost ? bc.markup : bc.totalCharge) * 100);
      }
    } else if (isPerSku && lineItems.length > 0) {
      // Simple estimate: use first SKU rate
      for (const li of lineItems) {
        const rate = chinaRateMap.get(li.sku);
        if (rate) {
          chargeCents += Math.round(((rate.pickFee || 0) + (rate.packFee || 0)) * 100);
          isEstimate = 1;
        }
      }
    }

    insertStmt.run(
      crypto.randomUUID(), storeId, orderNumber, `#${orderNumber}`, createdAt,
      orderDate, 'paid', fulfillmentStatus, totalCents, totalCents,
      0, 0, 0, 0, totalCents,
      lineItemsJson, lineItems.length, null,
      chargeCents, isEstimate
    );
    knownKeys.add(ssOrderKey(orderNumber, orderDate));
    imported++;
  }

  // Recalc daily_pnl revenue if we imported new orders
  if (imported > 0) {
    const days: any[] = db.prepare(`
      SELECT order_date as date, SUM(net_revenue_cents) as revenue, COUNT(*) as orders
      FROM orders WHERE store_id = ? GROUP BY order_date
    `).all(storeId);
    for (const day of days) {
      const pnl: any = db.prepare(
        'SELECT id, ad_spend_cents, shopify_fees_cents, other_costs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, chargeback_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
      ).get(storeId, day.date);
      if (pnl) {
        const shopifyFee = Math.round((day.revenue || 0) * 0.026) + ((day.orders || 0) * 30);
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
      } else {
        const shopifyFee = Math.round((day.revenue || 0) * 0.026) + ((day.orders || 0) * 30);
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
      }
    }
  }

  return { imported };
}

/** All active SS-connected stores, errors surfaced (never swallowed). */
export async function pullNewOrdersAllStores(): Promise<{ imported: number; errors: string[] }> {
  const db = getDb();
  const stores: any[] = db.prepare(
    "SELECT id, name, shipsourced_client_id FROM stores WHERE is_active = 1 AND shipsourced_client_id IS NOT NULL"
  ).all();
  let imported = 0;
  const errors: string[] = [];
  for (const s of stores) {
    try {
      const r = await pullNewOrders(s.id, s.shipsourced_client_id);
      imported += r.imported;
    } catch (e: any) {
      errors.push(`${s.name}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return { imported, errors };
}
