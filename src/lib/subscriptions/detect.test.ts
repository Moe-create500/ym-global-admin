import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { merchantKey, NEVER_SUBSCRIPTION } from './normalize';
import { detectSubscriptions, reconcile, cadenceOf, isCandidate, type TxnRow } from './detect';
import { ensureSubscriptionSchema, listSubscriptions, subscriptionDetail, assignStore, setReview } from './service';

const TODAY = '2026-09-15';
let n = 0;
const row = (date: string, cents: number, desc: string, acct = 'amex-1009', store: string | null = null, extra: Partial<TxnRow> = {}): TxnRow =>
  ({ id: `t${++n}`, date, amount_cents: -cents, description: desc, status: 'posted', bank_account_id: acct, account_label: acct, account_store_id: null, store_id: store, category: null, ...extra });
const monthly = (start: string, count: number, cents: number, desc: string, acct?: string, store?: string | null) => {
  const out: TxnRow[] = []; const d = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < count; i++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, d.getUTCDate())); out.push(row(x.toISOString().slice(0, 10), cents, desc, acct, store ?? null)); }
  return out;
};

describe('merchant identity', () => {
  it('recognises the same vendor across description variants', () => {
    const k = (d: string) => merchantKey(d)!.key;
    expect(k('OPENAI *CHATGPT')).toBe('OPENAI');
    expect(k('OPENAI CHATGPT SUBSSAN FRANCISCO')).toBe('OPENAI');
    expect(k('OPENAI*CHATGPT SUBSCRIPTION')).toBe('OPENAI');
    expect(k('KLAVIYO INC. SOFTWARBOSTON')).toBe('KLAVIYO');
    expect(k('KLAVIYO INC. SOFTWARE')).toBe('KLAVIYO');
    expect(k('ESCOR Group DES:ESCOR Grou ID:ST-W3G0S4Z4P2N0 INDN:SHIPSOURCED LLC CO ID:XXXXX CCD')).toBe('ESCOR GROUP');
    expect(k('Zelle Scheduled payment to ROYAL STAR LLC Conf# u774qtei9')).toBe('ROYAL STAR');
    expect(k('Zelle payment to ROYAL STAR LLC Conf# ymci89ij5')).toBe('ROYAL STAR');
    expect(k('APLPAY HIGGSFIELD INC.')).toBe('HIGGSFIELD');
    expect(k('HIGGSFIELD INC. 8776914890')).toBe('HIGGSFIELD');
    expect(k('TRIPLE WHALE COLUMBUS OH')).toBe('TRIPLE WHALE');
    expect(k('INTUIT *QUICKBOOKS ONLINE')).toBe('INTUIT QUICKBOOKS');
    expect(merchantKey('12345 6789')).toBeNull();
  });
  it('excludes money movement, ads, marketplaces and meals but keeps recurring bills', () => {
    for (const d of ['FACEBK *ABC MENLO PARK', 'ONLINE PAYMENT - THANK YOU', 'AMERICAN EXPRESS DES:ACH PMT', 'Online Banking transfer to CHK 7881', 'WISE US INC DES:WISE', 'AMAZON MKTPL*XYZ', 'DOORDASH', 'ACH transfer to SHIPSOURCED', 'SHOPIFY* 577576279']) expect(NEVER_SUBSCRIPTION.test(d), d).toBe(true);
    for (const d of ['ESCOR Group DES:ESCOR Grou INDN:SHIPSOURCED LLC', 'Zelle payment to ROYAL STAR LLC', 'SHIPHERO.COM GARNERVILLE N', 'UNWIRED BROADBAND LLFRESNO', 'KLAVIYO INC.', 'Monthly Fee Business Adv Relationship']) expect(NEVER_SUBSCRIPTION.test(d), d).toBe(false);
    expect(isCandidate(row('2026-09-01', 2000, 'OPENAI', 'a', null, { category: 'Ad Spend' }))).toBe(false);
    expect(isCandidate(row('2026-09-01', 2000, 'OPENAI', 'a', null, { status: 'pending' }))).toBe(false);
  });
});

describe('cadence', () => {
  it('classifies intervals and measures regularity', () => {
    expect(cadenceOf([30, 31, 30, 29])).toMatchObject({ cadence: 'monthly', regularity: 1 });
    expect(cadenceOf([7, 7, 8, 6])).toMatchObject({ cadence: 'weekly' });
    expect(cadenceOf([91, 92])).toMatchObject({ cadence: 'quarterly' });
    expect(cadenceOf([365])).toMatchObject({ cadence: 'yearly' });
    expect(cadenceOf([3, 40, 2, 90]).cadence).toBe('irregular');
    expect(cadenceOf([])).toMatchObject({ cadence: 'irregular', interval: null });
  });
});

describe('detection', () => {
  it('finds a monthly plan, computes amounts, next charge, totals and provenance', () => {
    n = 0;
    const rows = monthly('2026-03-05', 6, 2000, 'OPENAI *CHATGPT SUBSCRIPTION');
    const [s] = detectSubscriptions(rows, { today: TODAY });
    expect(s.name).toBe('Openai'); expect(s.cadence).toBe('monthly'); expect(s.status).toBe('active');
    expect(s.currentAmountCents).toBe(2000); expect(s.monthlyCents).toBe(2000); expect(s.annualCents).toBe(24000);
    expect(s.firstDate).toBe('2026-03-05'); expect(s.lastDate).toBe('2026-08-05'); expect(s.nextExpectedDate).toBe('2026-09-05');
    expect(s.chargeCount).toBe(6); expect(s.totalCents).toBe(12000); expect(s.txnIds).toHaveLength(6);
    expect(s.attribution.needsAttribution).toBe(true); expect(s.attribution.basis).toBe('none');
    expect(reconcile([s], rows)).toEqual([]);
  });
  it('a price change keeps one subscription; concurrent tiers are separate plans from the same vendor', () => {
    n = 0;
    const adobe = [...monthly('2026-01-15', 4, 1999, 'ADOBE *CREATIVE CLOUD'), ...monthly('2026-05-15', 4, 2999, 'ADOBE *CREATIVE CLOUD')];
    const [s] = detectSubscriptions(adobe, { today: TODAY });
    expect(detectSubscriptions(adobe, { today: TODAY })).toHaveLength(1);
    expect(s.currentAmountCents).toBe(2999); expect(s.previousAmountCents).toBe(2999); expect(s.chargeCount).toBe(8);
    expect(s.flags).not.toContain('price_increase');   // the change happened 4 charges ago
    const justRaised = [...monthly('2026-02-15', 6, 1999, 'ADOBE'), row('2026-08-15', 2999, 'ADOBE')];
    const [r] = detectSubscriptions(justRaised, { today: TODAY });
    expect(r.priceChangePct).toBe(50); expect(r.flags).toContain('price_increase');
    n = 0;
    const openai = [...monthly('2026-03-02', 7, 2000, 'OPENAI *CHATGPT'), ...monthly('2026-03-12', 4, 20000, 'OPENAI *CHATGPT PRO')];
    const subs = detectSubscriptions(openai, { today: TODAY });
    expect(subs).toHaveLength(2);
    expect(subs.every(s => s.flags.includes('same_vendor'))).toBe(true);
    expect(subs.map(s => s.currentAmountCents).sort((a, b) => a - b)).toEqual([2000, 20000]);
    expect(reconcile(subs, openai)).toEqual([]);
  });
  it('weekly needs four charges; two charges only count when the amount is identical', () => {
    n = 0;
    expect(detectSubscriptions([row('2026-09-01', 5000, 'HIGGSFIELD'), row('2026-09-08', 5000, 'HIGGSFIELD'), row('2026-09-15', 5000, 'HIGGSFIELD')], { today: TODAY })).toHaveLength(0);
    expect(detectSubscriptions([row('2026-08-01', 5000, 'CANVA'), row('2026-09-01', 5000, 'CANVA')], { today: TODAY })).toHaveLength(1);
    expect(detectSubscriptions([row('2026-08-01', 5000, 'CANVA'), row('2026-09-01', 9000, 'CANVA')], { today: TODAY })).toHaveLength(0);
    const [two] = detectSubscriptions([row('2026-08-01', 5000, 'CANVA'), row('2026-09-01', 5000, 'CANVA')], { today: TODAY });
    expect(two.status).toBe('possibly_active');
  });
  it('status: active, possibly active when overdue, cancelled when billing stopped; new flag', () => {
    n = 0;
    expect(detectSubscriptions(monthly('2026-04-01', 5, 1000, 'CALENDLY'), { today: TODAY })[0].status).toBe('active');       // last 2026-08-01, 45d ago ≤ 1.5 intervals
    expect(detectSubscriptions(monthly('2026-03-15', 5, 1000, 'CALENDLY'), { today: TODAY })[0].status).toBe('possibly_active'); // last 2026-07-15, 62d ≈ 2 intervals
    const stopped = detectSubscriptions(monthly('2025-08-01', 6, 1000, 'CALENDLY'), { today: TODAY })[0];
    expect(stopped.status).toBe('cancelled'); expect(stopped.flags).toContain('stopped'); expect(stopped.nextExpectedDate).toBeNull();
    expect(detectSubscriptions(monthly('2026-08-01', 2, 1000, 'CALENDLY'), { today: TODAY })[0].flags).toContain('new');
  });
  it('variable recurring bills surface as Needs Review with an average monthly cost, never as a fixed plan', () => {
    n = 0;
    const util = [row('2026-03-05', 18075, 'UNWIRED BROADBAND'), row('2026-04-05', 20798, 'UNWIRED BROADBAND'), row('2026-05-05', 31200, 'UNWIRED BROADBAND'), row('2026-06-05', 20798, 'UNWIRED BROADBAND')];
    const [s] = detectSubscriptions(util, { today: TODAY });
    expect(s.amountKind).toBe('variable'); expect(s.status).toBe('needs_review'); expect(s.flags).toContain('variable');
    expect(s.totalCents).toBe(90871); expect(reconcile([s], util)).toEqual([]);
  });
  it('attribution: mapping wins; a clear majority of paired charges attributes; a shared card never does', () => {
    n = 0;
    const paired = monthly('2026-03-01', 5, 3000, 'CANVA', 'amex-1009', 'purebite');
    let [s] = detectSubscriptions(paired, { today: TODAY });
    expect(s.attribution).toMatchObject({ storeId: 'purebite', basis: 'transactions', needsAttribution: false });
    const mixed = [...monthly('2026-03-01', 3, 3000, 'CANVA', 'amex-1009', 'purebite'), ...monthly('2026-06-01', 2, 3000, 'CANVA', 'amex-1009', 'magvita')];
    [s] = detectSubscriptions(mixed, { today: TODAY });
    expect(s.attribution.needsAttribution).toBe(true); expect(s.attribution.suggestedStoreId).toBe('purebite'); expect(s.attribution.votes).toEqual({ purebite: 3, magvita: 2 });
    [s] = detectSubscriptions(mixed, { today: TODAY, mappings: new Map([['CANVA', 'magvita']]) });
    expect(s.attribution).toMatchObject({ storeId: 'magvita', basis: 'mapping', confidence: 1, needsAttribution: false });
    const shared = monthly('2026-03-01', 5, 3000, 'CANVA', 'amex-1009', null).map(r => ({ ...r, account_store_id: 'magvita', account_is_holding: true }));
    [s] = detectSubscriptions(shared, { today: TODAY });
    expect(s.attribution.needsAttribution).toBe(true); expect(s.attribution.suggestedStoreId).toBeNull();
    const own = monthly('2026-03-01', 5, 3000, 'CANVA', 'chk-elvris', null).map(r => ({ ...r, account_store_id: 'elvris', account_is_holding: false }));
    [s] = detectSubscriptions(own, { today: TODAY });
    expect(s.attribution).toMatchObject({ needsAttribution: true, basis: 'account', suggestedStoreId: 'elvris' });
  });
  it('flags possible duplicates across cards with evidence, never as a certainty', () => {
    n = 0;
    const rows = [...monthly('2026-03-24', 6, 3000, 'CANVA', 'amex-1009', 'purebite'), ...monthly('2026-04-10', 5, 3000, 'CANVA', 'boa-9215', 'magvita'), ...monthly('2025-01-01', 3, 3000, 'CANVA', 'boa-0775', null)];
    const subs = detectSubscriptions(rows, { today: TODAY });
    const live = subs.filter(s => s.status !== 'cancelled');
    expect(live).toHaveLength(2);
    for (const s of live) { expect(s.flags).toContain('possible_duplicate'); expect(s.duplicateOf).toHaveLength(1); expect(s.evidence[0]).toMatch(/also billed on .* for a different store/); }
    expect(subs.find(s => s.accountId === 'boa-0775')!.flags).not.toContain('possible_duplicate');  // ended long ago — no overlap
    expect(reconcile(subs, rows)).toEqual([]);
  });
});

describe('service (db)', () => {
  function db() {
    const d = new Database(':memory:');
    d.exec(`
      CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
      CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, store_id TEXT, institution_name TEXT, last_four TEXT, status TEXT DEFAULT 'active', account_type TEXT, company TEXT, currency TEXT DEFAULT 'USD', account_name TEXT, nickname TEXT, merged_into TEXT, is_global INTEGER, provider TEXT, teller_enrollment_id TEXT);
      CREATE TABLE ad_payments (id TEXT PRIMARY KEY, store_id TEXT, platform TEXT, date TEXT, transaction_id TEXT, payment_method TEXT, card_last4 TEXT, amount_cents INTEGER, currency TEXT, status TEXT, account_id TEXT, created_at TEXT, funding_source_id TEXT, is_manual INTEGER);
      CREATE TABLE shopify_invoices (id TEXT PRIMARY KEY, store_id TEXT, bill_number TEXT, date TEXT, total_cents INTEGER, item_count INTEGER, currency TEXT, payment_method TEXT, card_last4 TEXT, paid INTEGER, paid_date TEXT, notes TEXT, created_at TEXT, source TEXT);
      CREATE TABLE txn_links (txn_id TEXT PRIMARY KEY, pair_txn_id TEXT, class TEXT, entity_type TEXT, entity_id TEXT, store_id TEXT, created_at TEXT);
      CREATE TABLE fb_funding_cards (last4 TEXT PRIMARY KEY, bank_account_id TEXT, learned_from TEXT);
      CREATE TABLE ai_calls (id TEXT PRIMARY KEY, created_at TEXT);
      CREATE TABLE merchant_store_rules (id INTEGER PRIMARY KEY, pattern TEXT, store_id TEXT, class TEXT, source TEXT, enabled INTEGER DEFAULT 1, created_at TEXT, last_used_at TEXT, direction TEXT, note TEXT);
      CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT, amount_cents INTEGER, status TEXT DEFAULT 'posted', custom_store_id TEXT, custom_category TEXT, custom_note TEXT, category TEXT, counterparty TEXT);
      CREATE TABLE classification_results (txn_id TEXT PRIMARY KEY, category TEXT, subcategory TEXT, merchant_id TEXT, merchant_name TEXT, store_id TEXT, method TEXT NOT NULL, confidence REAL NOT NULL, reason TEXT NOT NULL, evidence_json TEXT NOT NULL, needs_review INTEGER NOT NULL DEFAULT 0, suggested_category TEXT, related_txn_id TEXT, engine_version INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), suggested_store_id TEXT);
      INSERT INTO stores VALUES ('pb','Purebite',1), ('mg','Magvita',1);
      INSERT INTO bank_accounts (id, store_id, institution_name, last_four, status, account_type) VALUES ('amex','mg','American Express','1009','active','credit');
    `);
    const ins = d.prepare('INSERT INTO bank_transactions (id, bank_account_id, date, description, amount_cents) VALUES (?,?,?,?,?)');
    n = 0; for (const r of monthly('2026-03-05', 6, 3000, 'CANVA* I04983-123', 'amex')) ins.run(r.id, 'amex', r.date, r.description, r.amount_cents);
    for (const r of monthly('2026-01-09', 8, 5692, 'KEEPA PRICE TRACKER KEMNATH BA', 'amex')) ins.run(r.id, 'amex', r.date, r.description, r.amount_cents);
    ins.run('noise', 'amex', '2026-05-01', 'FACEBK *ABC', -100000);
    ins.run('noise2', 'amex', '2026-06-01', 'ONLINE PAYMENT - THANK YOU', 50000);
    return d;
  }
  it('lists, summarises and reconciles against the ledger; hides rows marked not-a-subscription', () => {
    const d = db();
    const { subs, summary, savings } = listSubscriptions(d, TODAY);
    expect(subs.map(s => s.name).sort()).toEqual(['Canva', 'Keepa Price']);
    expect(summary.ledgerCheck.problems).toEqual([]);
    expect(summary.ledgerCheck.sourceRows).toBe(14);
    expect(summary.ledgerCheck.totalCents).toBe(6 * 3000 + 8 * 5692);
    expect(summary.monthlyRecurringCents).toBe(3000 + 5692); expect(summary.annualizedCents).toBe((3000 + 5692) * 12);
    expect(summary.needsAttributionCount).toBe(2);
    expect(savings.items.filter(i => i.reason === 'needs_attribution')).toHaveLength(2);
    expect(savings.potentialMonthlyCents).toBe(0);   // nothing claimed without evidence
    const canva = subs.find(s => s.name === 'Canva')!;
    setReview(d, canva.id, 'not_subscription', 'one-off design orders', 'moe');
    expect(listSubscriptions(d, TODAY).subs.map(s => s.name)).toEqual(['Keepa Price']);
    expect(listSubscriptions(d, TODAY).hidden).toHaveLength(1);
  });
  it('detail returns every source transaction; assigning a store is remembered and pairs the rows', async () => {
    const d = db();
    const { subs } = listSubscriptions(d, TODAY);
    const canva = subs.find(s => s.name === 'Canva')!;
    const det = subscriptionDetail(d, canva.id, TODAY)!;
    expect(det.transactions).toHaveLength(6);
    expect(det.transactions.every((t: any) => t.description.startsWith('CANVA'))).toBe(true);
    const r = await assignStore(d, canva.id, 'pb', 'moe', 'design team');
    expect(r).toMatchObject({ ok: true, merchantKey: 'CANVA', paired: 6 });
    expect(d.prepare('SELECT store_id FROM subscription_mappings WHERE merchant_key = ?').get('CANVA')).toEqual({ store_id: 'pb' });
    expect(d.prepare("SELECT COUNT(*) n FROM bank_transactions WHERE custom_store_id = 'pb'").get()).toEqual({ n: 6 });
    const after = listSubscriptions(d, TODAY).subs.find(s => s.name === 'Canva')!;
    expect(after.attribution).toMatchObject({ storeId: 'pb', basis: 'mapping', needsAttribution: false }); expect(after.storeName).toBe('Purebite');
    // a future charge from the same vendor inherits the mapping without touching the rows
    d.prepare('INSERT INTO bank_transactions (id, bank_account_id, date, description, amount_cents) VALUES (?,?,?,?,?)').run('later', 'amex', '2026-09-05', 'CANVA* I04983-999', -3000);
    expect(listSubscriptions(d, TODAY).subs.find(s => s.name === 'Canva')!.attribution.storeId).toBe('pb');
  });
});
