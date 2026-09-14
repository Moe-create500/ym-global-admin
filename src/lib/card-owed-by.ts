import type DatabaseType from 'better-sqlite3';

/** Who is behind a card's balance: for one credit account, each store's
 *  charges (from the pairing verdicts) against the payments that store made
 *  to the card. A payment is attributed from the BANK side — the card's
 *  "ONLINE PAYMENT" credit is matched to the checking debit that funded it
 *  (same amount, ±4 days) and the debit's store (its pairing verdict, else
 *  the checking account's owner store) is the payer. The payment log is not
 *  used: stores that pay Amex directly never log anything. */

export interface OwedByRow {
  store_id: string;
  store_name: string;
  charged_cents: number;
  paid_cents: number;
  net_cents: number;      // charged − paid; positive = still owes the card
}

export interface CardOwedBy {
  since: string;
  rows: OwedByRow[];            // sorted by net desc, zero-net stores dropped
  unpaired_cents: number;       // charges with no store — nobody pays these
  unpaired_count: number;
  unknown_payer_cents: number;  // payments no linked checking account made
  charged_cents: number;
  paid_cents: number;
}

const PAYMENT_CREDIT = "(UPPER(description) LIKE '%PAYMENT%' OR UPPER(description) LIKE '%PMT%' OR UPPER(description) LIKE '%AUTOPAY%')";
const CARD_PAYMENT_DEBIT = /AMERICAN EXPRESS|AMEX|PAYMENT TO CRD|CRD \d|CREDIT CARD|CARD PMT|CARD PAYMENT|EPAYMENT|ACH PMT|AUTOPAY/i;
const dayNum = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);

interface Debit { id: string; date: string; cents: number; store_id: string | null }

/** Checking-side card-payment debits, with the store that paid, keyed by amount. */
function loadPayerDebits(db: DatabaseType.Database, since: string): Map<number, Debit[]> {
  const rows: any[] = db.prepare(`
    SELECT t.id, t.date, -t.amount_cents AS cents, t.description, COALESCE(r.store_id, a.store_id) AS store_id
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.account_type != 'credit' AND a.status != 'merged'
    LEFT JOIN classification_results r ON r.txn_id = t.id
    WHERE t.amount_cents < 0 AND t.date >= date(?, '-4 days')
  `).all(since);
  const out = new Map<number, Debit[]>();
  for (const r of rows) {
    if (!CARD_PAYMENT_DEBIT.test(r.description || '')) continue;
    if (!out.has(r.cents)) out.set(r.cents, []);
    out.get(r.cents)!.push({ id: r.id, date: r.date, cents: r.cents, store_id: r.store_id || null });
  }
  return out;
}

export function getOwedByForCards(db: DatabaseType.Database, accountIds: string[], days = 90): Map<string, CardOwedBy> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const stores = new Map<string, string>((db.prepare('SELECT id, name FROM stores').all() as any[]).map(s => [s.id, s.name]));
  const debits = loadPayerDebits(db, since);
  const used = new Set<string>();
  const out = new Map<string, CardOwedBy>();

  const chargeStmt = db.prepare(`
    SELECT COALESCE(r.store_id, '') AS store_id, SUM(-t.amount_cents) AS cents, COUNT(*) AS n
    FROM bank_transactions t LEFT JOIN classification_results r ON r.txn_id = t.id
    WHERE t.bank_account_id = ? AND t.amount_cents < 0 AND t.date >= ?
    GROUP BY 1`);
  const creditStmt = db.prepare(`
    SELECT id, date, amount_cents AS cents FROM bank_transactions
    WHERE bank_account_id = ? AND amount_cents > 0 AND date >= ? AND ${PAYMENT_CREDIT}
    ORDER BY date`);

  for (const acct of accountIds) {
    const charged = new Map<string, number>();
    let unpaired = 0, unpairedCount = 0, chargedTotal = 0;
    for (const r of chargeStmt.all(acct, since) as any[]) {
      chargedTotal += r.cents;
      if (!r.store_id) { unpaired += r.cents; unpairedCount += r.n; continue; }
      charged.set(r.store_id, (charged.get(r.store_id) || 0) + r.cents);
    }
    const paid = new Map<string, number>();
    let unknownPayer = 0, paidTotal = 0;
    for (const cr of creditStmt.all(acct, since) as any[]) {
      paidTotal += cr.cents;
      let best: { gap: number; d: Debit } | null = null;
      for (const d of debits.get(cr.cents) || []) {
        if (used.has(d.id)) continue;
        const gap = Math.abs(dayNum(d.date) - dayNum(cr.date));
        if (gap <= 4 && (!best || gap < best.gap)) best = { gap, d };
      }
      if (!best || !best.d.store_id) { unknownPayer += cr.cents; if (best) used.add(best.d.id); continue; }
      used.add(best.d.id);
      paid.set(best.d.store_id, (paid.get(best.d.store_id) || 0) + cr.cents);
    }
    const ids = new Set([...charged.keys(), ...paid.keys()]);
    const rows: OwedByRow[] = [];
    for (const id of ids) {
      const c = charged.get(id) || 0, p = paid.get(id) || 0;
      if (c === p) continue;
      rows.push({ store_id: id, store_name: stores.get(id) || id.slice(0, 8), charged_cents: c, paid_cents: p, net_cents: c - p });
    }
    rows.sort((a, b) => b.net_cents - a.net_cents);
    out.set(acct, { since, rows, unpaired_cents: unpaired, unpaired_count: unpairedCount, unknown_payer_cents: unknownPayer, charged_cents: chargedTotal, paid_cents: paidTotal });
  }
  return out;
}
