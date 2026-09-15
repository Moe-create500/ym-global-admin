import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { listScopes, resolveScope, childUnits } from './scopes';
import { figure, sumFigures, missing } from './figures';
import { getOverview, priorPeriod, defaultPeriod } from './report';
import { collectIssues, countByUnit, issuesForScope } from './issues';
import { traceFigure } from './trace';
import { isCfoV2Enabled, setCfoV2 } from './flags';

const NOW = Date.parse('2026-09-15T12:00:00Z');
const ts = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT, platform TEXT, brand TEXT, is_active INTEGER DEFAULT 1, dashboard_hidden INTEGER DEFAULT 0,
      shopify_balance_cents INTEGER, shopify_payout_cents INTEGER, ss_net_owed_cents INTEGER, last_synced_at TEXT);
    CREATE TABLE shopify_credentials (store_id TEXT PRIMARY KEY, last_synced_at TEXT);
    CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, store_id TEXT, company TEXT, account_type TEXT, account_name TEXT, institution_name TEXT, last_four TEXT,
      balance_available_cents INTEGER, balance_ledger_cents INTEGER, balance_updated_at TEXT, credit_limit_cents INTEGER, status TEXT DEFAULT 'active', cfo_hidden INTEGER DEFAULT 0,
      teller_enrollment_id TEXT, last_sync_error TEXT, bank_data_as_of TEXT, merged_into TEXT);
    CREATE TABLE plaid_items (item_id TEXT PRIMARY KEY, status TEXT, provider_error_code TEXT, pending_disconnect_at TEXT, liabilities_status TEXT);
    CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT, amount_cents INTEGER, status TEXT DEFAULT 'posted');
    CREATE TABLE classification_results (txn_id TEXT PRIMARY KEY, category TEXT, store_id TEXT, suggested_store_id TEXT, method TEXT);
    CREATE TABLE daily_pnl (id TEXT PRIMARY KEY, store_id TEXT, date TEXT, revenue_cents INTEGER DEFAULT 0, order_count INTEGER DEFAULT 0, cogs_cents INTEGER DEFAULT 0,
      shipping_cost_cents INTEGER DEFAULT 0, pick_pack_cents INTEGER DEFAULT 0, packaging_cents INTEGER DEFAULT 0, ad_spend_cents INTEGER DEFAULT 0, shopify_fees_cents INTEGER DEFAULT 0,
      other_costs_cents INTEGER DEFAULT 0, chargeback_cents INTEGER DEFAULT 0, app_costs_cents INTEGER DEFAULT 0, refunds_cents INTEGER DEFAULT 0, fulfillment_est_cents INTEGER DEFAULT 0,
      net_profit_cents INTEGER DEFAULT 0, source TEXT, synced_at TEXT, updated_at TEXT, created_at TEXT);
    CREATE TABLE cfo_snapshots (id TEXT PRIMARY KEY, store_id TEXT, snapshot_date TEXT, assets_cents INTEGER, liabilities_cents INTEGER, equity_cents INTEGER, created_at TEXT, excluded INTEGER DEFAULT 0);
    CREATE TABLE cfo_reconciliations (id TEXT PRIMARY KEY, store_id TEXT, status TEXT, residual_cents INTEGER, period_end TEXT, created_at TEXT);
    CREATE TABLE card_statements (bank_account_id TEXT PRIMARY KEY, statement_balance_cents INTEGER, due_date TEXT, min_payment_cents INTEGER, updated_at TEXT, source TEXT);
    CREATE TABLE card_payments_log (id TEXT PRIMARY KEY, store_id TEXT, card_last4 TEXT, date TEXT, amount_cents INTEGER, notes TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE fb_funding_cards (last4 TEXT PRIMARY KEY, bank_account_id TEXT, learned_from TEXT);
    CREATE TABLE manual_credit_cards (id TEXT PRIMARY KEY, store_id TEXT, card_name TEXT, amount_owed_cents INTEGER);
    CREATE TABLE fb_profiles (id TEXT PRIMARY KEY, store_id TEXT, profile_name TEXT, ad_account_id TEXT, is_active INTEGER DEFAULT 1, last_sync_at TEXT, token_expires_at TEXT);
    CREATE TABLE ad_payments (id TEXT PRIMARY KEY, account_id TEXT, date TEXT, amount_cents INTEGER);
    CREATE TABLE orders (id TEXT PRIMARY KEY, store_id TEXT, fulfillment_status TEXT, ss_charge_cents INTEGER);
    INSERT INTO stores (id, name, platform, shopify_balance_cents, shopify_payout_cents, ss_net_owed_cents, last_synced_at) VALUES
      ('elv','Elvris','shopify', 120000, 30000, 250000, '${ts(2)}'),
      ('pb','Purebite','shopify', 0, 0, 0, '${ts(2)}'),
      ('ss','ShipSourced','custom', 0, 0, 0, '${ts(2)}');
    INSERT INTO shopify_credentials VALUES ('elv', '${ts(1)}');
    INSERT INTO bank_accounts (id, store_id, company, account_type, account_name, institution_name, last_four, balance_available_cents, balance_ledger_cents, balance_updated_at, credit_limit_cents, teller_enrollment_id, bank_data_as_of) VALUES
      ('chk-elv','elv','ymgv','depository','Checking','Bank of America','7881', 500000, 500000, '${ts(3)}', NULL, 'item1', '2026-09-14'),
      ('chk-pb','pb','ymgv','depository','Checking','Bank of America','5653', 200000, 200000, '${ts(80)}', NULL, 'item2', '2026-09-10'),
      ('card-pb','pb','ymgv','credit','Platinum','American Express','1009', 100000, -900000, '${ts(3)}', 1000000, 'item2', '2026-09-14'),
      ('chk-ss','ss','shipsourced','depository','Ops','Bank of America','7904', 300000, 300000, '${ts(3)}', NULL, 'item3', '2026-09-14');
    INSERT INTO plaid_items VALUES ('item1','active',NULL,NULL,'ok'), ('item2','active',NULL,NULL,'ok'), ('item3','active',NULL,NULL,'ok');
    INSERT INTO card_statements VALUES ('card-pb', 600000, '2026-09-20', 25000, '${ts(3)}', 'plaid');
  `);
  const pnl = db.prepare(`INSERT INTO daily_pnl (id, store_id, date, revenue_cents, cogs_cents, ad_spend_cents, shopify_fees_cents, fulfillment_est_cents, net_profit_cents, source, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  pnl.run('p1', 'elv', '2026-09-02', 100000, 30000, 20000, 3000, 0, 47000, 'shipsourced', ts(2));
  pnl.run('p2', 'elv', '2026-09-10', 200000, 60000, 40000, 6000, 5000, 94000, 'shipsourced', ts(2));
  pnl.run('p3', 'elv', '2026-08-20', 150000, 50000, 30000, 4000, 0, 66000, 'shipsourced', ts(2));   // prior period
  pnl.run('p4', 'pb', '2026-09-05', 80000, 20000, 10000, 2000, 0, 48000, 'shipsourced', ts(2));
  db.prepare(`INSERT INTO cfo_snapshots VALUES (?,?,?,?,?,?,?,0)`).run('s1', 'elv', '2026-09-14', 900000, 400000, 500000, ts(20));
  db.prepare(`INSERT INTO cfo_snapshots VALUES (?,?,?,?,?,?,?,0)`).run('s2', 'pb', '2026-08-20', 500000, 300000, 200000, ts(24 * 26));
  db.prepare(`INSERT INTO cfo_snapshots VALUES (?,?,?,?,?,?,?,1)`).run('s3', 'pb', '2026-09-14', 1, 1, 0, ts(1));       // blocked — must be ignored
  const txn = db.prepare('INSERT INTO bank_transactions (id, bank_account_id, date, description, amount_cents) VALUES (?,?,?,?,?)');
  txn.run('t1', 'card-pb', '2026-09-03', 'FACEBK *ABC', -50000);      // paired
  txn.run('t2', 'card-pb', '2026-09-04', 'HIGGSFIELD INC.', -5800);   // unpaired
  txn.run('t3', 'card-pb', '2026-09-05', 'ONLINE PAYMENT - THANK YOU', 100000);
  txn.run('t4', 'chk-pb', '2026-09-06', 'AMERICAN EXPRESS DES:ACH PMT', -100000); // card payment — never "unallocated"
  txn.run('t5', 'chk-pb', '2026-09-07', 'Online Banking transfer to CHK 7881', -20000);
  db.prepare('INSERT INTO classification_results VALUES (?,?,?,?,?)').run('t1', 'Ad Spend', 'pb', null, 'INVOICE_MATCH');
  db.prepare('INSERT INTO classification_results VALUES (?,?,?,?,?)').run('t4', 'Credit Card Payment', null, null, 'CARD_PAYMENT_MATCH');
  db.prepare('INSERT INTO classification_results VALUES (?,?,?,?,?)').run('t5', 'Transfer Out', null, null, 'TRANSFER');
  return db;
}
const PERIOD = { from: '2026-09-01', to: '2026-09-15' };
const noFlags = async () => ({ available: false, reason: 'test: no endpoint' });

describe('scopes', () => {
  it('keeps stores, ShipSourced, and its two warehouses apart and marks the warehouse mapping unresolved', () => {
    const db = freshDb();
    const s = listScopes(db);
    expect(s.map(x => x.id)).toEqual(['all', 'stores', 'store:elv', 'store:pb', 'ss', 'ss:ca', 'ss:cn']);
    expect(resolveScope(db, 'ss:cn')!.mapping.status).toBe('unresolved');
    expect(resolveScope(db, 'ss:cn')!.legalEntity).toBeNull();     // never assumed
    expect(childUnits(db, resolveScope(db, 'all')!).map(x => x.id)).toEqual(['store:elv', 'store:pb', 'ss']);
    expect(childUnits(db, resolveScope(db, 'ss')!).map(x => x.id)).toEqual(['ss:ca', 'ss:cn']);
    expect(resolveScope(db, 'nope')).toBeNull();
  });
});

describe('figures', () => {
  it('unknown is not zero; stale keeps last-known with its timestamp; mixed as-of dates are flagged', () => {
    expect(missing('x', 'src', 'n').cents).toBeNull();
    const stale = figure({ cents: 100, asOf: ts(100), source: 's', trace: 'cash', maxAgeHours: 36 }, NOW);
    expect(stale.kind).toBe('stale'); expect(stale.cents).toBe(100);
    const fresh = figure({ cents: 50, asOf: ts(1), source: 's', trace: 'cash', maxAgeHours: 36 }, NOW);
    const total = sumFigures([stale, fresh], 'cash', 's');
    expect(total.cents).toBe(150); expect(total.kind).toBe('stale'); expect(total.mixedAsOf).toBe(true);
    const withMissing = sumFigures([fresh, missing('cash', 's', 'n')], 'cash', 's');
    expect(withMissing.kind).toBe('missing');
    const partial = sumFigures([fresh, missing('cash', 's', 'n')], 'cash', 's', { partial: true });
    expect(partial.cents).toBe(50); expect(partial.kind).toBe('derived'); expect(partial.note).toMatch(/1 of 2 inputs unknown/);
  });
  it('periods: prior period is the same length ending the day before', () => {
    expect(priorPeriod({ from: '2026-09-01', to: '2026-09-15' })).toEqual({ from: '2026-08-17', to: '2026-08-31' });
    expect(defaultPeriod(new Date('2026-09-15T10:00:00Z'))).toEqual({ from: '2026-09-01', to: '2026-09-15' });
  });
});

describe('overview', () => {
  it('per-store rows carry revenue, provisional profit, cash freshness and snapshot net assets with provenance', async () => {
    const db = freshDb();
    const issues = await collectIssues(db, PERIOD, noFlags, NOW);
    const scopes = listScopes(db);
    const ov = getOverview(db, resolveScope(db, 'all')!, PERIOD, countByUnit(issues, scopes), NOW);
    const elv = ov.rows.find(r => r.unit.id === 'store:elv')!;
    expect(elv.revenue.cents).toBe(300000); expect(elv.revenue.kind).toBe('actual'); expect(elv.revenue.compare).toBe(150000);
    expect(elv.netProfit.cents).toBe(141000); expect(elv.netProfit.kind).toBe('estimated'); // fulfilment estimate present
    expect(elv.cash.cents).toBe(500000); expect(elv.cash.kind).toBe('actual');
    expect(elv.netAssets.cents).toBe(500000); expect(elv.netAssets.kind).toBe('actual');
    const pb = ov.rows.find(r => r.unit.id === 'store:pb')!;
    expect(pb.cash.kind).toBe('stale');                          // 80h-old balance, value kept
    expect(pb.cash.cents).toBe(200000);
    expect(pb.netAssets.kind).toBe('stale'); expect(pb.netAssets.cents).toBe(200000); // blocked snapshot ignored
    expect(pb.cardDebt.cents).toBe(900000);
    const ss = ov.rows.find(r => r.unit.id === 'ss')!;
    expect(ss.revenue.kind).toBe('missing'); expect(ss.netAssets.kind).toBe('missing');
    // headline
    expect(ov.headline.availableCash.cents).toBe(1000000); expect(ov.headline.availableCash.kind).toBe('stale');
    expect(ov.headline.pendingPayouts.cents).toBe(150000);
    expect(ov.headline.obligationsDueSoon.cents).toBe(25000 + 250000);
    expect(ov.headline.periodProfit.cents).toBe(141000 + 48000);
    // unallocated: only the Higgsfield charge; card payment + transfer excluded
    expect(ov.unallocated.figure.cents).toBe(5800);
    expect(ov.unallocated.byAccount).toEqual([{ account: 'Platinum', last4: '1009', count: 1, cents: 5800 }]);
    expect(ov.totals.netAssets.mixedAsOf).toBe(true);          // 20h vs 26d old snapshots
    expect(ov.currency).toBe('USD');
  });

  it('warehouse scopes never borrow company cash or invent a P&L', async () => {
    const db = freshDb();
    const ov = getOverview(db, resolveScope(db, 'ss:cn')!, PERIOD, new Map(), NOW);
    const row = ov.rows[0];
    expect(row.unit.id).toBe('ss:cn');
    expect(row.status).toBe('unmapped');
    expect(row.cash.kind).toBe('missing'); expect(row.revenue.kind).toBe('missing'); expect(row.netAssets.kind).toBe('missing');
    expect(ov.headline.availableCash.kind).toBe('missing');
  });

  it('every headline and row figure ties to its trace total', async () => {
    const db = freshDb();
    for (const scopeId of ['all', 'stores', 'store:elv', 'store:pb', 'ss']) {
      const scope = resolveScope(db, scopeId)!;
      const ov = getOverview(db, scope, PERIOD, new Map(), NOW);
      const pairs: [string, number | null][] = [
        ['revenue', ov.totals.revenue.cents], ['net_profit', ov.totals.netProfit.cents], ['cash', ov.totals.cash.cents],
        ['net_assets', ov.totals.netAssets.cents], ['unallocated', ov.unallocated.figure.cents], ['pending_payouts', ov.headline.pendingPayouts.cents],
        ['obligations', ov.headline.obligationsDueSoon.cents],
      ];
      for (const [key, cents] of pairs) {
        const t = traceFigure(db, key, scope, PERIOD)!;
        expect(t, `${scopeId}/${key}`).toBeTruthy();
        if (cents == null) continue;
        expect(t.included.total, `${scopeId}/${key}`).toBe(cents);
        const rowSum = t.included.rows.reduce((s, r) => s + (Number(r[t.included.columns.indexOf('amount')]) || 0), 0);
        if (!t.included.truncated && t.included.rows.length) expect(rowSum, `${scopeId}/${key} rows`).toBe(cents);
      }
    }
  });
});

describe('issues', () => {
  it('surfaces stale balances, unallocated charges, double-counted manual rows, old snapshots, mapping decisions and the unavailable ShipSourced feed — with no invented amounts', async () => {
    const db = freshDb();
    db.prepare('INSERT INTO card_payments_log (id, store_id, card_last4, date, amount_cents) VALUES (?,?,?,?,?)').run('l1', 'elv', '1009', '2026-09-14', 55966);
    db.prepare('INSERT INTO manual_credit_cards VALUES (?,?,?,?)').run('m1', 'elv', 'inflight', 55966);
    const issues = await collectIssues(db, PERIOD, noFlags, NOW);
    const kinds = issues.map(i => i.kind);
    expect(kinds).toContain('stale_source');       // chk-pb balance 80h old
    expect(kinds).toContain('unallocated');
    expect(kinds).toContain('double_count');
    expect(kinds).toContain('mapping');
    expect(kinds).toContain('source_unavailable');
    const ss = issues.find(i => i.kind === 'source_unavailable')!;
    expect(ss.count).toBe(0); expect(ss.cents).toBeNull(); expect(ss.detail).toMatch(/not zero|no endpoint/);
    const un = issues.find(i => i.kind === 'unallocated')!;
    expect(un.cents).toBe(5800); expect(un.count).toBe(1);
    const scopes = listScopes(db);
    expect(issuesForScope(issues, resolveScope(db, 'store:elv')!, scopes).every(i => i.unitId === 'store:elv')).toBe(true);
    expect(issuesForScope(issues, resolveScope(db, 'ss')!, scopes).some(i => i.kind === 'mapping')).toBe(true);
    expect(countByUnit(issues, scopes).get('all')).toBe(issues.length);
  });

  it('reads ShipSourced flags with their own identity and honours suppression', async () => {
    const db = freshDb();
    const feed = async () => ({ available: true, asOf: 'now', flags: [
      { ruleKey: 'missing_product_cost', severity: 'critical', status: 'OPEN', count: 12, amountCents: null, clientId: 'c1', company: 'Magvita', suppressed: true },
      { ruleKey: 'missing_product_cost', severity: 'critical', status: 'OPEN', count: 3, amountCents: null, clientId: 'c2', company: 'Dripy' },
      { ruleKey: 'below_cost', severity: 'warning', status: 'OPEN', count: 5, amountCents: 12345, clientId: null, company: null },
    ] });
    const issues = (await collectIssues(db, PERIOD, feed, NOW)).filter(i => i.kind === 'ss_billing_flag');
    expect(issues).toHaveLength(2);
    expect(issues[0].externalId).toBe('missing_product_cost:c2'); expect(issues[0].cents).toBeNull(); expect(issues[0].count).toBe(3);
    expect(issues[1].cents).toBe(12345); expect(issues[1].externalStatus).toBe('OPEN');
  });
});

describe('flag', () => {
  it('defaults off, request override wins, setting persists', () => {
    const db = new Database(':memory:');
    expect(isCfoV2Enabled(db)).toBe(false);
    expect(isCfoV2Enabled(db, '1')).toBe(true);
    setCfoV2(db, true);
    expect(isCfoV2Enabled(db)).toBe(true);
    expect(isCfoV2Enabled(db, '0')).toBe(false);
  });
});

describe('movements', () => {
  it('own-account and intercompany transfers are money moving, not unallocated charges', async () => {
    const db = freshDb();
    const txn = db.prepare('INSERT INTO bank_transactions (id, bank_account_id, date, description, amount_cents) VALUES (?,?,?,?,?)');
    txn.run('m1', 'chk-elv', '2026-09-13', 'ACH transfer to Bank of America (7904)', -809578);   // ··7904 is ours
    txn.run('m2', 'chk-elv', '2026-09-14', 'ACH transfer to SHIPSOURCED', -47522);
    txn.run('m3', 'chk-elv', '2026-09-14', 'Zelle payment to ROYAL STAR LLC', -300000);         // a real charge
    txn.run('m4', 'chk-elv', '2026-09-14', 'Online transfer to CHK 7523 Confirmation# x', -100000); // 7523 is NOT ours → charge
    const ov = getOverview(db, resolveScope(db, 'store:elv')!, PERIOD, new Map(), NOW);
    expect(ov.unallocated.figure.cents).toBe(300000 + 100000);
    expect(ov.unallocated.movementsCents).toBe(809578 + 47522);
    const t = traceFigure(db, 'unallocated', resolveScope(db, 'store:elv')!, PERIOD)!;
    expect(t.included.total).toBe(400000);
    expect(t.excluded[0]).toMatch(/2 internal movements/);
    const issues = await collectIssues(db, PERIOD, noFlags, NOW);
    expect(issues.find(i => i.kind === 'unallocated' && i.title.includes('7881'))!.cents).toBe(400000);
  });
});
