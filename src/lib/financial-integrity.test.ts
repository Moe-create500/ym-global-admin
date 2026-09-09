import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureIntegritySchema, recordTxnRevision, getFinancialHealth } from './financial-integrity';

// Integrity invariants: DB-level idempotency, source-truth revision history,
// and the health scan's honesty (issues computed from evidence only).

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, status TEXT DEFAULT 'active', account_type TEXT DEFAULT 'depository',
      provider TEXT, balance_available_cents INTEGER, balance_updated_at TEXT);
    CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, teller_transaction_id TEXT,
      date TEXT, description TEXT, amount_cents INTEGER, status TEXT, category TEXT, custom_category TEXT);
    CREATE TABLE ad_spend (id TEXT PRIMARY KEY, store_id TEXT, date TEXT, platform TEXT, ad_id TEXT, spend_cents INTEGER);
    CREATE TABLE plaid_items (item_id TEXT PRIMARY KEY, status TEXT DEFAULT 'active', provider_error_code TEXT);
    CREATE TABLE sync_runs (id TEXT PRIMARY KEY, status TEXT, started_at TEXT);
    CREATE TABLE txn_links (txn_id TEXT PRIMARY KEY, pair_txn_id TEXT);
    CREATE TABLE card_statements (bank_account_id TEXT PRIMARY KEY, statement_balance_cents INTEGER);
  `);
  ensureIntegritySchema(db);
  return db;
}

describe('database-level idempotency', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('replayed provider transaction id is REJECTED by the database itself', () => {
    db.prepare("INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, amount_cents) VALUES ('t1','a1','plaid-abc','2026-09-01',-500)").run();
    expect(() =>
      db.prepare("INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, amount_cents) VALUES ('t2','a1','plaid-abc','2026-09-01',-500)").run()
    ).toThrow(/UNIQUE/);
  });

  it('replayed ad_spend business key is REJECTED by the database itself', () => {
    db.prepare("INSERT INTO ad_spend (id, store_id, date, platform, ad_id, spend_cents) VALUES ('s1','st1','2026-09-01','facebook','ad9',1000)").run();
    expect(() =>
      db.prepare("INSERT INTO ad_spend (id, store_id, date, platform, ad_id, spend_cents) VALUES ('s2','st1','2026-09-01','facebook','ad9',1000)").run()
    ).toThrow(/UNIQUE/);
  });

  it('NULL provider ids do not collide (manual/CSV rows remain insertable)', () => {
    db.prepare("INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, amount_cents) VALUES ('t1','a1',NULL,'2026-09-01',-500)").run();
    db.prepare("INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, amount_cents) VALUES ('t2','a1',NULL,'2026-09-01',-500)").run();
    expect((db.prepare('SELECT COUNT(*) n FROM bank_transactions').get() as any).n).toBe(2);
  });
});

describe('source-truth revisions', () => {
  it('prior state is preserved before provider modification/removal', () => {
    const db = freshDb();
    const oldRow = { id: 't1', amount_cents: -500, date: '2026-09-01', description: 'PENDING HOLD' };
    recordTxnRevision(db, 't1', 'provider_modified', oldRow, { ...oldRow, amount_cents: -520, description: 'SETTLED' });
    recordTxnRevision(db, 't1', 'provider_removed', { ...oldRow, amount_cents: -520 }, null);
    const revs: any[] = db.prepare("SELECT * FROM txn_revisions WHERE txn_id = 't1' ORDER BY id").all();
    expect(revs).toHaveLength(2);
    expect(JSON.parse(revs.find(r => r.change_type === 'provider_modified')!.old_json).amount_cents).toBe(-500);
    expect(revs.find(r => r.change_type === 'provider_removed')!.new_json).toBeNull();
  });
});

describe('financial health scan honesty', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('clean system reports zero issues — no invented problems', () => {
    expect(getFinancialHealth(db).issues).toHaveLength(0);
  });

  it('provider reauth errors surface as critical', () => {
    db.prepare("INSERT INTO plaid_items (item_id, provider_error_code) VALUES ('i1','ITEM_LOGIN_REQUIRED')").run();
    const issues = getFinancialHealth(db).issues;
    expect(issues.find(i => i.key === 'connections_action')?.severity).toBe('critical');
  });

  it('transient errors do NOT surface as reauth issues', () => {
    db.prepare("INSERT INTO plaid_items (item_id, provider_error_code) VALUES ('i1','RATE_LIMIT_EXCEEDED')").run();
    expect(getFinancialHealth(db).issues.find(i => i.key === 'connections_action')).toBeUndefined();
  });

  it('stale balances counted with their last-known dollar exposure', () => {
    db.prepare("INSERT INTO bank_accounts (id, balance_available_cents, balance_updated_at) VALUES ('a1', 123400, datetime('now','-3 days'))").run();
    const i = getFinancialHealth(db).issues.find(x => x.key === 'stale_balances');
    expect(i?.count).toBe(1);
    expect(i?.amount_cents).toBe(123400);
  });

  it('unlinked opposite-amount cross-account pairs surface as transfer suspects', () => {
    db.prepare("INSERT INTO bank_accounts (id, balance_updated_at) VALUES ('a1', datetime('now'))").run();
    db.prepare("INSERT INTO bank_accounts (id, balance_updated_at) VALUES ('a2', datetime('now'))").run();
    db.prepare("INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, amount_cents, category) VALUES ('out','a1','p1',date('now','-5 days'),-310000,'x')").run();
    db.prepare("INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, amount_cents, category) VALUES ('in','a2','p2',date('now','-4 days'),310000,'x')").run();
    const i = getFinancialHealth(db).issues.find(x => x.key === 'transfer_suspects');
    expect(i?.count).toBe(1);
    expect(i?.amount_cents).toBe(310000);
  });

  it('possible_duplicate accounts always surface as critical', () => {
    db.prepare("INSERT INTO bank_accounts (id, status, balance_updated_at) VALUES ('a1','possible_duplicate',datetime('now'))").run();
    expect(getFinancialHealth(db).issues.find(i => i.key === 'possible_dup_accounts')?.severity).toBe('critical');
  });
});
