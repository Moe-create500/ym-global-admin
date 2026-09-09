import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { categorizeTransaction, saveResult } from './engine';
import { ensureCategorizeSchema, resolveMerchant, recordFeedback } from './merchants';

// Adversarial categorization tests. The invariants under test:
// manual beats everything; transfers/card payments are never P&L; identity ≠
// category; conflicting evidence abstains; the engine NEVER guesses.

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, status TEXT DEFAULT 'active', account_type TEXT DEFAULT 'depository',
      institution_name TEXT, last_four TEXT, company TEXT, store_id TEXT, nickname TEXT, account_name TEXT);
    CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT,
      amount_cents INTEGER, status TEXT, custom_category TEXT, category TEXT, counterparty TEXT, teller_transaction_id TEXT);
    CREATE TABLE ad_payments (id TEXT PRIMARY KEY, platform TEXT, date TEXT, amount_cents INTEGER);
    CREATE TABLE shopify_invoices (id TEXT PRIMARY KEY, store_id TEXT, date TEXT, total_cents INTEGER);
    CREATE TABLE merchant_store_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT, store_id TEXT,
      class TEXT, source TEXT DEFAULT 'user', enabled INTEGER DEFAULT 1, direction TEXT, note TEXT, created_at TEXT, last_used_at TEXT);
    CREATE TABLE txn_links (txn_id TEXT PRIMARY KEY, class TEXT, pair_txn_id TEXT);
  `);
  ensureCategorizeSchema(db);
  return db;
}

const acct = (db: Database.Database, id: string, type = 'depository', inst = 'Bank of America') =>
  db.prepare('INSERT INTO bank_accounts (id, account_type, institution_name, last_four) VALUES (?, ?, ?, ?)').run(id, type, inst, '1234');
const txn = (db: Database.Database, o: any) => {
  db.prepare('INSERT INTO bank_transactions (id, bank_account_id, date, description, amount_cents, custom_category) VALUES (?, ?, ?, ?, ?, ?)')
    .run(o.id, o.acct, o.date || '2026-09-01', o.desc || '', o.amt, o.manual || null);
  return db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(o.id);
};

describe('merchant identity', () => {
  it('FACEBK / FACEBOOK / META variations all resolve to Meta', () => {
    const db = freshDb();
    for (const d of ['FACEBK *82921', 'FACEBOOK ADS 8821', 'META PLATFORMS INC', 'FB ADS X91']) {
      expect(resolveMerchant(db, d)?.name).toBe('Meta');
    }
  });

  it('identity is not category: Shopify resolves as entity without forcing a category', () => {
    const db = freshDb();
    const m = resolveMerchant(db, 'SHOPIFY BILLING 12345');
    expect(m?.name).toBe('Shopify');
    expect(m?.default_purpose).toBeNull();
  });

  it('learned aliases need ≥3 confirmations before resolution trusts them', () => {
    const db = freshDb();
    const ent: any = db.prepare("SELECT id FROM merchant_entities WHERE name = 'Meta'").get();
    db.prepare("INSERT INTO merchant_aliases (id, merchant_id, pattern, source, confirmations) VALUES ('x', ?, 'weirdalias', 'learned', 1)").run(ent.id);
    expect(resolveMerchant(db, 'WEIRDALIAS PAYMENT')).toBeNull();
    db.prepare("UPDATE merchant_aliases SET confirmations = 3 WHERE id = 'x'").run();
    expect(resolveMerchant(db, 'WEIRDALIAS PAYMENT')?.name).toBe('Meta');
  });
});

describe('precedence + safety', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); acct(db, 'chk'); });

  it('manual lock beats everything, always', async () => {
    const t = txn(db, { id: 't1', acct: 'chk', desc: 'FACEBK *111', amt: -5000, manual: 'Inventory' });
    const r = await categorizeTransaction(db, t, { allowLlm: false });
    expect(r).toMatchObject({ category: 'Inventory', method: 'MANUAL', confidence: 1, needs_review: false });
  });

  it('checking → credit card payment pairs and NEVER becomes an expense', async () => {
    acct(db, 'card', 'credit', 'American Express');
    txn(db, { id: 'credit-leg', acct: 'card', date: '2026-09-02', desc: 'ONLINE PAYMENT - THANK YOU', amt: 500000 });
    const t = txn(db, { id: 'debit-leg', acct: 'chk', date: '2026-09-01', desc: 'AMEX EPAYMENT ACH PMT', amt: -500000 });
    const r = await categorizeTransaction(db, t, { allowLlm: false });
    expect(r).toMatchObject({ category: 'Credit Card Payment', method: 'CARD_PAYMENT_MATCH', related_txn_id: 'credit-leg', needs_review: false });
  });

  it('bank ↔ bank transfer pairs as Transfer, not income/expense', async () => {
    acct(db, 'sav');
    txn(db, { id: 'in-leg', acct: 'sav', date: '2026-09-01', desc: 'TRANSFER FROM CHK', amt: 310000 });
    const t = txn(db, { id: 'out-leg', acct: 'chk', date: '2026-09-01', desc: 'TRANSFER TO SAV', amt: -310000 });
    const r = await categorizeTransaction(db, t, { allowLlm: false });
    expect(r.method).toBe('TRANSFER_MATCH');
    expect(r.category).toBe('Transfer Out');
  });

  it('ad invoice exact-amount match wins with evidence', async () => {
    db.prepare("INSERT INTO ad_payments (id, platform, date, amount_cents) VALUES ('inv1','facebook','2026-09-01',13707)").run();
    const t = txn(db, { id: 't1', acct: 'chk', desc: 'FACEBK *4NHTR522J4', amt: -13707 });
    const r = await categorizeTransaction(db, t, { allowLlm: false });
    expect(r).toMatchObject({ category: 'Ad Spend', method: 'INVOICE_MATCH', needs_review: false });
    expect(r.evidence[0]).toMatchObject({ type: 'ad_invoice', reference: 'inv1' });
  });

  it('Shopify software bill vs Shopify payout: same entity, opposite outcomes', async () => {
    db.prepare("INSERT INTO shopify_invoices (id, store_id, date, total_cents) VALUES ('si1','store1','2026-09-01',3890)").run();
    const bill = await categorizeTransaction(db, txn(db, { id: 'b', acct: 'chk', desc: 'SHOPIFY* 580488754', amt: -3890 }), { allowLlm: false });
    expect(bill).toMatchObject({ category: 'Software', method: 'INVOICE_MATCH' });
    const payout = await categorizeTransaction(db, txn(db, { id: 'p', acct: 'chk', desc: 'ACH CREDIT SHOPIFY TRANSFER', amt: 187620 }), { allowLlm: false });
    expect(payout).toMatchObject({ category: 'Shopify Payout', method: 'PAYOUT_MATCH' });
  });

  it('conflicting rules abstain with RULE_CONFLICT instead of picking one', async () => {
    db.prepare("INSERT INTO merchant_store_rules (pattern, store_id, class) VALUES ('acme', 's1', 'supplier')").run();
    db.prepare("INSERT INTO merchant_store_rules (pattern, store_id, class) VALUES ('acme corp', 's2', 'software')").run();
    const r = await categorizeTransaction(db, txn(db, { id: 't1', acct: 'chk', desc: 'ACME CORP PAYMENT', amt: -9900 }), { allowLlm: false });
    expect(r.category).toBeNull();
    expect(r.needs_review).toBe(true);
    expect(r.reason).toMatch(/RULE_CONFLICT/);
  });

  it('unknown transaction with zero evidence abstains — UNKNOWN is valid', async () => {
    const r = await categorizeTransaction(db, txn(db, { id: 't1', acct: 'chk', desc: 'XKCD RANDOM LLC 99', amt: -12345 }), { allowLlm: false });
    expect(r.category).toBeNull();
    expect(r.method).toBe('UNKNOWN');
    expect(r.needs_review).toBe(true);
  });

  it('LLM unavailable (no key) does not fail the pipeline', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await categorizeTransaction(db, txn(db, { id: 't1', acct: 'chk', desc: 'MYSTERY VENDOR', amt: -5000 }), { allowLlm: true });
    expect(r.category).toBeNull();
    expect(r.needs_review).toBe(true);
  });
});

describe('learning loop', () => {
  it('3 human corrections turn a merchant into EXACT_HISTORY auto-classification', async () => {
    const db = freshDb();
    acct(db, 'chk');
    for (let i = 0; i < 3; i++) {
      recordFeedback(db, { txnId: `f${i}`, predictedCategory: null, predictedMethod: 'UNKNOWN', correctedCategory: 'Fulfillment', merchantName: 'Shippo' });
    }
    const t = txn(db, { id: 'new', acct: 'chk', desc: 'SHIPPO.COM SAN FRANCISCO', amt: -2868 });
    const r = await categorizeTransaction(db, t, { allowLlm: false });
    expect(r).toMatchObject({ category: 'Fulfillment', method: 'EXACT_HISTORY', needs_review: false });
  });

  it('saveResult never overwrites a MANUAL verdict', async () => {
    const db = freshDb();
    recordFeedback(db, { txnId: 't1', predictedCategory: 'Software', predictedMethod: 'LLM_ASSISTED', correctedCategory: 'Inventory' });
    saveResult(db, { txn_id: 't1', category: 'Software', subcategory: null, merchant_id: null, merchant_name: null,
      store_id: null, method: 'MERCHANT_KNOWLEDGE', confidence: 0.9, reason: 'auto', evidence: [], needs_review: false, related_txn_id: null });
    const row: any = db.prepare("SELECT category, method FROM classification_results WHERE txn_id = 't1'").get();
    expect(row).toMatchObject({ category: 'Inventory', method: 'MANUAL' });
  });

  it('split feedback (2 vs 2) does NOT auto-classify — needs dominance', async () => {
    const db = freshDb();
    acct(db, 'chk');
    for (const [i, cat] of [['a', 'Software'], ['b', 'Software'], ['c', 'Inventory'], ['d', 'Inventory']] as any) {
      recordFeedback(db, { txnId: i, predictedCategory: null, predictedMethod: null, correctedCategory: cat, merchantName: 'Alibaba' });
    }
    const t = txn(db, { id: 'new', acct: 'chk', desc: 'ALIBABA.COM SINGAPORE', amt: -80000 });
    const r = await categorizeTransaction(db, t, { allowLlm: false });
    expect(r.method).not.toBe('EXACT_HISTORY');
  });
});
