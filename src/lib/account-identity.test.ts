import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureIdentitySchema, scanDuplicateAccounts, mergeAccounts, findCanonicalMatch } from './account-identity';

// Adversarial tests for canonical account identity: reconnects, provider id
// rotation, twin masks, merge idempotency, transaction migration w/o dupes.

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE bank_accounts (
      id TEXT PRIMARY KEY, store_id TEXT, teller_enrollment_id TEXT, teller_account_id TEXT,
      institution_name TEXT, account_name TEXT, nickname TEXT, account_type TEXT, account_subtype TEXT,
      last_four TEXT, balance_available_cents INTEGER, balance_ledger_cents INTEGER,
      balance_updated_at TEXT, status TEXT DEFAULT 'active', provider TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE bank_transactions (
      id TEXT PRIMARY KEY, bank_account_id TEXT, teller_transaction_id TEXT,
      date TEXT, description TEXT, amount_cents INTEGER, status TEXT);
    CREATE TABLE txn_links (txn_id TEXT PRIMARY KEY, pair_txn_id TEXT, class TEXT);
    CREATE TABLE card_statements (bank_account_id TEXT PRIMARY KEY, statement_balance_cents INTEGER);
    CREATE TABLE fb_funding_cards (last4 TEXT PRIMARY KEY, bank_account_id TEXT);
    CREATE TABLE activity_log (id TEXT PRIMARY KEY, employee_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT, details TEXT, ip_address TEXT, created_at TEXT);
  `);
  ensureIdentitySchema(db);
  return db;
}

const acct = (db: Database.Database, o: any) =>
  db.prepare(`INSERT INTO bank_accounts (id, institution_name, account_name, account_type, last_four, status, provider, teller_account_id, teller_enrollment_id, balance_available_cents, balance_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.id, o.inst || 'Bank of America', o.name || 'Checking', o.type || 'depository', o.mask || '5653',
      o.status || 'active', o.provider || 'plaid', o.pid || o.id + '-p', o.item || 'item1', o.bal ?? 0, o.balAt || '2026-09-01 00:00:00');

const txn = (db: Database.Database, id: string, acctId: string, date: string, amt: number, desc: string) =>
  db.prepare('INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, description, amount_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, acctId, id + '-t', date, desc, amt, 'posted');

describe('duplicate scan', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('reconnected account (old disconnected + new active, same name) → merge proposal', () => {
    acct(db, { id: 'new', status: 'active', provider: 'plaid' });
    acct(db, { id: 'old', status: 'disconnected', provider: 'teller' });
    const { proposals, ambiguous } = scanDuplicateAccounts(db);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ keepId: 'new', dupId: 'old', confidence: 'exact_name' });
    expect(ambiguous).toHaveLength(0);
  });

  it('twin cards sharing a mask (Gold + Platinum ·1009) are NEVER cross-matched', () => {
    acct(db, { id: 'gold-new', name: 'Business Gold Card', mask: '1009', type: 'credit', status: 'active' });
    acct(db, { id: 'plat-new', name: 'Business Platinum Card®', mask: '1009', type: 'credit', status: 'active' });
    acct(db, { id: 'gold-old', name: 'Business Gold Card', mask: '1009', type: 'credit', status: 'disconnected', provider: 'teller' });
    acct(db, { id: 'plat-old', name: 'Business Platinum Card®', mask: '1009', type: 'credit', status: 'disconnected', provider: 'teller' });
    const { proposals } = scanDuplicateAccounts(db);
    expect(proposals).toHaveLength(2);
    expect(proposals.find(p => p.dupId === 'gold-old')!.keepId).toBe('gold-new');
    expect(proposals.find(p => p.dupId === 'plat-old')!.keepId).toBe('plat-new');
  });

  it('renamed-across-providers with exactly one active + one inactive → sole_candidate', () => {
    acct(db, { id: 'new', name: 'BofA Adv Checking', status: 'active' });
    acct(db, { id: 'old', name: 'Advantage Checking', status: 'disconnected' });
    const { proposals } = scanDuplicateAccounts(db);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].confidence).toBe('sole_candidate');
  });

  it('two ACTIVE rows with the same identity → ambiguous review, never auto-merge', () => {
    acct(db, { id: 'a1', status: 'active' });
    acct(db, { id: 'a2', status: 'active' });
    const { proposals, ambiguous } = scanDuplicateAccounts(db);
    expect(proposals).toHaveLength(0);
    expect(ambiguous.length).toBeGreaterThan(0);
  });
});

describe('mergeAccounts', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
    acct(db, { id: 'keep', status: 'active', provider: 'plaid', bal: 210770 });
    acct(db, { id: 'dup', status: 'disconnected', provider: 'teller', bal: 70632 });
  });

  it('moves unique history, dedupes content twins, cleans lineage', () => {
    txn(db, 'k1', 'keep', '2026-01-16', -2868, 'SHIPPO.COM SAN FRANCISCO CA');
    txn(db, 'd1', 'dup', '2026-01-16', -2868, 'SHIPPO.COM SAN FRANCISCO CA'); // twin → dedupe
    txn(db, 'd2', 'dup', '2025-11-02', -5000, 'OLD TELLER-ONLY CHARGE');      // unique → move
    db.prepare("INSERT INTO txn_links (txn_id, pair_txn_id, class) VALUES ('d1', NULL, 'other')").run();
    db.prepare("INSERT INTO txn_links (txn_id, pair_txn_id, class) VALUES ('x9', 'd1', 'card_payment')").run();

    const r = mergeAccounts(db, 'keep', 'dup');
    expect(r).toMatchObject({ merged: true, moved: 1, deduped: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM bank_transactions WHERE bank_account_id = 'keep'").get()).toMatchObject({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) n FROM bank_transactions WHERE bank_account_id = 'dup'").get()).toMatchObject({ n: 0 });
    // twin's link removed; the pair reference pointing at it nulled
    expect(db.prepare("SELECT COUNT(*) n FROM txn_links WHERE txn_id = 'd1'").get()).toMatchObject({ n: 0 });
    expect(db.prepare("SELECT pair_txn_id FROM txn_links WHERE txn_id = 'x9'").get()).toMatchObject({ pair_txn_id: null });
    // dup preserved as merged, both connections in history, audit row written
    expect(db.prepare("SELECT status, merged_into FROM bank_accounts WHERE id = 'dup'").get()).toMatchObject({ status: 'merged', merged_into: 'keep' });
    expect((db.prepare("SELECT COUNT(*) n FROM account_connections WHERE account_id = 'keep'").get() as any).n).toBe(2);
    expect((db.prepare("SELECT COUNT(*) n FROM activity_log WHERE action = 'account_merge'").get() as any).n).toBe(1);
  });

  it('is idempotent — second merge is a no-op', () => {
    txn(db, 'd2', 'dup', '2025-11-02', -5000, 'OLD CHARGE');
    mergeAccounts(db, 'keep', 'dup');
    const before = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) s FROM bank_transactions').get() as any;
    const r2 = mergeAccounts(db, 'keep', 'dup');
    expect(r2.merged).toBe(false);
    const after = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) s FROM bank_transactions').get() as any;
    expect(after).toEqual(before);
  });

  it('dryRun reports counts without writing', () => {
    txn(db, 'd2', 'dup', '2025-11-02', -5000, 'OLD CHARGE');
    const r = mergeAccounts(db, 'keep', 'dup', { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, moved: 1, deduped: 0 });
    expect(db.prepare("SELECT status FROM bank_accounts WHERE id = 'dup'").get()).toMatchObject({ status: 'disconnected' });
  });

  it('refuses cross-identity merges and wrong-direction merges', () => {
    acct(db, { id: 'other', mask: '9999', status: 'disconnected' });
    expect(() => mergeAccounts(db, 'keep', 'other')).toThrow(/mismatch/);
    db.prepare("UPDATE bank_accounts SET status = 'disconnected' WHERE id = 'keep'").run();
    db.prepare("UPDATE bank_accounts SET status = 'active' WHERE id = 'dup'").run();
    expect(() => mergeAccounts(db, 'keep', 'dup')).toThrow(/direction/);
  });
});

describe('findCanonicalMatch (pre-insert guard)', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('provider account id wins outright', () => {
    acct(db, { id: 'a', pid: 'plaid-abc' });
    const r = findCanonicalMatch(db, { institution: 'X', mask: '0000', type: 'credit', providerAccountId: 'plaid-abc' });
    expect(r.match?.id).toBe('a');
  });

  it('provider id rotation → matches by institution+mask+type+name', () => {
    acct(db, { id: 'a', pid: 'old-id', name: 'Business Gold Card', mask: '1006', type: 'credit' });
    const r = findCanonicalMatch(db, { institution: 'Bank of America', mask: '1006', type: 'credit', name: 'Business Gold Card', providerAccountId: 'rotated-new-id' });
    expect(r.match?.id).toBe('a');
    expect(r.ambiguous).toBe(false);
  });

  it('twin masks with no name match → ambiguous, no guessing', () => {
    acct(db, { id: 'gold', name: 'Business Gold Card', mask: '1009', type: 'credit' });
    acct(db, { id: 'plat', name: 'Business Platinum Card®', mask: '1009', type: 'credit' });
    const r = findCanonicalMatch(db, { institution: 'Bank of America', mask: '1009', type: 'credit', name: 'Business Green Card' });
    expect(r.match).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toHaveLength(2);
  });

  it('merged rows never match — they are history, not accounts', () => {
    acct(db, { id: 'dead', status: 'merged', pid: 'plaid-dead' });
    const r = findCanonicalMatch(db, { institution: 'Bank of America', mask: '5653', type: 'depository', providerAccountId: 'plaid-dead' });
    expect(r.match).toBeNull();
  });
});

describe('same-card merge across differing masks (BoA card no. vs account no.)', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  const pair = () => {
    // one real card, exposed twice: ··1654 is the plastic, ··9215 the account
    acct(db, { id: 'keep', name: 'CORP Account - Business Adv Unlimited Cash Rewards - 9215', mask: '9215', type: 'credit' });
    acct(db, { id: 'dup', name: 'Business Adv Unlimited Cash Rewards - 1654', mask: '1654', type: 'credit' });
  };

  it('refuses a mask mismatch by default — a different number is normally a different account', () => {
    pair();
    expect(() => mergeAccounts(db, 'keep', 'dup')).toThrow(/mask mismatch/);
  });

  it('still refuses when institution or type differ, assertion or not', () => {
    acct(db, { id: 'keep', inst: 'Bank of America', mask: '9215', type: 'credit' });
    acct(db, { id: 'dup', inst: 'American Express', mask: '1654', type: 'credit' });
    expect(() => mergeAccounts(db, 'keep', 'dup', { assertSameCard: 'same plastic' }))
      .toThrow(/institution\/type mismatch/);
  });

  it('merges when a human asserts the two masks are one card', () => {
    pair();
    txn(db, 't1', 'dup', '2026-08-26', -115853, 'FACEBK *V7W4C56MD4');   // twin
    txn(db, 't2', 'keep', '2026-08-26', -115853, 'FACEBK *V7W4C56MD4');  // twin
    txn(db, 't3', 'dup', '2026-07-15', -50000, 'FACEBOOKAD* UNIQUE');    // unique history
    const r = mergeAccounts(db, 'keep', 'dup', { assertSameCard: 'BoA: 9215 is the account number of card 1654' });
    expect(r.merged).toBe(true);
    expect(r.deduped).toBe(1);   // the double-counted copy is gone
    expect(r.moved).toBe(1);     // unique history is preserved on the survivor
    const dup: any = db.prepare('SELECT status, merged_into FROM bank_accounts WHERE id = ?').get('dup');
    expect(dup.status).toBe('merged');
    expect(dup.merged_into).toBe('keep');
    const left = db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE bank_account_id = ?').get('dup') as any;
    expect(left.n).toBe(0);
  });

  it('records the assertion and both masks in the audit log', () => {
    pair();
    mergeAccounts(db, 'keep', 'dup', { assertSameCard: 'confirmed by Moe', actor: 'admin' });
    const log: any = db.prepare("SELECT details FROM activity_log WHERE action = 'account_merge'").get();
    const d = JSON.parse(log.details);
    expect(d.same_card_assertion).toBe('confirmed by Moe');
    expect(d.keep_mask).toBe('9215');
    expect(d.dup_mask).toBe('1654');
  });

  it('the losing mask still resolves to the survivor after the merge', async () => {
    const { getCardAliasMap } = await import('./funding-cards');
    pair();
    mergeAccounts(db, 'keep', 'dup', { assertSameCard: 'one card' });
    const aliases = getCardAliasMap(db);
    expect(aliases.get('1654')).toBe('keep');   // Meta's label finds the real account
    expect(aliases.get('9215')).toBe('keep');
  });

  it('a live mask always beats an inherited one', async () => {
    const { getCardAliasMap } = await import('./funding-cards');
    pair();
    mergeAccounts(db, 'keep', 'dup', { assertSameCard: 'one card' });
    // a genuinely different, live card later takes the ··1654 mask
    acct(db, { id: 'other', name: 'Some Other Card', mask: '1654', type: 'credit' });
    expect(getCardAliasMap(db).get('1654')).toBe('other');
  });
});
