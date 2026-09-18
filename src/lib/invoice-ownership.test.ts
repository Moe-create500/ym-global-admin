import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { findCrossStoreConflicts, summariseConflicts, findExistingDuplicates, inferSeriesOwners } from './invoice-ownership';

function db0() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE shopify_invoices (id TEXT PRIMARY KEY, store_id TEXT, bill_number TEXT, date TEXT, total_cents INTEGER, source TEXT, created_at TEXT);
    INSERT INTO stores VALUES ('marroomi','Marroomi'), ('magvita','Magvita'), ('serevia','Serevia');
  `);
  return db;
}
const add = (db: any, id: string, store: string, bill: string, cents: number, created: string) =>
  db.prepare("INSERT INTO shopify_invoices (id, store_id, bill_number, date, total_cents, source, created_at) VALUES (?,?,?,?,?,'chargeflow',?)")
    .run(id, store, bill, created.slice(0, 10), cents, created);

describe('a Shopify bill number belongs to one shop', () => {
  it('flags the bills in an upload that already belong to another store', () => {
    const db = db0();
    add(db, 'a', 'marroomi', '6KAGJZ0C-0100', 39000, '2026-04-11');
    add(db, 'b', 'marroomi', '6KAGJZ0C-0101', 31200, '2026-04-12');
    const c = findCrossStoreConflicts(db as any, 'magvita', ['6KAGJZ0C-0100', '6KAGJZ0C-0101', 'NEW-0001']);
    expect(c.map(x => x.billNumber).sort()).toEqual(['6KAGJZ0C-0100', '6KAGJZ0C-0101']);
    const s = summariseConflicts(c, 'Magvita')!;
    expect(s).toMatchObject({ conflicts: 2, centsElsewhere: 70200 });
    expect(s.message).toContain('Marroomi (2)');
    expect(s.message).toContain('would count the same cost twice');
  });

  it('re-importing a store\'s OWN bills is not a conflict', () => {
    const db = db0();
    add(db, 'a', 'marroomi', '6KAGJZ0C-0100', 39000, '2026-04-11');
    expect(findCrossStoreConflicts(db as any, 'marroomi', ['6KAGJZ0C-0100'])).toEqual([]);
    expect(summariseConflicts([], 'Marroomi')).toBeNull();
  });

  it('handles an upload larger than one SQL parameter chunk', () => {
    const db = db0();
    const bills: string[] = [];
    for (let i = 0; i < 900; i++) { const b = `X-${i}`; bills.push(b); add(db, `r${i}`, 'marroomi', b, 100, '2026-04-11'); }
    expect(findCrossStoreConflicts(db as any, 'magvita', bills)).toHaveLength(900);
  });
});

describe('finding the duplicates already in', () => {
  it('counts the phantom cost as every copy beyond the first', () => {
    const db = db0();
    add(db, 'a', 'marroomi', 'B-1', 10000, '2026-04-11');
    add(db, 'b', 'magvita', 'B-1', 10000, '2026-08-28');
    add(db, 'c', 'serevia', 'B-1', 10000, '2026-07-20');
    add(db, 'd', 'marroomi', 'B-2', 5000, '2026-04-11');   // not duplicated
    const r = findExistingDuplicates(db as any);
    expect(r).toMatchObject({ totalBills: 1, totalRows: 3, phantomCents: 20000 });
    expect(r.groups[0].stores.map(s => s.storeName)).toEqual(['Marroomi', 'Serevia', 'Magvita']);
  });

  it('reports nothing when every bill sits under one store', () => {
    const db = db0();
    add(db, 'a', 'marroomi', 'B-1', 10000, '2026-04-11');
    expect(findExistingDuplicates(db as any)).toMatchObject({ totalBills: 0, totalRows: 0, phantomCents: 0 });
  });
});

describe('who owns a bill series', () => {
  it('the store that received it across many days owns it; single-day bulk loads are copies', () => {
    const db = db0();
    for (let d = 1; d <= 10; d++) add(db, `m${d}`, 'marroomi', `6KAGJZ0C-${d}`, 1000, `2026-04-${String(d).padStart(2, '0')}`);
    for (let d = 1; d <= 10; d++) add(db, `g${d}`, 'magvita', `6KAGJZ0C-${d}`, 1000, '2026-08-28');
    const [s] = inferSeriesOwners(db as any);
    expect(s.prefix).toBe('6KAGJZ0C');
    expect(s.owner).toMatchObject({ storeName: 'Marroomi', distinctDays: 10 });
    expect(s.copies).toEqual([{ storeId: 'magvita', storeName: 'Magvita', rows: 10, distinctDays: 1, cents: 10000 }]);
    expect(s.basis).toContain('10 separate days');
  });

  it('refuses to pick an owner when two stores both have a history', () => {
    const db = db0();
    for (let d = 1; d <= 6; d++) { add(db, `m${d}`, 'marroomi', `P-${d}`, 100, `2026-04-0${d}`); add(db, `g${d}`, 'magvita', `P-${d}`, 100, `2026-05-0${d}`); }
    const [s] = inferSeriesOwners(db as any);
    expect(s.owner).toBeNull();
    expect(s.basis).toContain('needs a human');
  });

  it('refuses when every store got it in one bulk load', () => {
    const db = db0();
    add(db, 'a', 'marroomi', '88C8B393-1', 100, '2026-07-20');
    add(db, 'b', 'magvita', '88C8B393-1', 100, '2026-07-15');
    const [s] = inferSeriesOwners(db as any);
    expect(s.owner).toBeNull();
    expect(s.basis).toContain('no evidence of ownership');
  });

  it('ignores a series only one store has', () => {
    const db = db0();
    add(db, 'a', 'marroomi', 'SOLO-1', 100, '2026-07-20');
    expect(inferSeriesOwners(db as any)).toEqual([]);
  });
});
