import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildCashPosition, _resetSubsCache } from './cash-position';
import { buildCashflowProjection } from './cashflow';

/** Scope rule: a store's cash is only its own accounts; company cash is
 *  shown separately; unknown is null, never $0; the calendar position is
 *  null when cash is unknown. */
function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT, platform TEXT DEFAULT 'shopify', is_active INTEGER DEFAULT 1, shipsourced_client_id TEXT, shipsourced_extra_client_ids TEXT);
    CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, store_id TEXT, institution_name TEXT, account_name TEXT, nickname TEXT, account_type TEXT, last_four TEXT, balance_available_cents INTEGER, balance_ledger_cents INTEGER, credit_limit_cents INTEGER, balance_updated_at TEXT, status TEXT DEFAULT 'active', cfo_hidden INTEGER DEFAULT 0, merged_into TEXT, company TEXT, provider TEXT, is_global INTEGER DEFAULT 0, anchor_exceptions TEXT);
    CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT, counterparty TEXT, amount_cents INTEGER, settled_at TEXT, custom_store_id TEXT, custom_category TEXT, status TEXT);
    CREATE TABLE classification_results (txn_id TEXT PRIMARY KEY, store_id TEXT, category TEXT, method TEXT, merchant_name TEXT, confidence REAL, evidence_json TEXT);
    CREATE TABLE fb_profiles (id TEXT PRIMARY KEY, store_id TEXT, profile_name TEXT, balance_cents INTEGER, is_active INTEGER DEFAULT 1, last_sync_at TEXT, ad_account_id TEXT, access_token TEXT);
    CREATE TABLE manual_credit_cards (id TEXT PRIMARY KEY, store_id TEXT, card_name TEXT, amount_owed_cents INTEGER);
    CREATE TABLE shopify_credentials (store_id TEXT PRIMARY KEY, last_synced_at TEXT);
    CREATE TABLE card_payments_log (id TEXT PRIMARY KEY, store_id TEXT, date TEXT, amount_cents INTEGER, card_label TEXT, category TEXT, notes TEXT, taken INTEGER);
    CREATE TABLE daily_pnl (store_id TEXT, date TEXT, ad_spend_cents INTEGER);
    CREATE TABLE evidence_rows (id TEXT, store_id TEXT, kind TEXT, date TEXT, amount_cents INTEGER, net_cents INTEGER, payout_date TEXT, payout_status TEXT, type TEXT, ts_utc TEXT, reference TEXT, money TEXT);
    CREATE TABLE merchant_store_rules (merchant_key TEXT, store_id TEXT);
    CREATE TABLE cfo_evidence (id TEXT, store_id TEXT, kind TEXT, rows_json TEXT);
    INSERT INTO stores (id, name) VALUES ('s1', 'Elvris'), ('s2', 'Magvita');
    INSERT INTO stores (id, name, platform) VALUES ('ss', 'ShipSourced', 'custom');
    INSERT INTO bank_accounts (id, store_id, institution_name, account_name, account_type, last_four, balance_available_cents, balance_ledger_cents, balance_updated_at)
      VALUES ('chk1', 's1', 'Chase', 'Checking', 'depository', '1111', 296145, 296145, '2026-09-15 07:00:00'),
             ('chk2', NULL, 'BofA', 'Main', 'depository', '2222', 1000000, 1000000, '2026-09-15 07:00:00'),
             ('chk3', 'ss', 'Chase', 'SS Checking', 'depository', '3333', 5000000, 5000000, '2026-09-15 07:00:00'),
             ('card1', 's2', 'Amex', 'Gold', 'credit', '1006', 80100, 769874, '2026-09-15 07:00:00'),
             ('card2', 's2', 'Amex', 'Hidden twin', 'credit', '1009', 0, 5000000, '2026-09-15 07:00:00');
    UPDATE bank_accounts SET cfo_hidden = 1 WHERE id = 'card2';
    INSERT INTO bank_transactions (id, bank_account_id, date, description, amount_cents) VALUES ('t1', 'card1', '2026-09-10', 'SHIPHERO.COM', -225699), ('t2', 'card1', '2026-09-11', 'FACEBK ADS', -50000), ('t3', 'card1', '2026-09-12', 'USPS', -9999);
    INSERT INTO classification_results (txn_id, store_id, category, method, merchant_name) VALUES ('t1', 's1', 'Software', 'RULE', 'ShipHero'), ('t2', 's1', 'Ads', 'RULE', 'Meta'), ('t3', 'ss', 'Shipping', 'RULE', 'USPS');
    INSERT INTO fb_profiles (id, store_id, profile_name, balance_cents, last_sync_at) VALUES ('f1', 's2', 'Magvita Ads', 136927, '2026-09-16 12:00:00');
    INSERT INTO manual_credit_cards (id, store_id, card_name, amount_owed_cents) VALUES ('m1', 's1', 'Investor loan', 2100000);
  `);
  return db;
}

describe('cash position — one definition per number, scope-correct', () => {
  beforeEach(() => _resetSubsCache());

  it('a store sees only its own accounts; "all" is the Shopify stores only — unassigned and ShipSourced accounts stay out', () => {
    const db = fixture();
    const p = buildCashPosition(db as any, 's1', 100, '2026-09-16');
    expect(p.cash.cents).toBe(296145);
    expect(p.cash.rows?.length).toBe(1);
    const all = buildCashPosition(db as any, undefined, 0, '2026-09-16');
    expect(all.cash.cents).toBe(296145);                              // chk2 (no store) and chk3 (ShipSourced) excluded
    expect(all.scope.storeName).toBe('All Shopify stores');
  });

  it('a non-Shopify store falls back to all Shopify stores and says so', () => {
    const db = fixture();
    const p = buildCashPosition(db as any, 'ss', 0, '2026-09-16');
    expect(p.scope.storeId).toBeNull();
    expect(p.scope.note).toMatch(/ShipSourced is not a Shopify store/);
  });

  it('a store with no bank account has UNKNOWN cash, not $0, and the calendar position is null', () => {
    const db = fixture();
    const p = buildCashPosition(db as any, 's2', 0, '2026-09-16');
    expect(p.cash.cents).toBeNull();
    expect(p.cash.note).toMatch(/No bank account is assigned to Magvita/);
    const pr = buildCashflowProjection(db as any, 's2', 7, { cashAvailableCents: p.cash.cents, obligationsCents: 0 });
    expect(pr.position.cash_unknown).toBe(true);
    expect(pr.position.safe_to_pay_today_cents).toBeNull();
    expect(pr.calendar.every(d => d.position_cents == null)).toBe(true);
    expect(pr.position.clear_date).toBeNull();
  });

  it('card charges = unpaid charges paired to the store(s); ad invoices and ShipSourced charges excluded — same definition at both scopes', () => {
    const db = fixture();
    const s1 = buildCashPosition(db as any, 's1', 0, '2026-09-16');
    expect(s1.obligations.cardCharges.cents).toBe(225699);            // FACEBK row is an ad invoice → not here
    const all = buildCashPosition(db as any, undefined, 0, '2026-09-16');
    expect(all.obligations.cardCharges.cents).toBe(225699);           // the ShipSourced-paired charge is not a Shopify obligation
    expect(all.obligations.cardCharges.rows).toEqual([{ label: 'Elvris', cents: 225699, note: '1 charge' }]);
  });

  it('Meta unbilled is per store and unknown when no ad account is linked', () => {
    const db = fixture();
    expect(buildCashPosition(db as any, 's2', 0, '2026-09-16').obligations.fbUnbilled.cents).toBe(136927);
    expect(buildCashPosition(db as any, 's1', 0, '2026-09-16').obligations.fbUnbilled.cents).toBeNull();
  });

  it('manual liabilities never enter the 7-day total; ad burn does', () => {
    const db = fixture();
    const p = buildCashPosition(db as any, 's1', 1000, '2026-09-16');
    expect(p.obligations.manualCards.cents).toBe(2100000);
    expect(p.obligations.adBurn7d.cents).toBe(7000);
    expect(p.obligations.totalCents).toBe(225699 + 7000);
  });

  it('the calendar uses the scope-correct cash the position supplies', () => {
    const db = fixture();
    const p = buildCashPosition(db as any, 's1', 0, '2026-09-16');
    const pr = buildCashflowProjection(db as any, 's1', 7, { cashAvailableCents: p.cash.cents, obligationsCents: p.obligations.totalCents });
    expect(pr.position.cash_available_cents).toBe(296145);
    expect(pr.position.cards_owed_cents).toBe(p.obligations.totalCents);
  });

  it('all-stores view carries one light row per store with the same definitions', () => {
    const db = fixture();
    const all = buildCashPosition(db as any, undefined, 0, '2026-09-16');
    const rows = new Map(all.storeRows!.map(r => [r.storeName, r]));
    expect(rows.get('Elvris')).toMatchObject({ cashCents: 296145, cardChargesCents: 225699, fbCents: null });
    expect(rows.get('Magvita')).toMatchObject({ cashCents: null, cardChargesCents: 0, fbCents: 136927 });
    expect(rows.has('ShipSourced')).toBe(false);
  });
});
