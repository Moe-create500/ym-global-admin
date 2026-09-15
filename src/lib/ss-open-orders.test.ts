import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { estimateFromFeed, storeClientIds } from './ss-open-orders';
import type { SSOpenOrdersResponse } from './shipsourced';

const feed = (over: Partial<SSOpenOrdersResponse> = {}): SSOpenOrdersResponse => ({
  asOf: '2026-09-15T20:00:00Z',
  client: { id: 'c1', name: 'Elivris', productCostExempt: false, usProductCostExempt: false },
  openCount: 3, byStatus: { NEW: 2, ON_HOLD: 1 },
  openOrders: [
    { id: 'o1', status: 'NEW', createdAt: null, orderDate: null, totalPrice: 40, warehouse: 'CN', productCostCents: 189, productCostComplete: true, lineItems: [] },
    { id: 'o2', status: 'NEW', createdAt: null, orderDate: null, totalPrice: 80, warehouse: 'CN', productCostCents: 378, productCostComplete: true, lineItems: [] },
    { id: 'o3', status: 'ON_HOLD', createdAt: null, orderDate: null, totalPrice: 40, warehouse: 'US', productCostCents: 0, productCostComplete: false, lineItems: [] },
  ],
  recent: { days: 60, charges: 2395, avgTotalCents: 758, avgLabelCents: 430, avgProductCents: 136, avgPickPackCents: 100, avgChinaFeeCents: 4, avgManagerCents: 0 },
  ...over,
});

describe('ShipSourced open-orders estimate', () => {
  it('exact product cost per order + the client\'s own recent label/pick-pack average per open order', () => {
    const e = estimateFromFeed([feed()]);
    expect(e.openCount).toBe(3);
    expect(e.byStatus).toEqual({ NEW: 2, ON_HOLD: 1 });
    expect(e.productCostCents).toBe(189 + 378);
    expect(e.perOrderOtherCents).toBe(430 + 100 + 4);          // product cost is NOT double counted from the average
    expect(e.otherCents).toBe(3 * 534);
    expect(e.estimatedCents).toBe(567 + 1602);
    expect(e.productCostIncomplete).toBe(1);
    expect(e.source).toBe('shipsourced');
  });
  it('sums several clients of one store and keeps each client visible', () => {
    const e = estimateFromFeed([feed(), feed({ client: { id: 'c2', name: 'Elivris US', productCostExempt: true, usProductCostExempt: false }, openCount: 1, byStatus: { NEW: 1 }, openOrders: [{ id: 'x', status: 'NEW', createdAt: null, orderDate: null, totalPrice: 10, warehouse: 'US', productCostCents: 0, productCostComplete: true, lineItems: [] }], recent: { days: 60, charges: 10, avgTotalCents: 600, avgLabelCents: 500, avgProductCents: 0, avgPickPackCents: 100, avgChinaFeeCents: 0, avgManagerCents: 0 } })]);
    expect(e.openCount).toBe(4); expect(e.byStatus.NEW).toBe(3);
    expect(e.clients.map(c => c.openCount)).toEqual([3, 1]);
    expect(e.estimatedCents).toBe(567 + 1602 + 600);
    expect(e.clientOwned).toBe(true);
  });
  it('an empty feed is zero open orders, not an error', () => {
    const e = estimateFromFeed([feed({ openCount: 0, byStatus: {}, openOrders: [] })]);
    expect(e.openCount).toBe(0); expect(e.estimatedCents).toBe(0);
  });
  it('collects the primary and extra client ids of a store', () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE stores (id TEXT PRIMARY KEY, shipsourced_client_id TEXT, shipsourced_extra_client_ids TEXT); INSERT INTO stores VALUES ('s','c1',' c2, c1 ,'), ('t',NULL,NULL)");
    expect(storeClientIds(db, 's')).toEqual(['c1', 'c2']);
    expect(storeClientIds(db, 't')).toEqual([]);
    expect(storeClientIds(db, 'nope')).toEqual([]);
  });
});
