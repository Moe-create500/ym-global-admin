import type DatabaseType from 'better-sqlite3';

/** One rule, used by the overview, the issues feed and the drilldown, for
 *  "this outflow is money moving, not money leaving":
 *   - paying our own credit card
 *   - a transfer between two of our own accounts (named by mask)
 *   - a transfer to ShipSourced from a brand (intercompany — real to the
 *     store, internal to the group; it is never an unallocated *charge*)
 *  Everything else that leaves an account and is paired to no store is an
 *  unallocated charge — nobody's P&L carries it. */

export interface OutflowRow {
  id: string; date: string; description: string | null; amount_cents: number;
  bank_account_id: string; institution_name: string; account_name: string; last_four: string;
  category: string | null; store_id: string | null; suggested_store_id: string | null;
}

export type MovementKind = 'card_payment' | 'own_transfer' | 'intercompany' | 'payout' | 'charge';

const CARD_PAYMENT = /ONLINE PAYMENT|AUTOPAY|ACH PMT|PAYMENT TO CRD|AMERICAN EXPRESS DES|AMEX EPAYMENT|CREDIT CRD EPAY/i;
const INTERCOMPANY = /TRANSFER TO SHIPSOURCED|SHIPSOURCED.*TRANSFER|TRANSFER YM GLOBAL VENTURES/i;

export function classifyMovement(row: Pick<OutflowRow, 'description' | 'category'>, ownMasks: Set<string>): MovementKind {
  const d = (row.description || '').toUpperCase();
  const cat = row.category || '';
  if (cat === 'Credit Card Payment' || CARD_PAYMENT.test(d)) return 'card_payment';
  if (cat === 'Shopify Payout' || cat === 'Fraud Reversal') return 'payout';
  if (cat === 'Transfer Out' || cat === 'Transfer In') return 'own_transfer';
  const m = d.match(/\b(?:CHK|SAV|CRD|ACCOUNT|BANK OF AMERICA)\s*\(?\s*(\d{4})\b/);
  if (/TRANSFER/.test(d) && m && ownMasks.has(m[1])) return 'own_transfer';
  if (INTERCOMPANY.test(d)) return 'intercompany';
  return 'charge';
}

export function ownMasks(db: DatabaseType.Database): Set<string> {
  return new Set((db.prepare(`SELECT last_four FROM bank_accounts WHERE last_four IS NOT NULL AND last_four != ''`).all() as any[]).map(r => r.last_four));
}

/** Unpaired outflows in a period on the given accounts, split into real
 *  charges vs internal movements. */
export function unpairedOutflows(db: DatabaseType.Database, accountIds: string[], period: { from: string; to: string }): { charges: OutflowRow[]; movements: (OutflowRow & { kind: MovementKind })[] } {
  if (!accountIds.length) return { charges: [], movements: [] };
  const q = accountIds.map(() => '?').join(',');
  const rows: OutflowRow[] = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, t.bank_account_id, a.institution_name, a.account_name, a.last_four,
           r.category, r.store_id, r.suggested_store_id
    FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
    LEFT JOIN classification_results r ON r.txn_id = t.id
    WHERE t.bank_account_id IN (${q}) AND t.amount_cents < 0 AND t.date BETWEEN ? AND ? AND r.store_id IS NULL
    ORDER BY t.amount_cents ASC`).all(...accountIds, period.from, period.to) as any[];
  const masks = ownMasks(db);
  const charges: OutflowRow[] = [], movements: (OutflowRow & { kind: MovementKind })[] = [];
  for (const r of rows) {
    const kind = classifyMovement(r, masks);
    if (kind === 'charge') charges.push(r); else movements.push({ ...r, kind });
  }
  return { charges, movements };
}
