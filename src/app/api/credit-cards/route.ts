import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();

  // 1. Gather all unique cards from ad_payments
  const adCards: any[] = db.prepare(`
    SELECT ap.card_last4, ap.platform,
      SUM(ap.amount_cents) as total_cents,
      COUNT(*) as txn_count,
      MAX(ap.date) as last_date,
      GROUP_CONCAT(DISTINCT s.name) as store_names
    FROM ad_payments ap
    LEFT JOIN stores s ON s.id = ap.store_id
    WHERE ap.card_last4 IS NOT NULL AND ap.card_last4 != ''
    GROUP BY ap.card_last4, ap.platform
  `).all();

  // 2. Gather all unique cards from shopify_invoices
  const shopifyCards: any[] = db.prepare(`
    SELECT card_last4,
      SUM(total_cents) as total_cents,
      COUNT(*) as txn_count,
      MAX(date) as last_date,
      GROUP_CONCAT(DISTINCT s.name) as store_names
    FROM shopify_invoices si
    LEFT JOIN stores s ON s.id = si.store_id
    WHERE card_last4 IS NOT NULL AND card_last4 != ''
    GROUP BY card_last4
  `).all();

  // 3. Gather all unique cards from card_payments_log
  const logCards: any[] = db.prepare(`
    SELECT card_last4,
      SUM(amount_cents) as total_cents,
      COUNT(*) as txn_count,
      MAX(date) as last_date,
      category,
      GROUP_CONCAT(DISTINCT s.name) as store_names
    FROM card_payments_log cpl
    LEFT JOIN stores s ON s.id = cpl.store_id
    WHERE card_last4 IS NOT NULL AND card_last4 != ''
    GROUP BY card_last4, category
  `).all();

  // 4. Derive card type from ad_payments.payment_method
  const cardTypes: any[] = db.prepare(`
    SELECT DISTINCT card_last4, payment_method
    FROM ad_payments
    WHERE card_last4 IS NOT NULL AND card_last4 != '' AND payment_method IS NOT NULL
  `).all();

  const typeMap: Record<string, string> = {};
  for (const ct of cardTypes) {
    const pm = (ct.payment_method || '').toLowerCase();
    if (pm.includes('amex') || pm.includes('american express')) typeMap[ct.card_last4] = 'amex';
    else if (pm.includes('visa')) typeMap[ct.card_last4] = 'visa';
    else if (pm.includes('mastercard') || pm.includes('master card')) typeMap[ct.card_last4] = 'mastercard';
    else if (pm.includes('discover')) typeMap[ct.card_last4] = 'discover';
    else if (pm.includes('paypal')) typeMap[ct.card_last4] = 'paypal';
  }

  // Also check shopify_invoices payment_method for card type hints
  const shopifyTypes: any[] = db.prepare(`
    SELECT DISTINCT card_last4, payment_method
    FROM shopify_invoices
    WHERE card_last4 IS NOT NULL AND card_last4 != '' AND payment_method IS NOT NULL
  `).all();
  for (const ct of shopifyTypes) {
    if (typeMap[ct.card_last4]) continue;
    const pm = (ct.payment_method || '').toLowerCase();
    if (pm.includes('amex') || pm.includes('american express')) typeMap[ct.card_last4] = 'amex';
    else if (pm.includes('visa')) typeMap[ct.card_last4] = 'visa';
    else if (pm.includes('mastercard') || pm.includes('master card')) typeMap[ct.card_last4] = 'mastercard';
    else if (pm.includes('discover')) typeMap[ct.card_last4] = 'discover';
    else if (pm.includes('paypal')) typeMap[ct.card_last4] = 'paypal';
  }

  // 5. Merge everything per card_last4
  const cardMap: Record<string, {
    card_last4: string;
    card_type: string;
    total_spent_cents: number;
    transaction_count: number;
    last_used: string | null;
    stores: Set<string>;
    platforms: Record<string, number>;
  }> = {};

  function ensureCard(last4: string) {
    if (!cardMap[last4]) {
      cardMap[last4] = {
        card_last4: last4,
        card_type: typeMap[last4] || 'unknown',
        total_spent_cents: 0,
        transaction_count: 0,
        last_used: null,
        stores: new Set(),
        platforms: {},
      };
    }
    return cardMap[last4];
  }

  // Ad payments
  for (const row of adCards) {
    const c = ensureCard(row.card_last4);
    c.total_spent_cents += row.total_cents || 0;
    c.transaction_count += row.txn_count || 0;
    c.platforms[row.platform] = (c.platforms[row.platform] || 0) + (row.total_cents || 0);
    if (row.last_date && (!c.last_used || row.last_date > c.last_used)) c.last_used = row.last_date;
    if (row.store_names) row.store_names.split(',').forEach((s: string) => c.stores.add(s));
  }

  // Shopify invoices
  for (const row of shopifyCards) {
    const c = ensureCard(row.card_last4);
    c.total_spent_cents += row.total_cents || 0;
    c.transaction_count += row.txn_count || 0;
    c.platforms['shopify'] = (c.platforms['shopify'] || 0) + (row.total_cents || 0);
    if (row.last_date && (!c.last_used || row.last_date > c.last_used)) c.last_used = row.last_date;
    if (row.store_names) row.store_names.split(',').forEach((s: string) => c.stores.add(s));
  }

  // Payment log
  for (const row of logCards) {
    const c = ensureCard(row.card_last4);
    c.total_spent_cents += row.total_cents || 0;
    c.transaction_count += row.txn_count || 0;
    const platform = row.category === 'ad' ? 'ad_payments' : 'app_payments';
    c.platforms[platform] = (c.platforms[platform] || 0) + (row.total_cents || 0);
    if (row.last_date && (!c.last_used || row.last_date > c.last_used)) c.last_used = row.last_date;
    if (row.store_names) row.store_names.split(',').forEach((s: string) => c.stores.add(s));
  }

  // Convert to array, serialize sets
  const cards = Object.values(cardMap)
    .map(c => ({
      ...c,
      stores: Array.from(c.stores).sort(),
    }))
    .sort((a, b) => b.total_spent_cents - a.total_spent_cents);

  // Total across all cards
  const totals = {
    total_spent_cents: cards.reduce((s, c) => s + c.total_spent_cents, 0),
    total_transactions: cards.reduce((s, c) => s + c.transaction_count, 0),
    card_count: cards.length,
  };

  return NextResponse.json({ cards, totals });
}
