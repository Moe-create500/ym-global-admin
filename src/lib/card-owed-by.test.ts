import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { getOwedByForCards } from './card-owed-by';

const d = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, store_id TEXT, account_type TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT, amount_cents INTEGER);
    CREATE TABLE classification_results (txn_id TEXT PRIMARY KEY, store_id TEXT);
    INSERT INTO stores VALUES ('areya','Areya'), ('elvris','Elvris'), ('ss','ShipSourced');
    INSERT INTO bank_accounts VALUES ('card','holding','credit','active'), ('chk-areya','areya','depository','active'),
      ('chk-shared','holding','depository','active'), ('chk-old','areya','depository','merged');
  `);
  return db;
}
const txn = (db: Database.Database, id: string, acct: string, date: string, amt: number, desc: string, store?: string) => {
  db.prepare('INSERT INTO bank_transactions VALUES (?,?,?,?,?)').run(id, acct, date, desc, amt);
  if (store) db.prepare('INSERT INTO classification_results VALUES (?,?)').run(id, store);
};

describe('getOwedByForCards', () => {
  it('charges by paired store minus payments traced to the paying store, unpaired and unknown payers separated', () => {
    const db = freshDb();
    txn(db, 'c1', 'card', d(10), -300000, 'FACEBK ADS', 'areya');
    txn(db, 'c2', 'card', d(9), -100000, 'FACEBK ADS', 'areya');
    txn(db, 'c3', 'card', d(8), -50000, 'GOOGLE ADS', 'elvris');
    txn(db, 'c4', 'card', d(8), -25000, 'AMAZON MKTPL');                  // no store
    txn(db, 'r1', 'card', d(7), 5000, 'AMAZON REFUND');                    // refund, not a payment
    txn(db, 'p1', 'card', d(6), 250000, 'ONLINE PAYMENT FROM CHK 7878');   // Areya paid
    txn(db, 'd1', 'chk-areya', d(6), -250000, 'Online Banking payment to CRD 9215');
    txn(db, 'p2', 'card', d(5), 50000, 'ONLINE PAYMENT FROM CHK 7904');    // shared account, verdict says Elvris
    txn(db, 'd2', 'chk-shared', d(4), -50000, 'Online Banking payment to CRD 9215', 'elvris');
    txn(db, 'p3', 'card', d(3), 20000, 'ONLINE PAYMENT - THANK YOU');      // no checking debit anywhere
    txn(db, 'd3', 'chk-shared', d(3), -20000, 'Online Banking transfer to CHK 5411'); // a transfer, not a card payment
    txn(db, 'p4', 'card', d(2), 30000, 'ONLINE PAYMENT - THANK YOU');
    txn(db, 'd4', 'chk-old', d(2), -30000, 'AMERICAN EXPRESS DES:ACH PMT'); // merged account is ignored

    const r = getOwedByForCards(db, ['card'], 90).get('card')!;
    expect(r.charged_cents).toBe(475000);
    expect(r.paid_cents).toBe(350000);
    expect(r.unpaired_cents).toBe(25000);
    expect(r.unpaired_count).toBe(1);
    expect(r.unknown_payer_cents).toBe(50000);
    expect(r.rows).toEqual([
      { store_id: 'areya', store_name: 'Areya', charged_cents: 400000, paid_cents: 250000, net_cents: 150000 },
    ]);
    // Elvris charged 50k and paid 50k → net 0 → dropped
  });

  it('a checking debit clears only one card credit; the closest date wins', () => {
    const db = freshDb();
    txn(db, 'p1', 'card', d(10), 100000, 'ONLINE PAYMENT - THANK YOU');
    txn(db, 'p2', 'card', d(4), 100000, 'ONLINE PAYMENT - THANK YOU');
    txn(db, 'd1', 'chk-areya', d(4), -100000, 'AMERICAN EXPRESS DES:ACH PMT');
    const r = getOwedByForCards(db, ['card'], 90).get('card')!;
    expect(r.unknown_payer_cents).toBe(100000);
    expect(r.rows).toEqual([{ store_id: 'areya', store_name: 'Areya', charged_cents: 0, paid_cents: 100000, net_cents: -100000 }]);
  });

  it('ignores everything before the window and never throws on an empty card', () => {
    const db = freshDb();
    txn(db, 'old', 'card', d(200), -999900, 'FACEBK ADS', 'areya');
    const r = getOwedByForCards(db, ['card', 'missing'], 90);
    expect(r.get('card')!.charged_cents).toBe(0);
    expect(r.get('card')!.rows).toEqual([]);
    expect(r.get('missing')!.rows).toEqual([]);
  });
});
