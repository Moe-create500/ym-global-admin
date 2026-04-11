import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Parse Facebook Meta invoice CSV
// Handles TWO formats:
//   Format A (multi-card): Date, Transaction ID, Payment Method, Amount, Currency
//   Format B (single-card): Date, Transaction ID, Amount, Currency
//     (has "Payment Method: ..." in header section for the single card)
function parseFacebookCsv(csvText: string) {
  const lines = csvText.split('\n').map(l => l.trim());
  const payments: Array<{
    date: string;
    transactionId: string;
    paymentMethod: string;
    cardLast4: string;
    amountCents: number;
    currency: string;
    accountId: string;
  }> = [];

  // Extract account ID from header (line 5 typically: "Account: 1258726519186261,...")
  let accountId = '';
  let defaultPaymentMethod = '';
  let defaultCardLast4 = '';
  for (const line of lines.slice(0, 15)) {
    const accMatch = line.match(/Account:\s*(\d+)/);
    if (accMatch) {
      accountId = accMatch[1];
    }
    // "Payment Method: American Express ···· 2976" line (single-card accounts)
    const pmMatch = line.match(/Payment Method:\s*(.+)/);
    if (pmMatch) {
      defaultPaymentMethod = pmMatch[1].trim();
      const cardMatch = defaultPaymentMethod.match(/(\d{4})\s*$/);
      if (cardMatch) defaultCardLast4 = cardMatch[1];
    }
  }

  // Find the header row
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Date,Transaction ID')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return { payments, accountId, error: 'Could not find header row (Date,Transaction ID,...)' };
  }

  // Detect format: check if header has "Payment Method" column
  const headerFields = parseCsvLine(lines[headerIdx]);
  const hasPaymentMethodCol = headerFields.some(h => h.toLowerCase().includes('payment method'));

  // Column indices based on format
  const pmColIdx = hasPaymentMethodCol ? 2 : -1;
  const amountColIdx = hasPaymentMethodCol ? 3 : 2;
  const currencyColIdx = hasPaymentMethodCol ? 4 : 3;

  // Parse data rows after header
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.toLowerCase().includes('total amount billed')) continue;

    // Parse CSV with quoted fields (amounts have commas like "2,000.00")
    const fields = parseCsvLine(line);
    if (fields.length < (hasPaymentMethodCol ? 4 : 3)) continue;

    const dateStr = fields[0];
    const transactionId = fields[1];
    const paymentMethod = pmColIdx >= 0 ? fields[pmColIdx] : defaultPaymentMethod;
    const amountStr = fields[amountColIdx] || '';
    const currency = fields[currencyColIdx] || 'USD';

    // Skip if no date or transaction ID (summary/total rows)
    if (!dateStr || !transactionId) continue;

    // Skip declined
    if (paymentMethod?.toLowerCase().includes('declined') ||
        amountStr?.toLowerCase().includes('declined')) continue;

    // Parse date: M/D/YYYY -> YYYY-MM-DD
    const dateParts = dateStr.split('/');
    if (dateParts.length !== 3) continue;
    const [month, day, year] = dateParts;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    // Parse amount: strip quotes and commas
    const cleanAmount = amountStr.replace(/[",]/g, '').trim();
    const amount = parseFloat(cleanAmount);
    if (isNaN(amount) || amount <= 0) continue;
    const amountCents = Math.round(amount * 100);

    // Extract card last 4 from payment method
    const cardMatch = (paymentMethod || '').match(/(\d{4})\s*$/);
    const cardLast4 = cardMatch ? cardMatch[1] : (defaultCardLast4 || '');

    payments.push({
      date,
      transactionId: transactionId.trim(),
      paymentMethod: (paymentMethod || defaultPaymentMethod || '').trim(),
      cardLast4,
      amountCents,
      currency: (currency || 'USD').trim(),
      accountId,
    });
  }

  return { payments, accountId, error: null };
}

// Parse a CSV line handling quoted fields
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

// Parse Shopify billing/invoice CSV
// Supports formats:
//   1. "Transaction date,Type,Order,Card,Amount" (Shopify payments CSV)
//   2. "Issue date,Bill number,Amount" (Shopify bills CSV)
//   3. Generic: auto-detects date/amount/card columns
function parseShopifyCsv(csvText: string) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  const payments: Array<{
    date: string;
    transactionId: string;
    paymentMethod: string;
    cardLast4: string;
    amountCents: number;
    currency: string;
    accountId: string;
  }> = [];

  if (lines.length < 2) return { payments, accountId: '', error: 'CSV too short' };

  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());

  // Find column indices
  const dateIdx = headers.findIndex(h => h.includes('date') || h === 'issued' || h.includes('issue'));
  const amountIdx = headers.findIndex(h => h === 'amount' || h.includes('total') || h.includes('charge'));
  const typeIdx = headers.findIndex(h => h === 'type' || h.includes('description') || h.includes('bill'));
  const cardIdx = headers.findIndex(h => h.includes('card') || h.includes('payment'));
  const orderIdx = headers.findIndex(h => h === 'order' || h.includes('transaction') || h.includes('reference') || h.includes('number') || h.includes('bill number'));

  if (dateIdx === -1 || amountIdx === -1) {
    return { payments, accountId: '', error: 'Could not find Date and Amount columns in CSV' };
  }

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length <= Math.max(dateIdx, amountIdx)) continue;

    const rawDate = fields[dateIdx]?.trim();
    const rawAmount = fields[amountIdx]?.trim();
    if (!rawDate || !rawAmount) continue;

    // Parse date — try YYYY-MM-DD, MM/DD/YYYY, M/D/YYYY
    let date = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      date = rawDate;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) {
      const [m, d, y] = rawDate.split('/');
      date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    } else {
      // Try parsing with Date
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          date = d.toISOString().split('T')[0];
        }
      } catch {}
    }
    if (!date) continue;

    // Parse amount
    const cleanAmount = rawAmount.replace(/[$",]/g, '').trim();
    const amount = parseFloat(cleanAmount);
    if (isNaN(amount) || amount <= 0) continue;
    const amountCents = Math.round(amount * 100);

    // Transaction ID: use order/bill number column or generate from row
    const txnField = orderIdx >= 0 ? (fields[orderIdx]?.trim() || '') : '';
    const transactionId = txnField || `shopify-${date}-${i}`;

    // Type/description
    const typeField = typeIdx >= 0 ? (fields[typeIdx]?.trim() || '') : '';

    // Card info
    const cardField = cardIdx >= 0 ? (fields[cardIdx]?.trim() || '') : '';
    const cardMatch = cardField.match(/(\d{4})\s*$/);
    const cardLast4 = cardMatch ? cardMatch[1] : '';

    const paymentMethod = [typeField, cardField].filter(Boolean).join(' — ') || 'Shopify';

    payments.push({
      date,
      transactionId,
      paymentMethod,
      cardLast4,
      amountCents,
      currency: 'USD',
      accountId: '',
    });
  }

  return { payments, accountId: '', error: null };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, platform, csvText } = body;

  if (!storeId || !platform || !csvText) {
    return NextResponse.json({ error: 'storeId, platform, and csvText are required' }, { status: 400 });
  }

  const db = getDb();

  // Verify store exists
  const store: any = db.prepare('SELECT id, name FROM stores WHERE id = ?').get(storeId);
  if (!store) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  }

  let parsed;
  if (platform === 'facebook') {
    parsed = parseFacebookCsv(csvText);
  } else if (platform === 'shopify' || platform === 'google') {
    parsed = parseShopifyCsv(csvText);
  } else {
    return NextResponse.json({ error: `Platform "${platform}" not yet supported` }, { status: 400 });
  }

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  let imported = 0;
  let updated = 0;
  let duplicates = 0;
  let skipped = 0;
  const cardTotals: Record<string, { count: number; totalCents: number }> = {};

  for (const payment of parsed.payments) {
    // Check for existing transaction
    const existing: any = db.prepare(
      'SELECT id, card_last4, payment_method, amount_cents FROM ad_payments WHERE transaction_id = ?'
    ).get(payment.transactionId);

    if (existing) {
      // Update if card info is wrong/missing or amount differs
      const needsUpdate = (payment.cardLast4 && existing.card_last4 !== payment.cardLast4) ||
        (payment.paymentMethod && existing.payment_method !== payment.paymentMethod) ||
        existing.amount_cents !== payment.amountCents;

      if (needsUpdate) {
        db.prepare(`
          UPDATE ad_payments SET card_last4 = ?, payment_method = ?, amount_cents = ?, date = ?
          WHERE id = ?
        `).run(
          payment.cardLast4 || existing.card_last4,
          payment.paymentMethod || existing.payment_method,
          payment.amountCents,
          payment.date,
          existing.id
        );
        updated++;
      } else {
        duplicates++;
      }
    } else {
      db.prepare(`
        INSERT INTO ad_payments (id, store_id, platform, date, transaction_id, payment_method, card_last4, amount_cents, currency, status, account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)
      `).run(
        crypto.randomUUID(), storeId, platform, payment.date,
        payment.transactionId, payment.paymentMethod, payment.cardLast4,
        payment.amountCents, payment.currency, payment.accountId
      );
      imported++;
    }

    // Track card totals
    const cardKey = payment.cardLast4 || 'unknown';
    if (!cardTotals[cardKey]) cardTotals[cardKey] = { count: 0, totalCents: 0 };
    cardTotals[cardKey].count++;
    cardTotals[cardKey].totalCents += payment.amountCents;
  }

  const cardSummary = Object.entries(cardTotals).map(([last4, data]) => ({
    cardLast4: last4,
    count: data.count,
    totalCents: data.totalCents,
  }));

  return NextResponse.json({
    success: true,
    imported,
    updated,
    duplicates,
    skipped,
    total: parsed.payments.length,
    cardSummary,
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  const platform = searchParams.get('platform');
  const cardLast4 = searchParams.get('cardLast4');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const db = getDb();

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (storeId) { where += ' AND p.store_id = ?'; params.push(storeId); }
  if (platform) { where += ' AND p.platform = ?'; params.push(platform); }
  if (cardLast4) { where += ' AND p.card_last4 = ?'; params.push(cardLast4); }
  if (from) { where += ' AND p.date >= ?'; params.push(from); }
  if (to) { where += ' AND p.date <= ?'; params.push(to); }

  const payments = db.prepare(`
    SELECT p.*, s.name as store_name
    FROM ad_payments p
    JOIN stores s ON s.id = p.store_id
    ${where}
    ORDER BY p.date DESC
    LIMIT 500
  `).all(...params);

  // Card summary
  const cardSummary = db.prepare(`
    SELECT
      p.card_last4,
      p.payment_method,
      COUNT(*) as payment_count,
      SUM(p.amount_cents) as total_cents
    FROM ad_payments p
    ${where}
    GROUP BY p.card_last4
    ORDER BY total_cents DESC
  `).all(...params);

  // Platform summary
  const platformSummary = db.prepare(`
    SELECT
      p.platform,
      COUNT(*) as payment_count,
      SUM(p.amount_cents) as total_cents
    FROM ad_payments p
    ${where}
    GROUP BY p.platform
  `).all(...params);

  // Monthly totals
  const monthlyTotals = db.prepare(`
    SELECT
      substr(p.date, 1, 7) as month,
      COUNT(*) as payment_count,
      SUM(p.amount_cents) as total_cents
    FROM ad_payments p
    ${where}
    GROUP BY substr(p.date, 1, 7)
    ORDER BY month DESC
  `).all(...params);

  // Pending amount: ad spend accumulated since last invoiced charge per platform
  let pendingWhere = 'WHERE a.ad_set_id IS NULL';
  const pendingParams: any[] = [];
  if (storeId) { pendingWhere += ' AND a.store_id = ?'; pendingParams.push(storeId); }

  const pendingByPlatform = db.prepare(`
    SELECT
      a.platform,
      SUM(a.spend_cents) as pending_cents
    FROM ad_spend a
    ${pendingWhere}
      AND a.date > COALESCE(
        (SELECT MAX(p.date) FROM ad_payments p
         WHERE p.platform = a.platform
         ${storeId ? 'AND p.store_id = ?' : ''}),
        '1970-01-01'
      )
    GROUP BY a.platform
  `).all(...pendingParams, ...(storeId ? [storeId] : []));

  const pendingCents: Record<string, number> = {};
  let totalPendingCents = 0;
  for (const row of pendingByPlatform as any[]) {
    pendingCents[row.platform] = row.pending_cents || 0;
    totalPendingCents += row.pending_cents || 0;
  }

  return NextResponse.json({ payments, cardSummary, platformSummary, monthlyTotals, pendingCents, totalPendingCents });
}
