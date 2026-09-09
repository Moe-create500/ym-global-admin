import { describe, it, expect } from 'vitest';
import {
  netProfitCents,
  netRevenueCents,
  totalCostsCents,
  marginPct,
  computePnl,
  refundsAppliedCents,
  revenueIsNetOfRefunds,
} from './finance-core';

// Regression suite for the canonical P&L math (audit 2026-09-09).
// Before finance-core existed the codebase had 20+ inline profit formulas that
// disagreed on refunds, cogs, chargebacks, and app costs. These tests pin the
// canonical semantics so no writer can drift again.

const fullCosts = {
  cogs_cents: 1000,
  shipping_cost_cents: 2000,
  pick_pack_cents: 300,
  packaging_cents: 200,
  ad_spend_cents: 4000,
  shopify_fees_cents: 500,
  other_costs_cents: 100,
  chargeback_cents: 700,
  app_costs_cents: 250,
}; // total = 9050

describe('totalCostsCents', () => {
  it('sums all nine cost columns', () => {
    expect(totalCostsCents({ revenue_cents: 0, ...fullCosts })).toBe(9050);
  });

  it('treats null/undefined cost inputs as 0 (arithmetic only — data quality is upstream)', () => {
    expect(totalCostsCents({ revenue_cents: 0, cogs_cents: null, ad_spend_cents: undefined })).toBe(0);
  });
});

describe('refund semantics', () => {
  it('gross-revenue sources subtract refunds (shipsourced/sync/csv_import/fb_sync/manual)', () => {
    for (const source of ['shipsourced', 'sync', 'csv_import', 'fb_sync', 'invoices', 'manual', 'orders', null, undefined]) {
      expect(refundsAppliedCents({ revenue_cents: 10000, refunds_cents: 1500, source })).toBe(1500);
    }
  });

  it("source='shopify' (Total sales) is already net of refunds — never subtract again", () => {
    expect(revenueIsNetOfRefunds('shopify')).toBe(true);
    expect(refundsAppliedCents({ revenue_cents: 10000, refunds_cents: 1500, source: 'shopify' })).toBe(0);
    expect(netRevenueCents({ revenue_cents: 10000, refunds_cents: 1500, source: 'shopify' })).toBe(10000);
  });

  it('missing refunds field means no refund deduction, not an error', () => {
    expect(netRevenueCents({ revenue_cents: 10000, source: 'shipsourced' })).toBe(10000);
  });
});

describe('netProfitCents', () => {
  it('net revenue minus all costs (the one canonical formula)', () => {
    expect(netProfitCents({ revenue_cents: 20000, refunds_cents: 1000, source: 'shipsourced', ...fullCosts }))
      .toBe(20000 - 1000 - 9050);
  });

  it('refund on a gross-revenue day reduces profit (2026-09-09 bug: it previously did not)', () => {
    const withoutRefund = netProfitCents({ revenue_cents: 295438, source: 'shipsourced', ...fullCosts });
    const withRefund = netProfitCents({ revenue_cents: 295438, refunds_cents: 38444, source: 'shipsourced', ...fullCosts });
    expect(withoutRefund - withRefund).toBe(38444);
  });

  it('chargebacks and app costs always reduce profit (several old writers dropped them)', () => {
    const base = netProfitCents({ revenue_cents: 10000, source: 'sync' });
    const withCb = netProfitCents({ revenue_cents: 10000, source: 'sync', chargeback_cents: 800, app_costs_cents: 200 });
    expect(base - withCb).toBe(1000);
  });

  it('cogs always reduces profit (shopify-revenue writer used to drop it)', () => {
    expect(netProfitCents({ revenue_cents: 5000, source: 'shopify', cogs_cents: 1200 })).toBe(3800);
  });

  it('loss days go negative — no clamping', () => {
    expect(netProfitCents({ revenue_cents: 100, source: 'sync', ad_spend_cents: 5000 })).toBe(-4900);
  });

  it('billing-only rows (zero revenue, only costs) equal negative total costs', () => {
    expect(netProfitCents({ revenue_cents: 0, source: 'sync', cogs_cents: 0, shipping_cost_cents: 4321 })).toBe(-4321);
  });

  it('integer cents in, integer cents out — no floating point drift', () => {
    const p = netProfitCents({ revenue_cents: 333333, refunds_cents: 111111, source: 'sync', ad_spend_cents: 55555 });
    expect(Number.isInteger(p)).toBe(true);
    expect(p).toBe(333333 - 111111 - 55555);
  });
});

describe('marginPct', () => {
  it('profit over revenue in percent', () => {
    expect(marginPct(2500, 10000)).toBe(25);
  });

  it('zero or negative revenue yields 0, never NaN/Infinity', () => {
    expect(marginPct(500, 0)).toBe(0);
    expect(marginPct(-500, 0)).toBe(0);
  });
});

describe('computePnl', () => {
  it('margin uses NET revenue as denominator', () => {
    const { netProfitCents: p, marginPct: m } = computePnl({
      revenue_cents: 11000,
      refunds_cents: 1000,
      source: 'shipsourced',
      ad_spend_cents: 5000,
    });
    expect(p).toBe(5000);
    expect(m).toBe(50); // 5000 / (11000-1000)
  });

  it('spreading a daily_pnl row with an override recomputes with the new value', () => {
    const row = { revenue_cents: 10000, refunds_cents: 0, source: 'shipsourced', ad_spend_cents: 1000 };
    expect(computePnl({ ...row, ad_spend_cents: 3000 }).netProfitCents).toBe(7000);
  });
});
