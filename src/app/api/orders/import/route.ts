import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { computePnl } from '@/lib/finance-core';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCents(val: string): number {
  const n = parseFloat(val || '0');
  return isNaN(n) ? 0 : Math.round(n * 100);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, csvText } = body;

  if (!storeId || !csvText) {
    return NextResponse.json({ error: 'storeId and csvText required' }, { status: 400 });
  }

  const db = getDb();
  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
  }

  // Group rows by Name (order number) — Shopify multi-row format
  const orderMap: Record<string, {
    name: string;
    createdAt: string;
    financialStatus: string;
    fulfillmentStatus: string;
    total: number;
    subtotal: number;
    shipping: number;
    taxes: number;
    discount: number;
    refunded: number;
    email: string;
    currency: string;
    lineItems: { name: string; qty: number; priceCents: number; sku: string }[];
  }> = {};

  for (const row of rows) {
    const name = row['Name'] || '';
    if (!name) continue;

    if (!orderMap[name]) {
      // First row for this order — has header fields
      orderMap[name] = {
        name,
        createdAt: row['Created at'] || '',
        financialStatus: (row['Financial Status'] || '').toLowerCase(),
        fulfillmentStatus: (row['Fulfillment Status'] || '').toLowerCase(),
        total: parseCents(row['Total']),
        subtotal: parseCents(row['Subtotal']),
        shipping: parseCents(row['Shipping']),
        taxes: parseCents(row['Taxes']),
        discount: parseCents(row['Discount Amount']),
        refunded: parseCents(row['Refunded Amount']),
        email: row['Email'] || '',
        currency: row['Currency'] || 'USD',
        lineItems: [],
      };
    }

    // Every row (including first) can have line item data
    const itemName = row['Lineitem name'] || '';
    if (itemName) {
      orderMap[name].lineItems.push({
        name: itemName,
        qty: parseInt(row['Lineitem quantity'] || '1') || 1,
        priceCents: parseCents(row['Lineitem price']),
        sku: row['Lineitem sku'] || '',
      });
    }
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  const insertStmt = db.prepare(`
    INSERT INTO orders (id, store_id, order_number, order_name, created_at_shopify,
      order_date, financial_status, fulfillment_status, total_cents, subtotal_cents,
      shipping_cents, taxes_cents, discount_cents, refunded_cents, net_revenue_cents,
      line_items, line_item_count, customer_email, currency, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv_import')
  `);

  const updateStmt = db.prepare(`
    UPDATE orders SET
      created_at_shopify = ?, order_date = ?, financial_status = ?, fulfillment_status = ?,
      total_cents = ?, subtotal_cents = ?, shipping_cents = ?, taxes_cents = ?,
      discount_cents = ?, refunded_cents = ?, net_revenue_cents = ?,
      line_items = ?, line_item_count = ?, customer_email = ?, currency = ?
    WHERE store_id = ? AND order_number = ?
  `);

  for (const [name, order] of Object.entries(orderMap)) {
    if (!order.createdAt) { skipped++; continue; }

    // Extract order_number (strip #)
    const orderNumber = name.replace(/^#/, '');

    // Extract local date from Created at (e.g., "2026-03-14 23:45:01 -0700" → "2026-03-14")
    const orderDate = order.createdAt.substring(0, 10);
    if (!orderDate || orderDate.length !== 10) { skipped++; continue; }

    const netRevenue = order.total - order.refunded;
    const lineItemsJson = JSON.stringify(order.lineItems);

    const existing: any = db.prepare(
      'SELECT id FROM orders WHERE store_id = ? AND order_number = ?'
    ).get(storeId, orderNumber);

    if (existing) {
      updateStmt.run(
        order.createdAt, orderDate, order.financialStatus || null, order.fulfillmentStatus || null,
        order.total, order.subtotal, order.shipping, order.taxes,
        order.discount, order.refunded, netRevenue,
        lineItemsJson, order.lineItems.length, order.email || null, order.currency,
        storeId, orderNumber
      );
      updated++;
    } else {
      insertStmt.run(
        crypto.randomUUID(), storeId, orderNumber, name, order.createdAt,
        orderDate, order.financialStatus || null, order.fulfillmentStatus || null,
        order.total, order.subtotal, order.shipping, order.taxes,
        order.discount, order.refunded, netRevenue,
        lineItemsJson, order.lineItems.length, order.email || null, order.currency
      );
      imported++;
    }
  }

  // Recalculate daily_pnl revenue from orders
  const dailyTotals: any[] = db.prepare(`
    SELECT order_date as date, SUM(net_revenue_cents) as revenue, COUNT(*) as orders
    FROM orders WHERE store_id = ? GROUP BY order_date
  `).all(storeId);

  let recalculated = 0;

  for (const day of dailyTotals) {
    const existing: any = db.prepare(
      'SELECT id, refunds_cents, cogs_cents, ad_spend_cents, shopify_fees_cents, other_costs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, chargeback_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
    ).get(storeId, day.date);

    if (existing) {
      // This write also sets source = 'csv_import', so compute with that source
      const { netProfitCents: netProfit, marginPct: margin } = computePnl({
        ...existing, revenue_cents: day.revenue, source: 'csv_import',
      });

      db.prepare(`
        UPDATE daily_pnl SET
          revenue_cents = ?, order_count = ?,
          net_profit_cents = ?, margin_pct = ?,
          source = 'csv_import', updated_at = datetime('now')
        WHERE id = ?
      `).run(day.revenue, day.orders, netProfit, margin, existing.id);
    } else {
      // New row: calculate Shopify fee (2.6% + $0.30/txn)
      const shopifyFee = Math.round(day.revenue * 0.026) + ((day.orders || 0) * 30);
      const { netProfitCents: netProfit, marginPct: margin } = computePnl({
        revenue_cents: day.revenue, shopify_fees_cents: shopifyFee, source: 'csv_import',
      });
      db.prepare(`
        INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count,
          cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents,
          ad_spend_cents, shopify_fees_cents, other_costs_cents,
          net_profit_cents, margin_pct, source)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, 0, ?, ?, 'csv_import')
      `).run(crypto.randomUUID(), storeId, day.date, day.revenue, day.orders,
        shopifyFee, netProfit, margin);
    }
    recalculated++;
  }

  // Re-roll up ad_spend into daily_pnl (may have been zeroed during insert)
  const adDays: any[] = db.prepare(`
    SELECT date, SUM(spend_cents) as total FROM ad_spend
    WHERE store_id = ? AND platform = 'facebook' AND ad_id IS NOT NULL
    GROUP BY date
  `).all(storeId);

  for (const ad of adDays) {
    const pnlRow: any = db.prepare(
      'SELECT id, revenue_cents, refunds_cents, source, cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, shopify_fees_cents, other_costs_cents, chargeback_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
    ).get(storeId, ad.date);
    if (pnlRow) {
      const { netProfitCents: netProfit, marginPct: margin } = computePnl({ ...pnlRow, ad_spend_cents: ad.total });
      db.prepare('UPDATE daily_pnl SET ad_spend_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(ad.total, netProfit, margin, pnlRow.id);
    }
  }

  // Re-calculate Shopify fees from revenue (2.6% + $0.30/txn)
  const pnlDays: any[] = db.prepare(
    'SELECT id, date, revenue_cents, refunds_cents, source, order_count, cogs_cents, ad_spend_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, other_costs_cents, chargeback_cents, app_costs_cents FROM daily_pnl WHERE store_id = ?'
  ).all(storeId);
  for (const row of pnlDays) {
    const shopifyFee = Math.round((row.revenue_cents || 0) * 0.026) + ((row.order_count || 0) * 30);
    const { netProfitCents: netProfit, marginPct: margin } = computePnl({ ...row, shopify_fees_cents: shopifyFee });
    db.prepare('UPDATE daily_pnl SET shopify_fees_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(shopifyFee, netProfit, margin, row.id);
  }

  return NextResponse.json({
    success: true,
    imported,
    updated,
    skipped,
    total: Object.keys(orderMap).length,
    recalculated,
  });
}
