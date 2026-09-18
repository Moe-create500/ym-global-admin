import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { matchInvoicesToCharges, decide, chargeNamesPlatform, lagScore, cardVerdict, type ChargeRow } from './charge-matching';

const alias = new Map<string, string[]>([
  ['1009', ['amex-plat', 'amex-gold']],   // two live accounts share the mask
  ['2976', ['amex-plat']],                // supplementary card → Platinum
  ['1006', ['amex-gold']],
]);
const charge = (o: Partial<ChargeRow> & { id: string; date: string; amount_cents: number }): ChargeRow =>
  ({ description: 'FACEBK *ABC123 MENLO PARK', account_id: 'amex-plat', last_four: '1009', ...o });
const inv = (o: Partial<{ id: string; date: string; card_last4: string | null; amount_cents: number; platform: string }> = {}) =>
  ({ id: 'i1', store_id: 's1', date: '2026-09-14', card_last4: '1009', amount_cents: 88357, platform: 'facebook', ...o });

describe('the charge must name its platform', () => {
  it('accepts Meta wording and rejects an unrelated charge of the same amount', () => {
    expect(chargeNamesPlatform('FACEBK *ZSFV86A2J4', 'facebook')).toBe(true);
    expect(chargeNamesPlatform('META PLATFORMS INC', 'facebook')).toBe(true);
    expect(chargeNamesPlatform('SHIPHERO.COM', 'facebook')).toBe(false);
  });

  it('separates Google Ads from Google Workspace, One and Cloud on the same card', () => {
    expect(chargeNamesPlatform('GOOGLE *ADS521687062CC@GOOGLE.COM CA', 'google')).toBe(true);
    expect(chargeNamesPlatform('ADS462483830CC@GOOGLE.COM', 'google')).toBe(true);
    expect(chargeNamesPlatform('GOOGLE*GOOGLE ONE GO G.CO HELPPAY#', 'google')).toBe(false);
    expect(chargeNamesPlatform('WORKSPACE_SHCC@GOOGLE.COM', 'google')).toBe(false);
  });
});

describe('card identity, not the mask string', () => {
  it('resolves a supplementary card to the account it bills', () => {
    expect(cardVerdict('2976', charge({ id: 'c', date: '2026-09-14', amount_cents: -100, account_id: 'amex-plat', last_four: '1009' }), alias)).toBe('match_via_alias');
  });

  it('rejects a charge on an account the invoice\'s card does not bill', () => {
    expect(cardVerdict('2976', charge({ id: 'c', date: '2026-09-14', amount_cents: -100, account_id: 'amex-gold', last_four: '1009' }), alias)).toBe('unknown');
  });

  it('an invoice with no card recorded stays partial, never a false match', () => {
    expect(cardVerdict(null, charge({ id: 'c', date: '2026-09-14', amount_cents: -100 }), alias)).toBe('partial');
  });
});

describe('lag window learned from the confirmed history', () => {
  it('same day scores highest and the window closes at +10 / −3', () => {
    expect(lagScore(0)).toBeGreaterThan(lagScore(1));
    expect(lagScore(1)).toBeGreaterThan(lagScore(7));
    expect(lagScore(11)).toBe(0);
    expect(lagScore(-4)).toBe(0);
  });
});

describe('deciding between candidates', () => {
  it('links the single charge that fits', () => {
    const d = decide(inv(), [charge({ id: 'c1', date: '2026-09-14', amount_cents: -88357 })], alias);
    expect(d.accepted).toBe(true);
    expect(d.best!.charge.id).toBe('c1');
  });

  it('refuses when two identical charges on the same card fit equally — a human decides', () => {
    const d = decide(inv(), [
      charge({ id: 'c1', date: '2026-09-14', amount_cents: -88357 }),
      charge({ id: 'c2', date: '2026-09-14', amount_cents: -88357 }),
    ], alias);
    expect(d.accepted).toBe(false);
    expect(d.candidates).toBe(2);
    expect(d.reason).toMatch(/needs a human/);
  });

  it('prefers the same-day charge over one a week later', () => {
    const d = decide(inv(), [
      charge({ id: 'late', date: '2026-09-21', amount_cents: -88357 }),
      charge({ id: 'sameday', date: '2026-09-14', amount_cents: -88357 }),
    ], alias);
    expect(d.accepted).toBe(true);
    expect(d.best!.charge.id).toBe('sameday');
  });

  it('never matches an amount that differs by a cent', () => {
    expect(decide(inv(), [charge({ id: 'c1', date: '2026-09-14', amount_cents: -88358 })], alias).accepted).toBe(false);
  });
});

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, store_id TEXT, account_name TEXT, nickname TEXT, account_type TEXT, last_four TEXT, status TEXT DEFAULT 'active', merged_into TEXT, institution_name TEXT);
    CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT, amount_cents INTEGER);
    CREATE TABLE ad_payments (id TEXT PRIMARY KEY, store_id TEXT, platform TEXT, date TEXT, card_last4 TEXT, amount_cents INTEGER);
    CREATE TABLE shopify_invoices (id TEXT PRIMARY KEY, store_id TEXT, date TEXT, card_last4 TEXT, total_cents INTEGER);
    CREATE TABLE txn_links (txn_id TEXT PRIMARY KEY, class TEXT, store_id TEXT, store_source TEXT, entity_type TEXT, entity_id TEXT, pair_txn_id TEXT, confidence REAL, updated_at TEXT, match_score REAL, match_evidence TEXT, billed_store_at TEXT);
    CREATE TABLE fb_funding_cards (last4 TEXT PRIMARY KEY, bank_account_id TEXT, learned_from TEXT, created_at TEXT);
    INSERT INTO bank_accounts (id, account_name, account_type, last_four) VALUES
      ('amex-plat', 'Business Platinum Card', 'credit', '1009'),
      ('amex-gold', 'Business Gold Card', 'credit', '1009');
    INSERT INTO fb_funding_cards (last4, bank_account_id) VALUES ('2976', 'amex-plat');
    INSERT INTO bank_transactions VALUES
      ('t-fb',    'amex-plat', '2026-09-14', 'FACEBK *ZSFV86A2J4', -88357),
      ('t-other', 'amex-plat', '2026-09-14', 'SHIPHERO.COM',       -88357),
      ('t-shop',  'amex-plat', '2026-09-12', 'SHOPIFY* 539447507',  -6000),
      ('t-sub',   'amex-plat', '2026-09-11', 'FACEBK *QQQ',        -12345);
    INSERT INTO ad_payments VALUES
      ('ap1', 's1', 'facebook', '2026-09-14', '1009', 88357),
      ('ap2', 's1', 'facebook', '2026-09-11', '2976', 12345),
      ('ap3', 's1', 'facebook', '2026-09-14', '3704', 79108);
    INSERT INTO shopify_invoices VALUES ('si1', 's1', '2026-09-12', '1009', 6000);
  `);
  return db;
}

describe('matching a real ledger end to end', () => {
  it('links ad payments and Shopify invoices, and leaves the unrelated charge alone', () => {
    const db = fixture();
    const r = matchInvoicesToCharges(db as any, { days: 60 });
    expect(r.linked).toBe(3);
    expect(r.byKind).toEqual({ ad_payment: 2, shopify_invoice: 1 });
    const rows = db.prepare('SELECT txn_id, entity_type, entity_id FROM txn_links ORDER BY txn_id').all() as any[];
    expect(rows).toEqual([
      { txn_id: 't-fb', entity_type: 'ad_payment', entity_id: 'ap1' },
      { txn_id: 't-shop', entity_type: 'shopify_invoice', entity_id: 'si1' },
      { txn_id: 't-sub', entity_type: 'ad_payment', entity_id: 'ap2' },
    ]);
  });

  it('an invoice whose card is not connected stays unmatched — that is the honest answer', () => {
    const db = fixture();
    matchInvoicesToCharges(db as any, { days: 60 });
    const ap3 = db.prepare("SELECT count(*) n FROM txn_links WHERE entity_id = 'ap3'").get() as any;
    expect(ap3.n).toBe(0);
  });

  it('is idempotent: a second run links nothing new and rewrites nothing', () => {
    const db = fixture();
    matchInvoicesToCharges(db as any, { days: 60 });
    const before = db.prepare('SELECT txn_id, entity_id, updated_at FROM txn_links ORDER BY txn_id').all();
    const again = matchInvoicesToCharges(db as any, { days: 60 });
    expect(again.linked).toBe(0);
    expect(db.prepare('SELECT txn_id, entity_id, updated_at FROM txn_links ORDER BY txn_id').all()).toEqual(before);
  });

  it('never overwrites the classifier\'s class or store on a row it links', () => {
    const db = fixture();
    db.prepare("INSERT INTO txn_links (txn_id, class, store_id, store_source) VALUES ('t-fb', 'fb_ads', 'store-x', 'classifier')").run();
    matchInvoicesToCharges(db as any, { days: 60 });
    const row = db.prepare("SELECT class, store_id, store_source, entity_type, entity_id FROM txn_links WHERE txn_id = 't-fb'").get() as any;
    expect(row).toMatchObject({ class: 'fb_ads', store_id: 'store-x', store_source: 'classifier', entity_type: 'ad_payment', entity_id: 'ap1' });
  });

  it('does not spend one charge on two invoices', () => {
    const db = fixture();
    db.prepare("INSERT INTO ad_payments VALUES ('dup', 's1', 'facebook', '2026-09-14', '1009', 88357)").run();
    const r = matchInvoicesToCharges(db as any, { days: 60 });
    const uses = db.prepare("SELECT count(*) n FROM txn_links WHERE txn_id = 't-fb'").get() as any;
    expect(uses.n).toBe(1);
    expect(r.linked).toBeLessThanOrEqual(3);
  });

  it('dryRun reports what it would do without writing', () => {
    const db = fixture();
    const r = matchInvoicesToCharges(db as any, { days: 60, dryRun: true });
    expect(r.linked).toBe(3);
    expect((db.prepare('SELECT count(*) n FROM txn_links').get() as any).n).toBe(0);
  });
});
