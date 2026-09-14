import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { reconcileLoggedPayments, maskOf, getPaymentsInFlight, getInFlightByAccount, type BankRow, type LoggedPayment } from './payments-in-flight';

// Shapes copied from prod on 2026-09-14: Amex payments show as a checking
// debit "AMERICAN EXPRESS DES:ACH PMT" + a card credit "ONLINE PAYMENT - THANK
// YOU"; BofA payments as "Online Banking payment to CRD 9215" + "ONLINE PAYMENT
// FROM CHK 7…". Logged masks come in as "1654", "Amex - 1009", "paypal".

const ALIASES = new Map<string, string[]>([
  ['9215', ['boa-9215']], ['1654', ['boa-9215']],        // BofA twin masks, merged
  ['1009', ['amex-plat', 'amex-gold']], ['2976', ['amex-plat']], // Gold + Platinum both ··1009
]);
const TODAY = '2026-09-14';

const log = (id: string, date: string, amt: number, card: string, store = 'elvris'): LoggedPayment =>
  ({ id, store_id: store, date, amount_cents: amt, card_last4: card });
const row = (id: string, acct: string, type: string, date: string, amt: number, desc: string, status = 'posted'): BankRow =>
  ({ id, bank_account_id: acct, account_type: type, date, amount_cents: amt, status, description: desc });

describe('maskOf', () => {
  it('takes the last 4-digit run of a free-text card label', () => {
    expect(maskOf('1654')).toBe('1654');
    expect(maskOf('Amex - 1009')).toBe('1009');
    expect(maskOf('Mastercard - 0775')).toBe('0775');
    expect(maskOf('paypal')).toBeNull();
    expect(maskOf('')).toBeNull();
  });
});

describe('reconcileLoggedPayments', () => {
  it('flags a fresh logged payment with no bank movement as too_recent, an older one as not_taken', () => {
    const r = reconcileLoggedPayments([
      log('a', '2026-09-13', 450000, '1654'),
      log('b', '2026-09-05', 1100000, '1022'),
    ], [], ALIASES, TODAY);
    expect(r.get('a')!.status).toBe('too_recent');
    expect(r.get('b')!.status).toBe('not_taken');
  });

  it('clears on the card credit through the alias map (··1654 logged, ··9215 account)', () => {
    const r = reconcileLoggedPayments([log('a', '2026-08-19', 398491, '1654')], [
      row('c1', 'boa-9215', 'credit', '2026-08-19', 398491, 'ONLINE PAYMENT FROM CHK 7904'),
    ], ALIASES, TODAY);
    expect(r.get('a')).toMatchObject({ status: 'confirmed', bankTxnId: 'c1', via: 'card_credit' });
  });

  it('clears a supplementary-card payment on the Platinum account and accepts either ··1009 twin', () => {
    const r = reconcileLoggedPayments([
      log('a', '2026-09-05', 100000, '2976'),
      log('b', '2026-08-24', 514436, 'Amex - 1009'),
    ], [
      row('c1', 'amex-plat', 'credit', '2026-09-05', 100000, 'ONLINE PAYMENT - THANK YOU'),
      row('c2', 'amex-gold', 'credit', '2026-08-24', 514436, 'ONLINE PAYMENT - THANK YOU'),
    ], ALIASES, TODAY);
    expect(r.get('a')!.status).toBe('confirmed');
    expect(r.get('b')!.status).toBe('confirmed');
  });

  it('clears on a checking debit that reads like a card payment, never on a plain transfer', () => {
    const r = reconcileLoggedPayments([
      log('a', '2026-09-03', 580000, '3304'),
      log('b', '2026-09-05', 100000, '2976'),
    ], [
      row('d1', 'chk-2240', 'depository', '2026-09-04', -580000, 'AMERICAN EXPRESS DES:ACH PMT ID:W7'),
      row('d2', 'chk-7881', 'depository', '2026-09-11', -100000, 'Online Banking transfer to CHK 5411'),
    ], ALIASES, TODAY);
    expect(r.get('a')).toMatchObject({ status: 'confirmed', via: 'checking_debit' });
    expect(r.get('b')!.status).toBe('not_taken');
  });

  it('a charge on the card never clears a payment (sign matters)', () => {
    const r = reconcileLoggedPayments([log('a', '2026-09-12', 55966, 'Amex - 1009')], [
      row('x', 'amex-plat', 'credit', '2026-09-12', -55966, 'FACEBK PAYMENT 7XKQ2'),
    ], ALIASES, TODAY);
    expect(r.get('a')!.status).toBe('too_recent');
  });

  it('two identical logs need two real payments — both legs of one payment are consumed together', () => {
    const one = [
      row('d1', 'chk-5653', 'depository', '2026-08-06', -200000, 'AMERICAN EXPRESS DES:ACH PMT ID:W3'),
      row('c1', 'amex-plat', 'credit', '2026-08-06', 200000, 'ONLINE PAYMENT - THANK YOU'),
    ];
    const logs = [log('a', '2026-08-06', 200000, '2976'), log('b', '2026-08-06', 200000, '2976')];
    const r1 = reconcileLoggedPayments(logs, one, ALIASES, TODAY);
    expect([r1.get('a')!.status, r1.get('b')!.status].sort()).toEqual(['confirmed', 'not_taken']);

    const two = [...one,
      row('d2', 'chk-5653', 'depository', '2026-08-07', -200000, 'AMERICAN EXPRESS DES:ACH PMT ID:W9'),
      row('c2', 'amex-plat', 'credit', '2026-08-07', 200000, 'ONLINE PAYMENT - THANK YOU'),
    ];
    const r2 = reconcileLoggedPayments(logs, two, ALIASES, TODAY);
    expect(r2.get('a')!.status).toBe('confirmed');
    expect(r2.get('b')!.status).toBe('confirmed');
  });

  it('posted rows win over pending; a pending-only match reads pending (not in flight)', () => {
    const r = reconcileLoggedPayments([log('a', '2026-09-10', 130000, '0775')], [
      row('p', 'chk-7881', 'depository', '2026-09-10', -130000, 'Online Banking payment to CRD 0512', 'pending'),
      row('q', 'chk-7881', 'depository', '2026-09-12', -130000, 'Online Banking payment to CRD 0512'),
    ], new Map([['0775', ['boa-0512']]]), TODAY);
    expect(r.get('a')).toMatchObject({ status: 'confirmed', bankTxnId: 'q' });
    const r2 = reconcileLoggedPayments([log('a', '2026-09-10', 130000, '0775')], [
      row('p', 'chk-7881', 'depository', '2026-09-10', -130000, 'Online Banking payment to CRD 0512', 'pending'),
    ], new Map(), TODAY);
    expect(r2.get('a')!.status).toBe('pending');
  });

  it('ignores bank rows outside the −3/+10 day window', () => {
    const r = reconcileLoggedPayments([log('a', '2026-09-01', 500000, '2976')], [
      row('c', 'amex-plat', 'credit', '2026-08-20', 500000, 'ONLINE PAYMENT - THANK YOU'),
      row('d', 'chk', 'depository', '2026-09-15', -500000, 'AMERICAN EXPRESS DES:ACH PMT'),
    ], ALIASES, TODAY);
    expect(r.get('a')!.status).toBe('not_taken');
  });
});

describe('getPaymentsInFlight (db)', () => {
  it('returns only this store\'s uncleared active logs in the window, with the total', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, account_type TEXT, last_four TEXT, status TEXT DEFAULT 'active', merged_into TEXT);
      CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT, amount_cents INTEGER, status TEXT);
      CREATE TABLE fb_funding_cards (last4 TEXT PRIMARY KEY, bank_account_id TEXT, learned_from TEXT);
      CREATE TABLE card_payments_log (id TEXT PRIMARY KEY, store_id TEXT, card_last4 TEXT, date TEXT, amount_cents INTEGER, notes TEXT, status TEXT DEFAULT 'active');
      INSERT INTO stores VALUES ('elvris','Elvris'), ('areya','Areya');
      INSERT INTO bank_accounts VALUES ('boa-9215','credit','9215','active',NULL), ('boa-1654','credit','1654','merged','boa-9215'), ('chk','depository','7904','active',NULL);
    `);
    const d = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const ins = db.prepare('INSERT INTO card_payments_log (id, store_id, card_last4, date, amount_cents, notes, status) VALUES (?,?,?,?,?,?,?)');
    ins.run('fresh', 'elvris', '1654', d(1), 450000, null, 'active');
    ins.run('fresh2', 'elvris', '1654', d(1), 47522, 'sent to shipsource', 'active');
    ins.run('cleared', 'elvris', '1654', d(5), 398491, null, 'active');
    ins.run('other-store', 'areya', '1654', d(2), 573566, null, 'active');
    ins.run('voided', 'elvris', '1654', d(2), 99900, null, 'resolved');
    ins.run('old', 'elvris', '1654', d(40), 12300, null, 'active');
    // 'OLD' and 'N/A' sort ABOVE every ISO date in SQLite string comparison —
    // a plain date >= filter would let them through.
    ins.run('undated', 'elvris', '2976', 'OLD', 834325, null, 'active');
    ins.run('na', 'elvris', '2976', 'N/A', 50000, null, 'active');
    db.prepare('INSERT INTO bank_transactions VALUES (?,?,?,?,?,?)').run('c1', 'boa-9215', d(5), 'ONLINE PAYMENT FROM CHK 7904', 398491, 'posted');

    const r = getPaymentsInFlight(db, 'elvris', 21);
    expect(r.rows.map(x => x.id).sort()).toEqual(['fresh', 'fresh2']);
    expect(r.totalCents).toBe(450000 + 47522);
    expect(r.rows.find(x => x.id === 'fresh2')!.notes).toBe('sent to shipsource');
    expect(getPaymentsInFlight(db, 'areya', 21).totalCents).toBe(573566);
  });

  it('groups in-flight payments by the card account they are headed to, across stores, via aliases', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, account_type TEXT, last_four TEXT, status TEXT DEFAULT 'active', merged_into TEXT);
      CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT, amount_cents INTEGER, status TEXT);
      CREATE TABLE fb_funding_cards (last4 TEXT PRIMARY KEY, bank_account_id TEXT, learned_from TEXT);
      CREATE TABLE card_payments_log (id TEXT PRIMARY KEY, store_id TEXT, card_last4 TEXT, date TEXT, amount_cents INTEGER, notes TEXT, status TEXT DEFAULT 'active');
      INSERT INTO stores VALUES ('elvris','Elvris'), ('areya','Areya');
      INSERT INTO bank_accounts VALUES ('boa-9215','credit','9215','active',NULL), ('boa-1654','credit','1654','merged','boa-9215'),
        ('amex-gold','credit','1009','active',NULL), ('amex-plat','credit','1009','active',NULL), ('chk','depository','7904','active',NULL);
    `);
    const d = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const ins = db.prepare('INSERT INTO card_payments_log (id, store_id, card_last4, date, amount_cents) VALUES (?,?,?,?,?)');
    ins.run('a', 'elvris', '1654', d(1), 450000);
    ins.run('b', 'elvris', '1654', d(1), 47522);
    ins.run('c', 'areya', '9215', d(2), 100000);
    ins.run('d', 'elvris', 'Amex - 1009', d(1), 55966);
    ins.run('e', 'elvris', 'paypal', d(1), 38195);     // no card → not attributed anywhere

    const by = getInFlightByAccount(db, 21);
    const boa = by.get('boa-9215')!;
    expect(boa.cents).toBe(450000 + 47522 + 100000);
    expect(boa.ambiguous_cents).toBe(0);
    expect(boa.rows.map(r => r.store_name).sort()).toEqual(['Areya', 'Elvris', 'Elvris']);
    // both ··1009 accounts see the Amex payment, flagged ambiguous, never in `cents`
    for (const id of ['amex-gold', 'amex-plat']) {
      expect(by.get(id)!.cents).toBe(0);
      expect(by.get(id)!.ambiguous_cents).toBe(55966);
      expect(by.get(id)!.rows[0].ambiguous).toBe(true);
    }
    expect(by.size).toBe(3);
  });
});
