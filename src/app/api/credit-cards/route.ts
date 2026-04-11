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

  // 5. Normalize card_last4: extract 4-digit number from compound values like "amex - 2976"
  function normalizeLast4(raw: string): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    // Already a pure 4-digit number
    if (/^\d{4}$/.test(trimmed)) return trimmed;
    // Extract 4-digit number from compound like "amex - 2976", "Visa - 2976", "credit_card - 2976"
    const match = trimmed.match(/(\d{4})/);
    return match ? match[1] : null; // Skip non-numeric entries like "paypal", "credit"
  }

  // Also extract card type hint from compound card_last4 values
  function typeHintFromRaw(raw: string): string | null {
    const lower = raw.toLowerCase();
    if (lower.includes('amex')) return 'amex';
    if (lower.includes('mastercard')) return 'mastercard';
    if (lower.includes('visa')) return 'visa';
    return null;
  }

  // Merge everything per normalized card_last4
  const cardMap: Record<string, {
    card_last4: string;
    card_type: string;
    total_spent_cents: number;
    transaction_count: number;
    last_used: string | null;
    stores: Set<string>;
    platforms: Record<string, number>;
  }> = {};

  function isValidDate(d: string | null): boolean {
    return !!d && /^\d{4}-\d{2}-\d{2}/.test(d);
  }

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

  function updateLastUsed(c: typeof cardMap[string], date: string | null) {
    if (isValidDate(date) && (!c.last_used || date! > c.last_used)) c.last_used = date;
  }

  // Ad payments
  for (const row of adCards) {
    const last4 = normalizeLast4(row.card_last4);
    if (!last4) continue;
    const c = ensureCard(last4);
    c.total_spent_cents += row.total_cents || 0;
    c.transaction_count += row.txn_count || 0;
    c.platforms[row.platform] = (c.platforms[row.platform] || 0) + (row.total_cents || 0);
    updateLastUsed(c, row.last_date);
    if (row.store_names) row.store_names.split(',').forEach((s: string) => c.stores.add(s));
  }

  // Shopify invoices
  for (const row of shopifyCards) {
    const last4 = normalizeLast4(row.card_last4);
    if (!last4) continue;
    const c = ensureCard(last4);
    c.total_spent_cents += row.total_cents || 0;
    c.transaction_count += row.txn_count || 0;
    c.platforms['shopify'] = (c.platforms['shopify'] || 0) + (row.total_cents || 0);
    updateLastUsed(c, row.last_date);
    if (row.store_names) row.store_names.split(',').forEach((s: string) => c.stores.add(s));
  }

  // Payment log — normalize and merge into proper card entries
  for (const row of logCards) {
    const last4 = normalizeLast4(row.card_last4);
    if (!last4) continue;
    const c = ensureCard(last4);
    // Apply type hint from compound names like "amex - 2976"
    if (c.card_type === 'unknown') {
      const hint = typeHintFromRaw(row.card_last4);
      if (hint) c.card_type = hint;
    }
    c.total_spent_cents += row.total_cents || 0;
    c.transaction_count += row.txn_count || 0;
    const platform = row.category === 'ad' ? 'ad_payments' : 'app_payments';
    c.platforms[platform] = (c.platforms[platform] || 0) + (row.total_cents || 0);
    updateLastUsed(c, row.last_date);
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
