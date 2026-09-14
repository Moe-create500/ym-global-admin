import type DatabaseType from 'better-sqlite3';
import { getCardAliasMap } from './funding-cards';

/** Payments in flight — card payments we LOGGED (card_payments_log) that no
 *  bank feed has shown yet. The money is committed but the checking balance
 *  still counts it as free, so the CFO sheet carries it as a liability.
 *
 *  A logged payment is CLEARED when the bank shows either side of it:
 *    - a debit on a checking account that reads like a card payment
 *      ("AMERICAN EXPRESS DES:ACH PMT", "AMEX EPAYMENT ACH PMT",
 *      "Online Banking payment to CRD 9215"), or
 *    - a payment credit on the card itself ("ONLINE PAYMENT - THANK YOU",
 *      "ONLINE PAYMENT FROM CHK 7…"), resolved through the card alias map so
 *      a payment logged against ··1654 clears on the merged ··9215 account
 *      and a supplementary ··2976 clears on the Platinum ··1009.
 *  Both legs of one real payment are consumed together, so two identical logs
 *  ($2,000 × 2 on one day) need two real payments to both read cleared.
 *
 *  Plain transfers ("Online Banking transfer to CHK …") never clear a card
 *  payment. A pending bank row clears it too (the bank's available balance
 *  already nets a pending debit); posted rows win over pending ones. */

export type InFlightStatus = 'confirmed' | 'pending' | 'too_recent' | 'not_taken';

export interface LoggedPayment {
  id: string;
  store_id: string;
  date: string;          // YYYY-MM-DD
  amount_cents: number;  // positive = amount paid
  card_last4: string;    // free text from the UI: "1654", "Amex - 1009", "paypal"
}

export interface BankRow {
  id: string;
  bank_account_id: string;
  account_type: string;  // 'credit' | 'depository' | …
  date: string;
  amount_cents: number;  // inflow-positive on every account (charges negative)
  status: string;        // 'posted' | 'pending'
  description: string | null;
}

export interface Reconciled {
  status: InFlightStatus;
  bankTxnId?: string;
  bankDate?: string;
  via?: 'card_credit' | 'checking_debit';
}

/** Days a logged payment may precede / follow the bank row it clears on. */
const LAG_BEFORE = 3;
const LAG_AFTER = 10;
/** Younger than this and a missing debit is normal ACH latency, not a problem. */
const TOO_RECENT_DAYS = 4;

const CARD_PAYMENT_DEBIT = /AMERICAN EXPRESS|AMEX|PAYMENT TO CRD|CRD \d|CREDIT CARD|CARD PMT|CARD PAYMENT|EPAYMENT|ACH PMT|AUTOPAY|CAPITAL ONE|CHASE CARD|DISCOVER/i;
const CARD_PAYMENT_CREDIT = /PAYMENT|PMT|AUTOPAY/i;

export function maskOf(cardLabel: string | null | undefined): string | null {
  const m = String(cardLabel || '').match(/(\d{4})(?!.*\d)/);
  return m ? m[1] : null;
}

const dayNum = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);

export function reconcileLoggedPayments(
  logs: LoggedPayment[],
  bank: BankRow[],
  aliases: Map<string, string[]>,
  today: string = new Date().toISOString().slice(0, 10),
): Map<string, Reconciled> {
  const byAmount = new Map<number, BankRow[]>();
  for (const r of bank) {
    const key = Math.abs(r.amount_cents);
    if (!byAmount.has(key)) byAmount.set(key, []);
    byAmount.get(key)!.push(r);
  }

  type Cand = { logId: string; row: BankRow; via: Reconciled['via']; gap: number };
  const cands: Cand[] = [];
  for (const lg of logs) {
    const amt = Math.abs(lg.amount_cents);
    if (!amt || !/^\d{4}-\d{2}-\d{2}$/.test(lg.date)) continue;
    const cardIds = new Set(aliases.get(maskOf(lg.card_last4) || '') || []);
    for (const r of byAmount.get(amt) || []) {
      const lag = dayNum(r.date) - dayNum(lg.date);
      if (lag < -LAG_BEFORE || lag > LAG_AFTER) continue;
      const desc = r.description || '';
      if (r.account_type === 'credit') {
        if (r.amount_cents > 0 && cardIds.has(r.bank_account_id) && CARD_PAYMENT_CREDIT.test(desc)) {
          cands.push({ logId: lg.id, row: r, via: 'card_credit', gap: Math.abs(lag) });
        }
      } else if (r.amount_cents < 0 && CARD_PAYMENT_DEBIT.test(desc)) {
        cands.push({ logId: lg.id, row: r, via: 'checking_debit', gap: Math.abs(lag) });
      }
    }
  }
  // Posted beats pending; the card's own credit beats an amount-only checking
  // debit; then closest date. Closest-first across ALL logs so twins resolve fairly.
  cands.sort((a, b) =>
    (a.row.status === 'pending' ? 1 : 0) - (b.row.status === 'pending' ? 1 : 0)
    || (a.via === 'card_credit' ? 0 : 1) - (b.via === 'card_credit' ? 0 : 1)
    || a.gap - b.gap);

  const used = new Set<string>();
  const out = new Map<string, Reconciled>();
  for (const c of cands) {
    if (out.has(c.logId) || used.has(c.row.id)) continue;
    used.add(c.row.id);
    // Consume the other leg of the same payment so a second identical log
    // cannot clear on it.
    const mate = (byAmount.get(Math.abs(c.row.amount_cents)) || []).find(m =>
      !used.has(m.id) && m.id !== c.row.id
      && Math.sign(m.amount_cents) === -Math.sign(c.row.amount_cents)
      && (m.account_type === 'credit') !== (c.row.account_type === 'credit')
      && Math.abs(dayNum(m.date) - dayNum(c.row.date)) <= LAG_BEFORE);
    if (mate) used.add(mate.id);
    out.set(c.logId, {
      status: c.row.status === 'pending' ? 'pending' : 'confirmed',
      bankTxnId: c.row.id, bankDate: c.row.date, via: c.via,
    });
  }
  for (const lg of logs) {
    if (out.has(lg.id)) continue;
    const age = /^\d{4}-\d{2}-\d{2}$/.test(lg.date) ? dayNum(today) - dayNum(lg.date) : 999;
    out.set(lg.id, { status: age < TOO_RECENT_DAYS ? 'too_recent' : 'not_taken' });
  }
  return out;
}

export interface InFlightRow {
  id: string;
  date: string;
  amount_cents: number;
  card_last4: string;
  status: InFlightStatus;
  notes: string | null;
}

/** One store's in-flight payments over the last `days` days, plus their total. */
export function getPaymentsInFlight(db: DatabaseType.Database, storeId: string, days = 21): { rows: InFlightRow[]; totalCents: number } {
  const logs: (LoggedPayment & { notes: string | null })[] = db.prepare(`
    SELECT id, store_id, date, amount_cents, card_last4, notes
    FROM card_payments_log
    WHERE date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND date >= date('now', ?)
      AND COALESCE(status, 'active') = 'active'
    ORDER BY date DESC
  `).all(`-${days} days`) as any[];
  if (!logs.length) return { rows: [], totalCents: 0 };

  const bank: BankRow[] = db.prepare(`
    SELECT t.id, t.bank_account_id, a.account_type, t.date, t.amount_cents, t.status, t.description
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE t.date >= date('now', ?) AND a.status != 'merged'
  `).all(`-${days + LAG_BEFORE + 1} days`) as any[];

  const recon = reconcileLoggedPayments(logs, bank, getCardAliasMap(db));
  const rows: InFlightRow[] = [];
  for (const lg of logs) {
    if (lg.store_id !== storeId) continue;
    const r = recon.get(lg.id)!;
    if (r.status !== 'too_recent' && r.status !== 'not_taken') continue;
    rows.push({ id: lg.id, date: lg.date, amount_cents: Math.abs(lg.amount_cents), card_last4: lg.card_last4, status: r.status, notes: lg.notes });
  }
  return { rows, totalCents: rows.reduce((s, r) => s + r.amount_cents, 0) };
}
