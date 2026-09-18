import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { logChargePayment, paymentsForCharges, deleteChargePayment } from './charge-payments';
import { getPaymentsInFlight } from './payments-in-flight';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, store_id TEXT, institution_name TEXT, account_name TEXT, nickname TEXT, account_type TEXT, last_four TEXT, status TEXT DEFAULT 'active', merged_into TEXT);
    CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT, amount_cents INTEGER, status TEXT, settled_at TEXT, custom_store_id TEXT);
    CREATE TABLE card_payments_log (id TEXT PRIMARY KEY, store_id TEXT, card_last4 TEXT, date TEXT, amount_cents INTEGER, method TEXT, notes TEXT, category TEXT, platform TEXT, status TEXT, resolution_note TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE fb_funding_cards (last4 TEXT PRIMARY KEY, bank_account_id TEXT, learned_from TEXT, created_at TEXT);
    INSERT INTO stores VALUES ('purebite', 'Purebite');
    INSERT INTO bank_accounts (id, store_id, institution_name, account_name, account_type, last_four) VALUES
      ('amex-plat', 'magvita', 'American Express', 'Business Platinum Card', 'credit', '1009'),
      ('chk', 'purebite', 'Bank of America', 'PUREBITE', 'depository', '5653');
    INSERT INTO bank_transactions (id, bank_account_id, date, description, amount_cents, status) VALUES
      ('w1', 'amex-plat', '2026-09-15', 'WHOP.COM 790239', -20000, 'posted'),
      ('w2', 'amex-plat', '2026-09-16', 'WHOP.COM',        -19160, 'posted'),
      ('w3', 'amex-plat', '2026-09-17', 'WHOP.COM',        -10000, 'posted'),
      ('other', 'amex-plat', '2026-09-17', 'SHIPHERO.COM', -22569, 'posted');
  `);
  return db;
}
const pay = (db: any, over: Partial<Parameters<typeof logChargePayment>[1]> = {}) =>
  logChargePayment(db, { storeId: 'purebite', cardLast4: '1009', date: '2026-09-17', amountCents: 49160, txnIds: ['w1', 'w2', 'w3'], ...over } as any);

describe('paying off ordinary card charges', () => {
  it('records the payment, settles the charges and ties them together', () => {
    const db = fixture();
    const r = pay(db);
    expect(r).toMatchObject({ linked: 3, newlySettled: 3, alreadySettled: 0, appliedCents: 49160, differenceCents: 0 });
    const log: any = db.prepare('SELECT * FROM card_payments_log WHERE id = ?').get(r.paymentId);
    expect(log).toMatchObject({ store_id: 'purebite', card_last4: '1009', amount_cents: 49160, category: 'charge', status: 'active' });
    expect(db.prepare("SELECT count(*) n FROM bank_transactions WHERE settled_at IS NOT NULL").get()).toEqual({ n: 3 });
    expect(paymentsForCharges(db as any, ['w1', 'other']).get('w1')!.paymentId).toBe(r.paymentId);
    expect(paymentsForCharges(db as any, ['other']).size).toBe(0);
  });

  it('shows up as a payment in flight until the bank takes it', () => {
    const db = fixture();
    pay(db);
    const before = getPaymentsInFlight(db as any, 'purebite', 21);
    expect(before.totalCents).toBe(49160);

    // the bank debit lands
    db.prepare(`INSERT INTO bank_transactions (id, bank_account_id, date, description, amount_cents, status)
      VALUES ('debit', 'chk', '2026-09-18', 'AMERICAN EXPRESS DES:ACH PMT ID:W1', -49160, 'posted')`).run();
    expect(getPaymentsInFlight(db as any, 'purebite', 21).totalCents).toBe(0);
  });

  it('a partial payment is recorded honestly, not rounded to fit', () => {
    const db = fixture();
    const r = pay(db, { amountCents: 30000 });
    expect(r.appliedCents).toBe(49160);
    expect(r.differenceCents).toBe(-19160);
    expect(db.prepare('SELECT amount_cents FROM card_payments_log').get()).toEqual({ amount_cents: 30000 });
  });

  it('charges already marked paid can still have their payment recorded afterwards', () => {
    const db = fixture();
    db.prepare("UPDATE bank_transactions SET settled_at = '2026-09-18T01:18:10.703Z' WHERE id IN ('w1','w2','w3')").run();
    const r = pay(db);
    expect(r).toMatchObject({ linked: 3, newlySettled: 0, alreadySettled: 3 });
    // the original settlement timestamp is history — recording the payment does not rewrite it
    expect(db.prepare("SELECT settled_at FROM bank_transactions WHERE id = 'w1'").get()).toEqual({ settled_at: '2026-09-18T01:18:10.703Z' });
  });

  it('never pays the same charge off twice', () => {
    const db = fixture();
    const first = pay(db, { txnIds: ['w1'], amountCents: 20000 });
    const second = pay(db, { txnIds: ['w1', 'w2'], amountCents: 39160 });
    expect(second.linked).toBe(1);
    expect(second.skipped).toEqual([{ txnId: 'w1', reason: `already paid by payment ${first.paymentId}` }]);
    expect(second.appliedCents).toBe(19160);
  });

  it('refuses a payment that names no card, no charges, or no money', () => {
    const db = fixture();
    expect(() => pay(db, { cardLast4: '' })).toThrow(/card/i);
    expect(() => pay(db, { txnIds: [] })).toThrow(/charges/i);
    expect(() => pay(db, { amountCents: 0 })).toThrow(/positive/i);
    expect(() => pay(db, { date: '09/17/2026' })).toThrow(/YYYY-MM-DD/);
    expect(db.prepare('SELECT count(*) n FROM card_payments_log').get()).toEqual({ n: 0 });
  });

  it('writes nothing at all when none of the charges exist', () => {
    const db = fixture();
    expect(() => pay(db, { txnIds: ['nope'] })).toThrow(/none of those charges/);
    expect(db.prepare('SELECT count(*) n FROM card_payments_log').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) n FROM card_payment_charges').get()).toEqual({ n: 0 });
  });

  it('deleting the payment releases the charges it settled', () => {
    const db = fixture();
    const r = pay(db);
    expect(deleteChargePayment(db as any, r.paymentId)).toEqual({ deleted: true, unsettled: 3 });
    expect(db.prepare('SELECT count(*) n FROM bank_transactions WHERE settled_at IS NOT NULL').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) n FROM card_payments_log').get()).toEqual({ n: 0 });
    expect(getPaymentsInFlight(db as any, 'purebite', 21).totalCents).toBe(0);
  });
});
