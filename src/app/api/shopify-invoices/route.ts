import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Roll up app costs (Shopify subs + Chargeflow charges) into daily_pnl
function rollUpAppCosts(db: any, storeId: string) {
  // Sum invoice totals by date, excluding CF-via-Shopify (already in Shopify bills)
  const days: any[] = db.prepare(`
    SELECT date, SUM(total_cents) as app_costs
    FROM shopify_invoices
    WHERE store_id = ?
      AND NOT (source = 'chargeflow' AND payment_method LIKE '%shopify%')
    GROUP BY date
  `).all(storeId);

  // Reset app_costs_cents for this store
  db.prepare('UPDATE daily_pnl SET app_costs_cents = 0 WHERE store_id = ?').run(storeId);

  for (const day of days) {
    const pnl: any = db.prepare(
      'SELECT id, revenue_cents, ad_spend_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, shopify_fees_cents, other_costs_cents, chargeback_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
    ).get(storeId, day.date);

    if (pnl) {
      const totalCosts = (pnl.shipping_cost_cents || 0) + (pnl.pick_pack_cents || 0) +
        (pnl.packaging_cents || 0) + (pnl.ad_spend_cents || 0) + (pnl.shopify_fees_cents || 0) +
        (pnl.other_costs_cents || 0) + (pnl.chargeback_cents || 0) + day.app_costs;
      const netProfit = (pnl.revenue_cents || 0) - totalCosts;
      const margin = pnl.revenue_cents > 0 ? (netProfit / pnl.revenue_cents) * 100 : 0;
      db.prepare('UPDATE daily_pnl SET app_costs_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(day.app_costs, netProfit, margin, pnl.id);
    } else {
      // Create a new P&L row for dates that only have invoices
      const netProfit = -day.app_costs;
      db.prepare(`
        INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count,
          cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents,
          ad_spend_cents, shopify_fees_cents, other_costs_cents, chargeback_cents,
          app_costs_cents, net_profit_cents, margin_pct, source)
        VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, 0, 'invoices')
      `).run(crypto.randomUUID(), storeId, day.date, day.app_costs, netProfit);
    }
  }
}

// Parse CSV line handling quoted fields
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseDate(raw: string): string {
  if (!raw) return '';
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // M/D/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [m, d, y] = raw.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // ISO datetime
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch {}
  return '';
}

// Detect CSV format from headers
function detectFormat(headers: string[]): 'shopify' | 'chargeflow' | null {
  const joined = headers.join(',').toLowerCase();
  if (joined.includes('bill') && joined.includes('charge category')) return 'shopify';
  if (joined.includes('number') && joined.includes('product') && joined.includes('paymentmethod')) return 'chargeflow';
  // Fallback: check for Chargeflow-style columns
  if (headers.some(h => h.toLowerCase().includes('fromdate'))) return 'chargeflow';
  if (headers.some(h => h.toLowerCase().includes('bill'))) return 'shopify';
  return null;
}

function parseShopifyChargesCsv(lines: string[], headers: string[]) {
  const billIdx = headers.findIndex(h => h.includes('bill'));
  const dateIdx = headers.findIndex(h => h === 'date');
  const categoryIdx = headers.findIndex(h => h.includes('charge category') || h.includes('category'));
  const descIdx = headers.findIndex(h => h === 'description');
  const amountIdx = headers.findIndex(h => h === 'amount');
  const currencyIdx = headers.findIndex(h => h === 'currency');
  const appIdx = headers.findIndex(h => h === 'app');
  const startIdx = headers.findIndex(h => h.includes('start of billing'));
  const endIdx = headers.findIndex(h => h.includes('end of billing'));

  if (billIdx === -1 || dateIdx === -1 || amountIdx === -1) {
    return { invoices: [], error: 'Could not find Bill #, Date, and Amount columns' };
  }

  const billMap = new Map<string, {
    date: string;
    items: { category: string; description: string; appName: string; amountCents: number; currency: string; billingStart: string; billingEnd: string }[];
  }>();

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const billNumber = fields[billIdx]?.trim();
    if (!billNumber) continue;

    const date = parseDate(fields[dateIdx]?.trim() || '');
    if (!date) continue;

    const rawAmount = fields[amountIdx]?.trim().replace(/[$",]/g, '') || '0';
    const amount = parseFloat(rawAmount);
    const amountCents = Math.round((isNaN(amount) ? 0 : amount) * 100);

    const category = categoryIdx >= 0 ? (fields[categoryIdx]?.trim() || '') : '';
    const description = descIdx >= 0 ? (fields[descIdx]?.trim() || '') : '';
    const appName = appIdx >= 0 ? (fields[appIdx]?.trim() || '') : '';
    const currency = currencyIdx >= 0 ? (fields[currencyIdx]?.trim() || 'USD') : 'USD';
    const billingStart = startIdx >= 0 ? (fields[startIdx]?.trim() || '') : '';
    const billingEnd = endIdx >= 0 ? (fields[endIdx]?.trim() || '') : '';

    if (!billMap.has(billNumber)) {
      billMap.set(billNumber, { date, items: [] });
    }
    billMap.get(billNumber)!.items.push({ category, description, appName, amountCents, currency, billingStart, billingEnd });
  }

  type InvResult = {
    billNumber: string; date: string; totalCents: number; source: string;
    paymentMethod: string | null; paid: boolean;
    items: { category: string; description: string; appName: string; amountCents: number; currency: string; billingStart: string; billingEnd: string }[];
  };
  const invoices: InvResult[] = [];

  const entries = Array.from(billMap.entries());
  for (const [billNumber, bill] of entries) {
    const totalCents = bill.items.reduce((s: number, it: any) => s + it.amountCents, 0);
    invoices.push({
      billNumber, date: bill.date, totalCents, source: 'shopify',
      paymentMethod: null, paid: false, items: bill.items,
    });
  }

  return { invoices, error: null };
}

function parseChargeflowCsv(lines: string[], headers: string[]) {
  const idIdx = headers.findIndex(h => h === 'id');
  const numberIdx = headers.findIndex(h => h === 'number');
  const fromIdx = headers.findIndex(h => h === 'fromdate');
  const toIdx = headers.findIndex(h => h === 'todate');
  const createdIdx = headers.findIndex(h => h === 'createddate');
  const currencyIdx = headers.findIndex(h => h === 'currency');
  const amountIdx = headers.findIndex(h => h === 'amount');
  const statusIdx = headers.findIndex(h => h === 'status');
  const productIdx = headers.findIndex(h => h === 'product');
  const payTypeIdx = headers.findIndex(h => h === 'paymentmethod.type');
  const payNameIdx = headers.findIndex(h => h === 'paymentmethod.name');

  if (amountIdx === -1) {
    return { invoices: [], error: 'Could not find amount column' };
  }

  const invoices: {
    billNumber: string; date: string; totalCents: number; source: string;
    paymentMethod: string | null; paid: boolean;
    items: { category: string; description: string; appName: string; amountCents: number; currency: string; billingStart: string; billingEnd: string }[];
  }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const invoiceId = idIdx >= 0 ? (fields[idIdx]?.trim() || '') : '';
    const number = numberIdx >= 0 ? (fields[numberIdx]?.trim() || '') : '';
    const billNumber = number || invoiceId || `cf-${i}`;

    const date = parseDate(fields[createdIdx >= 0 ? createdIdx : fromIdx]?.trim() || '');
    if (!date) continue;

    const rawAmount = fields[amountIdx]?.trim().replace(/[$",]/g, '') || '0';
    const amount = parseFloat(rawAmount);
    if (isNaN(amount) || amount <= 0) continue;
    const amountCents = Math.round(amount * 100);

    const currency = currencyIdx >= 0 ? (fields[currencyIdx]?.trim() || 'USD').toUpperCase() : 'USD';
    const product = productIdx >= 0 ? (fields[productIdx]?.trim() || '') : '';
    const status = statusIdx >= 0 ? (fields[statusIdx]?.trim() || '') : '';
    const payType = payTypeIdx >= 0 ? (fields[payTypeIdx]?.trim() || '') : '';
    const payName = payNameIdx >= 0 ? (fields[payNameIdx]?.trim() || '') : '';
    const billingStart = fromIdx >= 0 ? parseDate(fields[fromIdx]?.trim() || '') : '';
    const billingEnd = toIdx >= 0 ? parseDate(fields[toIdx]?.trim() || '') : '';

    const paymentMethod = [payType, payName].filter(Boolean).join(' — ') || null;

    invoices.push({
      billNumber, date, totalCents: amountCents, source: 'chargeflow',
      paymentMethod, paid: status === 'paid',
      items: [{
        category: product || 'chargeflow',
        description: `Chargeflow ${product}`,
        appName: 'Chargeflow',
        amountCents,
        currency,
        billingStart,
        billingEnd,
      }],
    });
  }

  return { invoices, error: null };
}

// POST: Import invoices CSV (auto-detects Shopify or Chargeflow)
export async function POST(req: NextRequest) {
  const { storeId, csvText, source: forcedSource } = await req.json();
  if (!storeId || !csvText) {
    return NextResponse.json({ error: 'storeId and csvText required' }, { status: 400 });
  }

  const db = getDb();
  const store: any = db.prepare('SELECT id FROM stores WHERE id = ?').get(storeId);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  const lines = csvText.split('\n').map((l: string) => l.trim()).filter(Boolean);
  if (lines.length < 2) return NextResponse.json({ error: 'CSV too short' }, { status: 400 });

  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const format = forcedSource || detectFormat(headers);

  if (!format) {
    return NextResponse.json({ error: 'Could not detect CSV format. Expected Shopify charges or Chargeflow invoices.' }, { status: 400 });
  }

  let parsed;
  if (format === 'chargeflow') {
    parsed = parseChargeflowCsv(lines, headers);
  } else {
    parsed = parseShopifyChargesCsv(lines, headers);
  }

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  let imported = 0;
  let duplicates = 0;
  let totalItems = 0;

  const insertInvoice = db.prepare(`
    INSERT INTO shopify_invoices (id, store_id, bill_number, date, total_cents, item_count, currency, source, payment_method, paid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO shopify_invoice_items (id, invoice_id, category, description, app_name, amount_cents, currency, billing_start, billing_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const inv of parsed.invoices) {
    const existing = db.prepare('SELECT id FROM shopify_invoices WHERE store_id = ? AND bill_number = ?').get(storeId, inv.billNumber);
    if (existing) { duplicates++; continue; }

    const invoiceId = crypto.randomUUID();
    insertInvoice.run(invoiceId, storeId, inv.billNumber, inv.date, inv.totalCents, inv.items.length,
      inv.items[0]?.currency || 'USD', inv.source, inv.paymentMethod, inv.paid ? 1 : 0);

    for (const item of inv.items) {
      insertItem.run(crypto.randomUUID(), invoiceId, item.category, item.description, item.appName,
        item.amountCents, item.currency, item.billingStart, item.billingEnd);
      totalItems++;
    }
    imported++;
  }

  // Rollup app costs into daily_pnl
  if (imported > 0) {
    rollUpAppCosts(db, storeId);
  }

  return NextResponse.json({
    success: true, format, imported, duplicates, totalItems,
    total: parsed.invoices.length,
  });
}

// GET: List invoices with items
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();

  const invoices: any[] = db.prepare(`
    SELECT * FROM shopify_invoices WHERE store_id = ? ORDER BY date DESC
  `).all(storeId);

  const itemStmt = db.prepare('SELECT * FROM shopify_invoice_items WHERE invoice_id = ? ORDER BY amount_cents DESC');
  const result = invoices.map(inv => ({
    ...inv,
    items: itemStmt.all(inv.id),
  }));

  // Summary by app — exclude Chargeflow invoices paid via Shopify (already in Shopify bills)
  const appSummary: any[] = db.prepare(`
    SELECT i.app_name, COUNT(*) as count, SUM(i.amount_cents) as total_cents
    FROM shopify_invoice_items i
    JOIN shopify_invoices inv ON inv.id = i.invoice_id
    WHERE inv.store_id = ?
      AND NOT (inv.source = 'chargeflow' AND inv.payment_method LIKE '%shopify%')
    GROUP BY i.app_name
    ORDER BY total_cents DESC
  `).all(storeId);

  // Summary by source — exclude Chargeflow invoices paid via Shopify
  const sourceSummary: any[] = db.prepare(`
    SELECT source, COUNT(*) as count, SUM(total_cents) as total_cents
    FROM shopify_invoices WHERE store_id = ?
      AND NOT (source = 'chargeflow' AND payment_method LIKE '%shopify%')
    GROUP BY source
    ORDER BY total_cents DESC
  `).all(storeId);

  // Totals — exclude Chargeflow invoices paid via Shopify (already in Shopify bills)
  const totals: any = db.prepare(`
    SELECT SUM(total_cents) as total_cents, COUNT(*) as invoice_count,
      SUM(CASE WHEN paid = 1 THEN total_cents ELSE 0 END) as paid_cents,
      SUM(CASE WHEN paid = 0 THEN total_cents ELSE 0 END) as unpaid_cents,
      SUM(CASE WHEN source = 'chargeflow' AND payment_method LIKE '%shopify%' THEN total_cents ELSE 0 END) as cf_shopify_cents,
      SUM(CASE WHEN source = 'chargeflow' AND payment_method LIKE '%shopify%' THEN 1 ELSE 0 END) as cf_shopify_count
    FROM shopify_invoices WHERE store_id = ?
  `).get(storeId);

  // Monthly charges breakdown
  const monthlyTotals: any[] = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, COUNT(*) as invoice_count, SUM(total_cents) as total_cents
    FROM shopify_invoices WHERE store_id = ?
      AND NOT (source = 'chargeflow' AND payment_method LIKE '%shopify%')
    GROUP BY strftime('%Y-%m', date)
    ORDER BY month DESC
  `).all(storeId);

  return NextResponse.json({ invoices: result, appSummary, sourceSummary, totals, monthlyTotals });
}

// PATCH: Update invoice payment info (single or bulk)
export async function PATCH(req: NextRequest) {
  const body = await req.json();

  // Bulk update: { ids: [...], paymentMethod, cardLast4, paid, paidDate }
  if (body.ids && Array.isArray(body.ids)) {
    const { ids, paymentMethod, cardLast4, paid, paidDate } = body;
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE shopify_invoices SET payment_method = ?, card_last4 = ?, paid = ?, paid_date = ?
      WHERE id = ?
    `);
    const storeIds = new Set<string>();
    for (const id of ids) {
      const inv: any = db.prepare('SELECT store_id FROM shopify_invoices WHERE id = ?').get(id);
      if (inv?.store_id) storeIds.add(inv.store_id);
      stmt.run(paymentMethod || null, cardLast4 || null, paid ? 1 : 0, paidDate || null, id);
    }
    for (const sid of storeIds) {
      rollUpAppCosts(db, sid);
    }
    return NextResponse.json({ success: true, updated: ids.length });
  }

  // Single update
  const { id, paymentMethod, cardLast4, paid, paidDate, notes } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const inv: any = db.prepare('SELECT store_id FROM shopify_invoices WHERE id = ?').get(id);
  db.prepare(`
    UPDATE shopify_invoices SET payment_method = ?, card_last4 = ?, paid = ?, paid_date = ?, notes = ?
    WHERE id = ?
  `).run(paymentMethod || null, cardLast4 || null, paid ? 1 : 0, paidDate || null, notes || null, id);

  if (inv?.store_id) {
    rollUpAppCosts(db, inv.store_id);
  }

  return NextResponse.json({ success: true });
}

// DELETE: Delete invoice and its items
export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const inv: any = db.prepare('SELECT store_id FROM shopify_invoices WHERE id = ?').get(id);
  db.prepare('DELETE FROM shopify_invoice_items WHERE invoice_id = ?').run(id);
  db.prepare('DELETE FROM shopify_invoices WHERE id = ?').run(id);

  // Re-rollup app costs after deletion
  if (inv?.store_id) {
    rollUpAppCosts(db, inv.store_id);
  }

  return NextResponse.json({ success: true });
}
