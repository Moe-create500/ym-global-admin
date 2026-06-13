/**
 * Transaction Matching Engine
 * ===========================
 * Links invoices → card payments → bank transactions to trace every dollar.
 * Used by the CFO reconciliation engine to provide drill-down detail on bridge items.
 *
 * Matching strategy (3 tiers):
 *   1. Exact:    same card_last4 + same amount + date within 3 days
 *   2. Probable: same card_last4 + amount within 5% + date within 7 days
 *   3. Fuzzy:    amount within 1% + date within 5 days (no card match required)
 */

import type BetterSqlite3 from 'better-sqlite3';

type DB = BetterSqlite3.Database;

// ── Public interfaces ──

export interface InvoiceRecord {
  id: string;
  date: string;
  amount_cents: number;
  platform: string;
  description: string;
  card_last4: string | null;
  type: 'ad' | 'app';
}

export interface PaymentRecord {
  id: string;
  date: string;
  amount_cents: number;
  card_last4: string;
  method: string;
  category: 'ad' | 'app';
  platform: string | null;
}

export interface BankTxnRecord {
  id: string;
  date: string;
  amount_cents: number;
  description: string;
  account_name: string;
  account_last4: string;
  account_type: string;
}

export interface SSPaymentRecord {
  id: string;
  date: string;
  amount_cents: number;
  note: string;
}

export interface OwnerMovement {
  id: string;
  date: string;
  amount_cents: number;
  description: string;
  category: string;
  custom_category: string;
  account_name: string;
  type: 'draw' | 'contribution';
}

export interface MatchedFlow {
  type: 'ad' | 'app' | 'fulfillment';
  invoice: InvoiceRecord | null;
  payment: PaymentRecord | SSPaymentRecord | null;
  bank_txn: BankTxnRecord | null;
  confidence: 'exact' | 'probable' | 'fuzzy' | 'unmatched';
}

export interface MoneyFlow {
  matched: MatchedFlow[];
  unmatched_invoices: InvoiceRecord[];
  unmatched_payments: (PaymentRecord | SSPaymentRecord)[];
  unmatched_bank_txns: BankTxnRecord[];
  owner_movements: OwnerMovement[];
  summary: {
    total_invoiced_cents: number;
    total_paid_cents: number;
    total_matched_cents: number;
    total_unmatched_cents: number;
    match_rate_pct: number;
    ad_invoices: number;
    ad_payments: number;
    app_invoices: number;
    app_payments: number;
    ss_payments: number;
    owner_draws_cents: number;
    owner_contributions_cents: number;
  };
}

// ── Matching helpers ──

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA.substring(0, 10));
  const b = new Date(dateB.substring(0, 10));
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000));
}

function amountMatch(a: number, b: number, tolerancePct: number): boolean {
  if (a === 0 && b === 0) return true;
  if (a === 0 || b === 0) return false;
  const diff = Math.abs(a - b);
  const max = Math.max(Math.abs(a), Math.abs(b));
  return (diff / max) <= tolerancePct;
}

const OWNER_DRAW_PATTERNS = ['owner draw', 'owner withdraw', 'withdrawal', 'distribution', 'dividend'];
const OWNER_CONTRIB_PATTERNS = ['owner contribution', 'owner deposit', 'owner invest', 'capital injection', 'capital contribution', 'owner funding'];

function classifyOwnerMovement(category: string): 'draw' | 'contribution' | null {
  const c = (category || '').toLowerCase();
  if (OWNER_DRAW_PATTERNS.some(p => c.includes(p))) return 'draw';
  if (OWNER_CONTRIB_PATTERNS.some(p => c.includes(p))) return 'contribution';
  return null;
}

// ── Main matcher ──

export function matchTransactions(
  db: DB,
  storeId: string,
  periodStart: string,
  periodEnd: string
): MoneyFlow {
  // 1. Gather all invoices in the period
  const adInvoices: InvoiceRecord[] = (db.prepare(`
    SELECT id, date, amount_cents, platform,
      COALESCE(payment_method, '') as description, card_last4
    FROM ad_payments
    WHERE store_id = ? AND date >= ? AND date <= ? AND date != 'N/A'
  `).all(storeId, periodStart, periodEnd) as any[]).map(r => ({
    ...r, type: 'ad' as const,
    description: r.description || r.platform || '',
  }));

  const appInvoices: InvoiceRecord[] = (db.prepare(`
    SELECT id, date, total_cents as amount_cents,
      COALESCE(source, 'shopify') as platform,
      COALESCE(bill_number, '') as description, card_last4
    FROM shopify_invoices
    WHERE store_id = ? AND date >= ? AND date <= ? AND date != 'N/A'
      AND payment_method IS NOT NULL AND payment_method != ''
      AND NOT (source = 'chargeflow' AND (payment_method LIKE '%shopify%' OR payment_method LIKE '%Shopify%'))
  `).all(storeId, periodStart, periodEnd) as any[]).map(r => ({
    ...r, type: 'app' as const,
  }));

  // 2. Gather all card payments in the period
  const cardPayments: PaymentRecord[] = (db.prepare(`
    SELECT id, date, amount_cents, card_last4,
      COALESCE(method, '') as method, category, platform
    FROM card_payments_log
    WHERE store_id = ? AND date >= ? AND date <= ? AND date != 'N/A'
  `).all(storeId, periodStart, periodEnd) as any[]);

  // 3. Gather SS payments in the period
  const ssPayments: SSPaymentRecord[] = (db.prepare(`
    SELECT id, date, amount_cents, COALESCE(note, '') as note
    FROM ss_payments
    WHERE store_id = ? AND date >= ? AND date <= ? AND date != 'N/A'
  `).all(storeId, periodStart, periodEnd) as any[]);

  // 4. Gather bank transactions in the period (outflows on credit card and checking accounts)
  const bankTxns: BankTxnRecord[] = (db.prepare(`
    SELECT bt.id, bt.date, bt.amount_cents,
      COALESCE(bt.description, '') as description,
      COALESCE(ba.account_name, ba.institution_name, '') as account_name,
      COALESCE(ba.last_four, '') as account_last4,
      COALESCE(ba.account_type, '') as account_type
    FROM bank_transactions bt
    JOIN bank_accounts ba ON ba.id = bt.bank_account_id
    WHERE ba.store_id = ? AND bt.date >= ? AND bt.date <= ? AND bt.date != 'N/A'
      AND COALESCE(ba.cfo_hidden, 0) = 0
  `).all(storeId, periodStart, periodEnd) as any[]);

  // 5. Gather owner capital movements
  const ownerTxns = (db.prepare(`
    SELECT bt.id, bt.date, bt.amount_cents,
      COALESCE(bt.description, '') as description,
      COALESCE(bt.category, '') as category,
      COALESCE(bt.custom_category, '') as custom_category,
      COALESCE(ba.account_name, ba.institution_name, '') as account_name
    FROM bank_transactions bt
    JOIN bank_accounts ba ON ba.id = bt.bank_account_id
    WHERE ba.store_id = ? AND bt.date >= ? AND bt.date <= ? AND bt.date != 'N/A'
      AND COALESCE(ba.cfo_hidden, 0) = 0
  `).all(storeId, periodStart, periodEnd) as any[]);

  const ownerMovements: OwnerMovement[] = [];
  for (const t of ownerTxns) {
    const cat = t.custom_category || t.category || '';
    const moveType = classifyOwnerMovement(cat);
    if (moveType) {
      ownerMovements.push({
        id: t.id, date: t.date, amount_cents: t.amount_cents,
        description: t.description, category: t.category,
        custom_category: t.custom_category, account_name: t.account_name,
        type: moveType,
      });
    }
  }

  // ── Match invoices → payments ──
  const allInvoices = [...adInvoices, ...appInvoices];
  const matchedFlows: MatchedFlow[] = [];
  const usedPaymentIds = new Set<string>();
  const usedBankTxnIds = new Set<string>();
  const matchedInvoiceIds = new Set<string>();

  // Sort invoices by amount descending (match larger ones first for accuracy)
  allInvoices.sort((a, b) => Math.abs(b.amount_cents) - Math.abs(a.amount_cents));

  for (const invoice of allInvoices) {
    const relevantPayments = cardPayments.filter(p =>
      !usedPaymentIds.has(p.id) && p.category === invoice.type
    );

    let bestPayment: PaymentRecord | null = null;
    let bestConfidence: 'exact' | 'probable' | 'fuzzy' = 'fuzzy';

    // Tier 1: Exact match — same card + same amount + within 3 days
    if (invoice.card_last4) {
      for (const p of relevantPayments) {
        if (p.card_last4 === invoice.card_last4 &&
            p.amount_cents === invoice.amount_cents &&
            daysBetween(p.date, invoice.date) <= 3) {
          bestPayment = p;
          bestConfidence = 'exact';
          break;
        }
      }
    }

    // Tier 2: Probable — same card + amount within 5% + within 7 days
    if (!bestPayment && invoice.card_last4) {
      for (const p of relevantPayments) {
        if (p.card_last4 === invoice.card_last4 &&
            amountMatch(p.amount_cents, invoice.amount_cents, 0.05) &&
            daysBetween(p.date, invoice.date) <= 7) {
          bestPayment = p;
          bestConfidence = 'probable';
          break;
        }
      }
    }

    // Tier 3: Fuzzy — amount within 1% + within 5 days (no card required)
    if (!bestPayment) {
      for (const p of relevantPayments) {
        if (amountMatch(p.amount_cents, invoice.amount_cents, 0.01) &&
            daysBetween(p.date, invoice.date) <= 5) {
          bestPayment = p;
          bestConfidence = 'fuzzy';
          break;
        }
      }
    }

    if (bestPayment) {
      usedPaymentIds.add(bestPayment.id);
      matchedInvoiceIds.add(invoice.id);

      // Try to match payment → bank transaction
      const bankTxn = matchPaymentToBank(bestPayment, bankTxns, usedBankTxnIds);
      if (bankTxn) usedBankTxnIds.add(bankTxn.id);

      matchedFlows.push({
        type: invoice.type,
        invoice,
        payment: bestPayment,
        bank_txn: bankTxn,
        confidence: bestConfidence,
      });
    }
  }

  // ── Match SS payments → bank transactions ──
  const usedSSIds = new Set<string>();
  for (const sp of ssPayments) {
    const bankTxn = matchSSToBank(sp, bankTxns, usedBankTxnIds);
    if (bankTxn) {
      usedBankTxnIds.add(bankTxn.id);
      usedSSIds.add(sp.id);
      matchedFlows.push({
        type: 'fulfillment',
        invoice: null,
        payment: sp,
        bank_txn: bankTxn,
        confidence: 'probable',
      });
    }
  }

  // ── Collect unmatched items ──
  const unmatchedInvoices = allInvoices.filter(i => !matchedInvoiceIds.has(i.id));
  const unmatchedPayments: (PaymentRecord | SSPaymentRecord)[] = [
    ...cardPayments.filter(p => !usedPaymentIds.has(p.id)),
    ...ssPayments.filter(s => !usedSSIds.has(s.id)),
  ];
  const unmatchedBankTxns = bankTxns.filter(b => !usedBankTxnIds.has(b.id));

  // ── Summary ──
  const totalInvoiced = allInvoices.reduce((s, i) => s + Math.abs(i.amount_cents), 0);
  const totalMatched = matchedFlows.reduce((s, f) => s + Math.abs(f.invoice?.amount_cents || f.payment?.amount_cents || 0), 0);
  const totalPaid = [...cardPayments, ...ssPayments].reduce((s, p) => s + Math.abs(p.amount_cents), 0);

  return {
    matched: matchedFlows,
    unmatched_invoices: unmatchedInvoices,
    unmatched_payments: unmatchedPayments,
    unmatched_bank_txns: unmatchedBankTxns,
    owner_movements: ownerMovements,
    summary: {
      total_invoiced_cents: totalInvoiced,
      total_paid_cents: totalPaid,
      total_matched_cents: totalMatched,
      total_unmatched_cents: totalInvoiced - totalMatched,
      match_rate_pct: totalInvoiced > 0 ? Math.round((totalMatched / totalInvoiced) * 100) : 100,
      ad_invoices: adInvoices.length,
      ad_payments: cardPayments.filter(p => p.category === 'ad').length,
      app_invoices: appInvoices.length,
      app_payments: cardPayments.filter(p => p.category === 'app').length,
      ss_payments: ssPayments.length,
      owner_draws_cents: ownerMovements.filter(m => m.type === 'draw').reduce((s, m) => s + m.amount_cents, 0),
      owner_contributions_cents: ownerMovements.filter(m => m.type === 'contribution').reduce((s, m) => s + m.amount_cents, 0),
    },
  };
}

// ── Bank transaction matching helpers ──

function matchPaymentToBank(
  payment: PaymentRecord,
  bankTxns: BankTxnRecord[],
  usedIds: Set<string>
): BankTxnRecord | null {
  const available = bankTxns.filter(b => !usedIds.has(b.id));

  // For card payments, look for outflows on the matching credit card account
  // Credit card charges show as negative amounts on credit card accounts
  for (const b of available) {
    if (b.account_type === 'credit' &&
        b.account_last4 === payment.card_last4 &&
        Math.abs(b.amount_cents) === payment.amount_cents &&
        daysBetween(b.date, payment.date) <= 3) {
      return b;
    }
  }

  // Probable: same card + amount within 5% + within 7 days
  for (const b of available) {
    if (b.account_type === 'credit' &&
        b.account_last4 === payment.card_last4 &&
        amountMatch(Math.abs(b.amount_cents), payment.amount_cents, 0.05) &&
        daysBetween(b.date, payment.date) <= 7) {
      return b;
    }
  }

  return null;
}

function matchSSToBank(
  ssPayment: SSPaymentRecord,
  bankTxns: BankTxnRecord[],
  usedIds: Set<string>
): BankTxnRecord | null {
  const available = bankTxns.filter(b =>
    !usedIds.has(b.id) && b.account_type !== 'credit'
  );

  // Look for outflows matching amount + description containing SS-related terms
  for (const b of available) {
    const desc = b.description.toLowerCase();
    const isSSRelated = desc.includes('shipsource') || desc.includes('ship source') ||
      desc.includes('ss ') || desc.includes('fulfillment');

    if (isSSRelated &&
        Math.abs(b.amount_cents) === ssPayment.amount_cents &&
        daysBetween(b.date, ssPayment.date) <= 5) {
      return b;
    }
  }

  // Fallback: amount match + within 3 days (no description match required)
  for (const b of available) {
    if (b.amount_cents < 0 &&
        Math.abs(b.amount_cents) === ssPayment.amount_cents &&
        daysBetween(b.date, ssPayment.date) <= 3) {
      return b;
    }
  }

  return null;
}
