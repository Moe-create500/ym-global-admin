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
  /** Institution of the card the mask resolves to (from bank_accounts). A
   *  checking debit naming a different bank can then never clear this log. */
  institution?: string | null;
  /** Every mask the resolved card answers to (its own + merged twins), so a
   *  "payment to CRD 9215" debit clears a payment logged against ··1654. */
  masks?: string[];
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

// "Shopify Credit payment" = paying the Shopify Credit card (··3704) from the Shopify Balance — a card payment with no card account in YM.
const CARD_PAYMENT_DEBIT = /AMERICAN EXPRESS|AMEX|PAYMENT TO CRD|CRD \d|CREDIT CARD|CARD PMT|CARD PAYMENT|EPAYMENT|ACH PMT|AUTOPAY|CAPITAL ONE|CHASE CARD|DISCOVER|SHOPIFY CREDIT/i;
const CARD_PAYMENT_CREDIT = /PAYMENT|PMT|AUTOPAY/i;

export function maskOf(cardLabel: string | null | undefined): string | null {
  const m = String(cardLabel || '').match(/(\d{4})(?!.*\d)/);
  return m ? m[1] : null;
}

/** A checking debit is amount-only evidence, so it must not contradict the
 *  card: an "AMERICAN EXPRESS … ACH PMT" can't clear a BofA card, and a
 *  "payment to CRD 0512" can't clear a payment headed to ··9215. */
export function debitFitsCard(description: string, log: Pick<LoggedPayment, 'institution' | 'masks' | 'card_last4'>): boolean {
  const inst = (log.institution || '').toLowerCase();
  const mentionsAmex = /AMERICAN EXPRESS|AMEX/i.test(description);
  const crd = description.match(/\bCRD\s*(\d{4})\b/i);
  if (mentionsAmex && inst && !inst.includes('american express')) return false;
  if (crd) {
    if (inst.includes('american express')) return false;
    const masks = new Set([...(log.masks || []), maskOf(log.card_last4) || '']);
    if (!masks.has(crd[1])) return false;
  }
  return true;
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
      } else if (r.amount_cents < 0 && CARD_PAYMENT_DEBIT.test(desc) && debitFitsCard(desc, lg)) {
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

type LogWithNotes = LoggedPayment & { notes: string | null; store_name: string | null };

/** BofA child cards ("YM CREDIT ··0775") bill to a parent line ("CORP Account
 *  - YM CREDIT LINE ··0512"): the payment credit lands on the LINE, never the
 *  child. Same family rule as the Credit Cards page. Returns the alias map
 *  with each child's mask also resolving to its line. */
export function withParentLines(db: DatabaseType.Database, aliases: Map<string, string[]>): Map<string, string[]> {
  const accts: any[] = db.prepare(`
    SELECT id, account_name FROM bank_accounts WHERE account_type = 'credit' AND status = 'active'
  `).all();
  const isLine = (n: string) => /^CORP Account/i.test(n || '');
  const fam = (n: string) => String(n || '').replace(/^CORP Account - /i, '').replace(/ LINE$/i, '').slice(0, 14).toLowerCase();
  const lineByFam = new Map<string, string>();
  for (const a of accts) if (isLine(a.account_name)) lineByFam.set(fam(a.account_name), a.id);
  const parentOf = new Map<string, string>();
  for (const a of accts) {
    if (isLine(a.account_name)) continue;
    const line = lineByFam.get(fam(a.account_name));
    if (line) parentOf.set(a.id, line);
  }
  const out = new Map<string, string[]>();
  for (const [mask, ids] of aliases) {
    const all = [...ids];
    for (const id of ids) {
      const p = parentOf.get(id);
      if (p && !all.includes(p)) all.push(p);
    }
    out.set(mask, all);
  }
  return out;
}

/** Every active logged payment in the window (all stores) with its verdict. */
function reconcileWindow(db: DatabaseType.Database, days: number): { logs: LogWithNotes[]; recon: Map<string, Reconciled>; aliases: Map<string, string[]> } {
  const logs: LogWithNotes[] = db.prepare(`
    SELECT cp.id, cp.store_id, cp.date, cp.amount_cents, cp.card_last4, cp.notes, s.name AS store_name
    FROM card_payments_log cp LEFT JOIN stores s ON s.id = cp.store_id
    WHERE cp.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND cp.date >= date('now', ?)
      AND COALESCE(cp.status, 'active') = 'active'
    ORDER BY cp.date DESC
  `).all(`-${days} days`) as any[];
  const aliases = withParentLines(db, getCardAliasMap(db));
  if (!logs.length) return { logs, recon: new Map(), aliases };

  // Institution + every mask of the card each log resolves to (own mask plus
  // merged twins), so the checking-debit guard can reject contradictions.
  const acctInfo = new Map<string, { institution: string | null; masks: Set<string> }>();
  for (const a of db.prepare(`
    SELECT id, institution_name, last_four, merged_into FROM bank_accounts
    WHERE account_type = 'credit' AND last_four IS NOT NULL AND last_four != ''
  `).all() as any[]) {
    const key = a.merged_into || a.id;
    const cur = acctInfo.get(key) || { institution: null, masks: new Set<string>() };
    cur.masks.add(a.last_four);
    if (!a.merged_into) cur.institution = a.institution_name || null;
    acctInfo.set(key, cur);
  }
  for (const lg of logs) {
    const ids = aliases.get(maskOf(lg.card_last4) || '') || [];
    const insts = new Set<string>();
    const masks = new Set<string>();
    for (const id of ids) {
      const info = acctInfo.get(id);
      if (!info) continue;
      if (info.institution) insts.add(info.institution);
      for (const m of info.masks) masks.add(m);
    }
    lg.institution = insts.size === 1 ? [...insts][0] : null;
    lg.masks = [...masks];
  }

  const bank: BankRow[] = db.prepare(`
    SELECT t.id, t.bank_account_id, a.account_type, t.date, t.amount_cents, t.status, t.description
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE t.date >= date('now', ?) AND a.status != 'merged'
  `).all(`-${days + LAG_BEFORE + 1} days`) as any[];

  return { logs, recon: reconcileLoggedPayments(logs, bank, aliases), aliases };
}

const isInFlight = (r: Reconciled | undefined) => !!r && (r.status === 'too_recent' || r.status === 'not_taken');

/** One store's in-flight payments over the last `days` days, plus their total. */
export function getPaymentsInFlight(db: DatabaseType.Database, storeId: string, days = 21): { rows: InFlightRow[]; totalCents: number } {
  const { logs, recon } = reconcileWindow(db, days);
  const rows: InFlightRow[] = [];
  for (const lg of logs) {
    if (lg.store_id !== storeId) continue;
    const r = recon.get(lg.id);
    if (!isInFlight(r)) continue;
    rows.push({ id: lg.id, date: lg.date, amount_cents: Math.abs(lg.amount_cents), card_last4: lg.card_last4, status: r!.status, notes: lg.notes });
  }
  return { rows, totalCents: rows.reduce((s, r) => s + r.amount_cents, 0) };
}

export interface CardInFlightRow extends InFlightRow {
  store_name: string | null;
  /** The logged mask resolves to more than one live account (both Amex end
   *  ··1009) — shown on each candidate, never added into a projection. */
  ambiguous: boolean;
}

export interface CardInFlight {
  cents: number;            // unambiguous in-flight payments headed to this card
  ambiguous_cents: number;  // payments that could be this card or a twin
  rows: CardInFlightRow[];
}

/** In-flight payments grouped by the credit account they are headed to (all
 *  stores — a card is paid from many stores). Keyed by bank_accounts.id. */
export function getInFlightByAccount(db: DatabaseType.Database, days = 21): Map<string, CardInFlight> {
  const { logs, recon, aliases } = reconcileWindow(db, days);
  const out = new Map<string, CardInFlight>();
  for (const lg of logs) {
    const r = recon.get(lg.id);
    if (!isInFlight(r)) continue;
    const ids = aliases.get(maskOf(lg.card_last4) || '') || [];
    if (!ids.length) continue;
    const ambiguous = ids.length > 1;
    const amount = Math.abs(lg.amount_cents);
    for (const id of ids) {
      const cur = out.get(id) || { cents: 0, ambiguous_cents: 0, rows: [] };
      if (ambiguous) cur.ambiguous_cents += amount; else cur.cents += amount;
      cur.rows.push({ id: lg.id, date: lg.date, amount_cents: amount, card_last4: lg.card_last4, status: r!.status, notes: lg.notes, store_name: lg.store_name, ambiguous });
      out.set(id, cur);
    }
  }
  return out;
}
