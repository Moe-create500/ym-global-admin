import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { defaultClass, classifyRow, setRowClass, ledgerCosts, ensureSsCostSchema } from './ss-costs';
import { composePnl } from './ss-pnl';
import type { SSPnlResponse } from '../shipsourced';

function db() {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE bank_transactions (id TEXT PRIMARY KEY, bank_account_id TEXT, date TEXT, description TEXT, amount_cents INTEGER, custom_store_id TEXT);
    CREATE TABLE classification_results (txn_id TEXT PRIMARY KEY, category TEXT, store_id TEXT);
    INSERT INTO stores VALUES ('ss','ShipSourced');
  `);
  const ins = d.prepare('INSERT INTO bank_transactions (id, bank_account_id, date, description, amount_cents) VALUES (?,?,?,?,?)');
  const cls = d.prepare('INSERT INTO classification_results VALUES (?,?,?)');
  const rows: [string, string, number, string | null][] = [
    ['t1', '1688.com', -180595, null], ['t2', 'XE Money Transfer', -824000, null], ['t3', 'SHIPHERO.COM GARNERVILLE NY', -225699, null],
    ['t4', 'GRAINGER', -35204, null], ['t5', 'USPS.COM USPS LABELS', -231142, null], ['t6', 'LATE FEE', -3900, null],
    ['t7', 'EBAY O*26-13408-82190', -128171, null], ['t8', 'ONLINE BANKING TRANSFER TO CHK 7904', -1000000, 'Transfer Out'], ['t9', 'MY CABLE MART LLC', -9517, null],
    ['t10', 'AMERICAN EXPRESS DES:ACH PMT', -500000, 'Credit Card Payment'],
  ];
  for (const [id, desc, amt, cat] of rows) { ins.run(id, 'card', '2026-09-05', desc, amt); cls.run(id, cat, 'ss'); }
  ensureSsCostSchema(d);
  return d;
}

describe('ShipSourced cost classification', () => {
  it('maps merchants to a fulfilment line and centre by default', () => {
    expect(defaultClass('1688.com')).toEqual({ line: 'product_cogs', center: 'CN' });
    expect(defaultClass('XE Money Transfer')).toEqual({ line: 'china_agent', center: 'CN' });
    expect(defaultClass('SHIPHERO.COM GARNERVILLE NY')).toEqual({ line: 'software_3pl', center: 'shared' });
    expect(defaultClass('GRAINGER')).toEqual({ line: 'packaging_supplies', center: 'CA' });
    expect(defaultClass('USPS.COM USPS LABELS')).toEqual({ line: 'carrier_labels', center: 'CA' });
    expect(defaultClass('ESCOR Group DES:ESCOR Grou')).toEqual({ line: 'warehouse_lease', center: 'CA' });
    expect(defaultClass('Interest Charge on Pay Over Time Purchases')).toEqual({ line: 'card_fees', center: 'shared' });
    expect(defaultClass('ONLINE BANKING TRANSFER TO CHK 7904')).toEqual({ line: 'movement', center: 'shared' });
    expect(defaultClass('MYSTERY VENDOR 123')).toBeNull();
  });
  it('a worker override wins and, when remembered, applies to every charge from that merchant', () => {
    const d = db();
    expect(classifyRow(d, 't7', 'EBAY O*26-13408-82190')).toMatchObject({ line: 'marketplace_purchase', center: 'CA', source: 'default', needsReview: true });
    setRowClass(d, 't7', 'equipment', 'CA', 'moe', true, 'EBAY O*26-13408-82190');
    expect(classifyRow(d, 't7', 'EBAY O*26-13408-82190')).toMatchObject({ line: 'equipment', source: 'manual', needsReview: false });
    expect(classifyRow(d, 'new', 'EBAY O*99-00000-11111')).toMatchObject({ line: 'equipment', center: 'CA', source: 'rule', needsReview: false });
    expect(classifyRow(d, 'x', 'MYSTERY VENDOR')).toMatchObject({ line: 'other', source: 'default', needsReview: true });
  });
  it('ledger costs by line × centre exclude money movement and reconcile to the rows', () => {
    const d = db();
    const l = ledgerCosts(d, 'ss', '2026-09-01', '2026-09-30');
    expect(l.rows).toBe(8);   // t8 (transfer) and t10 (card payment) excluded
    expect(l.total).toBe(180595 + 824000 + 225699 + 35204 + 231142 + 3900 + 128171 + 9517);
    expect(l.cells.reduce((s, c) => s + c.cents, 0)).toBe(l.total);
    expect(l.needsReviewCents).toBe(128171);
    expect(l.cells.find(c => c.line === 'china_agent')).toMatchObject({ center: 'CN', cents: 824000, count: 1 });
  });
});

describe('ShipSourced P&L composition', () => {
  const feed: SSPnlResponse = {
    asOf: '2026-09-15T00:00:00Z', period: { from: '2026-09-01', to: '2026-09-30' }, note: '',
    regions: [
      { region: 'US', charges: 100, noWarehouse: 3, productCostMissing: 0, revenue: { shipping: 800000, product: 300000, chinaFee: 0, managerFee: 0, pickPack: 20000, service: { PICK: 5000 }, packaging: 1000, total: 826000 }, direct: { labelCost: 400000, productCost: 300000, serviceCost: 0, packagingCost: 500, total: 700500 } },
      { region: 'CN', charges: 300, noWarehouse: 0, productCostMissing: 10, revenue: { shipping: 1200000, product: 200000, chinaFee: 21000, managerFee: 30000, pickPack: 0, service: {}, packaging: 0, total: 1251000 }, direct: { labelCost: 700000, productCost: 200000, serviceCost: 0, packagingCost: 0, total: 900000 } },
      { region: 'unknown', charges: 2, noWarehouse: 2, productCostMissing: 0, revenue: { shipping: 1000, product: 0, chinaFee: 0, managerFee: 0, pickPack: 0, service: {}, packaging: 0, total: 1000 }, direct: { labelCost: 600, productCost: 0, serviceCost: 0, packagingCost: 0, total: 600 } },
    ],
    carrierInvoices: [{ carrierType: 'china', lane: 'CN', invoices: 5, usdCents: 650000, managerFeeCents: 0, creditsCents: 10000 }],
  };
  it('allocates shared ledger costs by revenue share, preserves totals, and derives gross/net per centre', () => {
    const d = db();
    const ledger = ledgerCosts(d, 'ss', '2026-09-01', '2026-09-30');
    const p = composePnl(feed, ledger, { from: '2026-09-01', to: '2026-09-30' });
    const [ca, cn] = p.centers;
    expect(p.source.shipsourced).toBe('live');
    expect(ca.revenueCents).toBe(826000); expect(ca.directCents).toBe(700500); expect(ca.grossCents).toBe(125500);
    expect(cn.revenueCents).toBe(1251000); expect(cn.grossCents).toBe(351000);
    // shared = ShipHero 225699 + late fee 3900 = 229599, split 826000 : 1251000
    const shareCA = 826000 / (826000 + 1251000);
    expect(p.shared.totalCents).toBe(229599);
    expect(p.shared.allocation.CA).toBe(Math.round(229599 * shareCA));
    expect(p.shared.allocation.CA + p.shared.allocation.CN).toBe(229599);
    expect(ca.opexDirectCents).toBe(35204 + 231142 + 128171 + 9517);
    expect(cn.opexDirectCents).toBe(180595 + 824000);
    expect(ca.opexCents + cn.opexCents).toBe(ledger.total);
    expect(ca.netCents).toBe(125500 - ca.opexCents); expect(cn.netCents).toBe(351000 - cn.opexCents);
    expect(cn.carrierInvoiceCents).toBe(640000); expect(ca.carrierInvoiceCents).toBe(0);
    expect(p.unknownRegion).toMatchObject({ charges: 2, revenueCents: 1000 });
    expect(p.combined.revenueCents).toBe(826000 + 1251000 + 1000);
    expect(p.combined.netCents).toBe(ca.netCents! + cn.netCents! + 400);
    expect(p.combined.opexCents).toBe(ledger.total);
  });
  it('without the ShipSourced feed, revenue/gross/net are unknown (null), opex still shows, shared split 50/50 and labelled', () => {
    const d = db();
    const p = composePnl(null, ledgerCosts(d, 'ss', '2026-09-01', '2026-09-30'), { from: '2026-09-01', to: '2026-09-30' }, 'PR pending');
    expect(p.source).toEqual({ shipsourced: 'unavailable', reason: 'PR pending' });
    for (const c of p.centers) { expect(c.revenueCents).toBeNull(); expect(c.netCents).toBeNull(); expect(c.opexCents).toBeGreaterThan(0); }
    expect(p.shared.basis).toMatch(/50\/50/);
    expect(p.combined.revenueCents).toBeNull(); expect(p.combined.opexCents).toBeGreaterThan(0);
  });
});
