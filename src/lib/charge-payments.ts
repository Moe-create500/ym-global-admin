import type DatabaseType from 'better-sqlite3';
import crypto from 'crypto';

/** Paying off ordinary card charges — the third kind of card payment.
 *
 *  Two kinds were already logged: ad-platform spend (`category='ad'`, from the
 *  Ad Spend page) and app invoices (`category='app'`, from App Invoices).
 *  Everything else a card carries — software, supplies, marketplace buys, the
 *  77 Whop charges Purebite ran up — had nowhere to record the payment that
 *  cleared it. Marking a charge paid said "this is settled" but the money
 *  leaving the bank was invisible, so the CFO counted cash that was already
 *  committed, and no one could say which payment cleared which charge.
 *
 *  This is that third kind: `category='charge'`. It writes the payment to the
 *  same `card_payments_log` every other payment uses, so it flows into
 *  Payments in Flight automatically (that engine reads every active row and
 *  does not care about category), and it records exactly which charges the
 *  payment was applied to. */

export const CHARGE_CATEGORY = 'charge';

export function ensureChargePaymentSchema(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS card_payment_charges (
    payment_id TEXT NOT NULL,
    txn_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (payment_id, txn_id)
  )`);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_cpc_txn ON card_payment_charges(txn_id)'); } catch { /* exists */ }
}

export interface LogChargePaymentInput {
  storeId: string;
  cardLast4: string;
  date: string;              // YYYY-MM-DD, the day the payment was sent
  amountCents: number;       // what actually left / will leave the bank
  txnIds: string[];          // the charges this payment is paying off
  method?: string | null;
  notes?: string | null;
  actor?: string | null;
}

export interface LogChargePaymentResult {
  paymentId: string;
  amountCents: number;
  appliedCents: number;      // sum of the charges it was applied to
  differenceCents: number;   // amount − applied; ≠ 0 is a partial or over payment, not an error
  linked: number;
  newlySettled: number;
  alreadySettled: number;
  skipped: { txnId: string; reason: string }[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Record a payment against a set of card charges, settle them, and link the
 *  two. One transaction: a half-written payment would misstate cash. */
export function logChargePayment(db: DatabaseType.Database, input: LogChargePaymentInput): LogChargePaymentResult {
  const { storeId, cardLast4, date, amountCents, txnIds } = input;
  if (!storeId) throw new Error('storeId required');
  if (!cardLast4) throw new Error('cardLast4 required — a payment has to name the card it paid');
  if (!ISO_DAY.test(date || '')) throw new Error('date must be YYYY-MM-DD');
  if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error('amountCents must be a positive number of cents');
  if (!Array.isArray(txnIds) || txnIds.length === 0) throw new Error('select the charges this payment pays off');
  if (txnIds.length > 2000) throw new Error('too many charges in one payment');

  ensureChargePaymentSchema(db);
  try { db.exec('ALTER TABLE bank_transactions ADD COLUMN settled_at TEXT'); } catch { /* exists */ }

  const paymentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const res: LogChargePaymentResult = {
    paymentId, amountCents, appliedCents: 0, differenceCents: 0,
    linked: 0, newlySettled: 0, alreadySettled: 0, skipped: [],
  };

  const getTxn = db.prepare('SELECT id, amount_cents, settled_at FROM bank_transactions WHERE id = ?');
  const claimed = db.prepare('SELECT payment_id FROM card_payment_charges WHERE txn_id = ?');
  const settle = db.prepare('UPDATE bank_transactions SET settled_at = ? WHERE id = ? AND settled_at IS NULL');
  const link = db.prepare('INSERT OR IGNORE INTO card_payment_charges (payment_id, txn_id) VALUES (?, ?)');

  db.transaction(() => {
    for (const txnId of txnIds) {
      const t: any = getTxn.get(txnId);
      if (!t) { res.skipped.push({ txnId, reason: 'not found' }); continue; }
      // A charge already paid off by another logged payment must not be paid twice.
      const prior: any = claimed.get(txnId);
      if (prior) { res.skipped.push({ txnId, reason: `already paid by payment ${prior.payment_id}` }); continue; }
      if (t.settled_at) res.alreadySettled++;
      else { settle.run(now, txnId); res.newlySettled++; }
      link.run(paymentId, txnId);
      res.linked++;
      res.appliedCents += Math.abs(t.amount_cents || 0);
    }
    if (res.linked === 0) throw new Error('none of those charges could be paid off');
    db.prepare(`INSERT INTO card_payments_log (id, store_id, card_last4, date, amount_cents, method, notes, category, platform, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'card', 'active')`)
      .run(paymentId, storeId, cardLast4, date, amountCents, input.method || null,
        input.notes || `${res.linked} card charge${res.linked === 1 ? '' : 's'} paid off${input.actor ? ` by ${input.actor}` : ''}`,
        CHARGE_CATEGORY);
  })();

  res.differenceCents = amountCents - res.appliedCents;
  return res;
}

export interface ChargePaymentRef { paymentId: string; date: string; amountCents: number; cardLast4: string | null; notes: string | null }

/** Which payment cleared each of these charges. */
export function paymentsForCharges(db: DatabaseType.Database, txnIds: string[]): Map<string, ChargePaymentRef> {
  ensureChargePaymentSchema(db);
  const out = new Map<string, ChargePaymentRef>();
  if (!txnIds.length) return out;
  const CHUNK = 400;
  for (let i = 0; i < txnIds.length; i += CHUNK) {
    const slice = txnIds.slice(i, i + CHUNK);
    const rows: any[] = db.prepare(`
      SELECT c.txn_id, p.id, p.date, p.amount_cents, p.card_last4, p.notes
      FROM card_payment_charges c JOIN card_payments_log p ON p.id = c.payment_id
      WHERE c.txn_id IN (${slice.map(() => '?').join(',')})`).all(...slice);
    for (const r of rows) out.set(r.txn_id, { paymentId: r.id, date: r.date, amountCents: r.amount_cents, cardLast4: r.card_last4, notes: r.notes });
  }
  return out;
}

/** Undo a logged charge payment. Charges it settled go back to unpaid unless
 *  they were already settled before the payment was recorded. */
export function deleteChargePayment(db: DatabaseType.Database, paymentId: string, opts: { unsettle?: boolean } = {}): { deleted: boolean; unsettled: number } {
  ensureChargePaymentSchema(db);
  const pay: any = db.prepare('SELECT id, category FROM card_payments_log WHERE id = ?').get(paymentId);
  if (!pay) return { deleted: false, unsettled: 0 };
  let unsettled = 0;
  db.transaction(() => {
    if (opts.unsettle !== false) {
      const rows: any[] = db.prepare('SELECT txn_id FROM card_payment_charges WHERE payment_id = ?').all(paymentId);
      const clear = db.prepare('UPDATE bank_transactions SET settled_at = NULL WHERE id = ?');
      for (const r of rows) { clear.run(r.txn_id); unsettled++; }
    }
    db.prepare('DELETE FROM card_payment_charges WHERE payment_id = ?').run(paymentId);
    db.prepare('DELETE FROM card_payments_log WHERE id = ?').run(paymentId);
  })();
  return { deleted: true, unsettled };
}
