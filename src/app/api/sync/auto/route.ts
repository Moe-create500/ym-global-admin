import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStaleStores, syncStore, syncFacebookAds } from '@/lib/sync';
import { getNewClientOrders, getClientBillingConfig, getAllClientOrdersList } from '@/lib/shipsourced';
import { getDisputes } from '@/lib/chargeflow';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Pull new ShipSourced orders incrementally for a store
async function pullNewOrders(storeId: string, clientId: string) {
  const db = getDb();

  const knownRows: any[] = db.prepare('SELECT order_number FROM orders WHERE store_id = ?').all(storeId);
  const knownOrderNumbers = new Set(knownRows.map((r: any) => r.order_number));

  const [ssOrders, billingConfig] = await Promise.all([
    getNewClientOrders(clientId, knownOrderNumbers),
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

    // Skip if already exists
    if (knownOrderNumbers.has(orderNumber)) continue;

    const createdAt = order.orderDate || order.createdAt || '';
    let orderDate = '';
    if (createdAt) {
      try {
        const d = new Date(createdAt);
        orderDate = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      } catch { continue; }
    }
    if (!orderDate) continue;

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
    knownOrderNumbers.add(orderNumber);
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
      }
    }
  }

  return { imported };
}

// Update fulfillment statuses for orders still marked as unfulfilled
async function updateUnfulfilledStatuses(storeId: string, clientId: string) {
  const db = getDb();

  // Get order numbers that are still unfulfilled locally
  const unfulfilled: any[] = db.prepare(
    "SELECT order_number FROM orders WHERE store_id = ? AND fulfillment_status IN ('unfulfilled', 'partial')"
  ).all(storeId);

  if (unfulfilled.length === 0) return { updated: 0 };

  const unfulfilledMap = new Map(unfulfilled.map((r: any) => [r.order_number, true]));

  // Pull all orders from ShipSourced and check statuses
  const ssOrders = await getAllClientOrdersList(clientId);

  const updateStmt = db.prepare(
    'UPDATE orders SET fulfillment_status = ?, ss_charge_is_estimate = 0 WHERE store_id = ? AND order_number = ?'
  );

  let updated = 0;
  for (const order of ssOrders) {
    const rawExtId = order.externalOrderId || '';
    const hashIdx = rawExtId.lastIndexOf('#');
    let orderNumber = hashIdx >= 0 ? rawExtId.slice(hashIdx + 1) : rawExtId;
    orderNumber = orderNumber.replace(/^(SHIPHERO-|SH-)?/, '').trim();
    if (!orderNumber || !unfulfilledMap.has(orderNumber)) continue;

    const newStatus = order.status === 'SHIPPED' ? 'fulfilled'
      : order.status === 'NEW' ? 'unfulfilled'
      : (order.status || '').toLowerCase();

    if (newStatus !== 'unfulfilled' && newStatus !== 'partial') {
      updateStmt.run(newStatus, storeId, orderNumber);
      updated++;
    }
  }

  return { updated };
}

// Called by the dashboard on load to sync stale stores + Facebook ads
export async function POST() {
  const stale = getStaleStores(60); // stores not synced in last 60 minutes

  const results = [];
  for (const store of stale) {
    const result = await syncStore(store.id);
    results.push(result);
  }

  // Pull new ShipSourced orders for ALL active stores (fast — incremental)
  const db = getDb();
  const activeStores: any[] = db.prepare(
    'SELECT id, shipsourced_client_id FROM stores WHERE is_active = 1 AND shipsourced_client_id IS NOT NULL'
  ).all();

  let totalPulled = 0;
  let totalStatusUpdated = 0;
  for (const s of activeStores) {
    try {
      const pullResult = await pullNewOrders(s.id, s.shipsourced_client_id);
      totalPulled += pullResult.imported;
    } catch {}
    try {
      const statusResult = await updateUnfulfilledStatuses(s.id, s.shipsourced_client_id);
      totalStatusUpdated += statusResult.updated;
    } catch {}
  }

  // Sync Chargeflow disputes for stores with API keys
  const cfStores: any[] = db.prepare(
    'SELECT id, name, chargeflow_api_key FROM stores WHERE is_active = 1 AND chargeflow_api_key IS NOT NULL'
  ).all();

  let cfImported = 0;
  for (const s of cfStores) {
    try {
      // Pull recent pages only (first 5 pages = 500 disputes) for regular syncs
      // New disputes appear on page 1, so this catches all recent activity
      const maxPages = 5;
      let page = 1;
      let storeImported = 0;

      while (page <= maxPages) {
        const data = await getDisputes(s.chargeflow_api_key, page, 100);
        if (!data.disputes || data.disputes.length === 0) break;

        let allKnown = true;
        for (const d of data.disputes) {
          const chargebackDate = d.created_at.substring(0, 10);
          const amountCents = Math.round(d.amount * 100);
          const status = d.status === 'won' ? 'won' : d.status === 'lost' ? 'lost' : 'open';

          const existing: any = db.prepare(
            'SELECT id, status FROM chargebacks WHERE store_id = ? AND dispute_id = ?'
          ).get(s.id, d.id);

          if (existing) {
            if (existing.status !== status) {
              db.prepare('UPDATE chargebacks SET status = ?, amount_cents = ?, reason = ?, updated_at = datetime(\'now\') WHERE id = ?')
                .run(status, amountCents, d.reason || null, existing.id);
              storeImported++;
              allKnown = false;
            }
          } else {
            db.prepare(`
              INSERT INTO chargebacks (id, store_id, dispute_id, order_number, chargeback_date, amount_cents, reason, status, source, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'chargeflow', ?)
            `).run(crypto.randomUUID(), s.id, d.id, d.order || null, chargebackDate, amountCents, d.reason || null, status, d.stage || null);
            storeImported++;
            allKnown = false;
          }
        }

        // Stop early if all disputes on this page were already known
        if (allKnown) break;
        if (data.disputes.length < 100) break;
        page++;
      }

      cfImported += storeImported;

      // Rollup lost chargebacks into P&L
      if (storeImported > 0) {
        const days: any[] = db.prepare(`
          SELECT chargeback_date as date, SUM(amount_cents) as total
          FROM chargebacks WHERE store_id = ? AND status = 'lost' GROUP BY chargeback_date
        `).all(s.id);
        db.prepare('UPDATE daily_pnl SET chargeback_cents = 0 WHERE store_id = ?').run(s.id);
        for (const day of days) {
          const pnl: any = db.prepare(
            'SELECT id, revenue_cents, ad_spend_cents, shipping_cost_cents, shopify_fees_cents, pick_pack_cents, packaging_cents, other_costs_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
          ).get(s.id, day.date);
          if (pnl) {
            const totalCosts = (pnl.shipping_cost_cents || 0) + (pnl.pick_pack_cents || 0) +
              (pnl.packaging_cents || 0) + (pnl.ad_spend_cents || 0) + (pnl.shopify_fees_cents || 0) +
              (pnl.other_costs_cents || 0) + (pnl.app_costs_cents || 0) + day.total;
            const netProfit = (pnl.revenue_cents || 0) - totalCosts;
            const margin = pnl.revenue_cents > 0 ? (netProfit / pnl.revenue_cents) * 100 : 0;
            db.prepare('UPDATE daily_pnl SET chargeback_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime(\'now\') WHERE id = ?')
              .run(day.total, netProfit, margin, pnl.id);
          }
        }
      }

      console.log(`[chargeflow] ${s.name}: ${storeImported} imported/updated`);
    } catch (cfErr: any) {
      console.error(`[chargeflow] ${s.name}: ${cfErr.message}`);
    }
  }

  // Also sync Facebook ad spend for any profiles not synced in last 60 minutes
  const fbResult = await syncFacebookAds(60);

  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const anythingSynced = stale.length > 0 || fbResult.synced > 0 || totalPulled > 0 || cfImported > 0 || totalStatusUpdated > 0;

  if (!anythingSynced) {
    return NextResponse.json({ synced: false, message: 'All stores up to date' });
  }

  return NextResponse.json({
    synced: true,
    staleStores: stale.length,
    recordsSynced: totalSynced,
    ordersPulled: totalPulled,
    ordersStatusUpdated: totalStatusUpdated,
    chargeflowSynced: cfImported,
    fbAdsSynced: fbResult.synced,
    fbInvoicesImported: fbResult.invoicesImported,
    results,
  });
}
