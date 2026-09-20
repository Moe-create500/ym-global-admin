import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { measurePerOrderCents, getUnfulfilledLiability, _clearUnfulfilledCache, STALE_AFTER_DAYS } from './unfulfilled-liability';

const creds = vi.fn();
const get = vi.fn();
vi.mock('./shopify-sync', () => ({
  getCreds: (...a: any[]) => creds(...a),
  shopifyGet: (...a: any[]) => get(...a),
}));

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE daily_pnl (store_id TEXT, date TEXT, order_count INTEGER, shipping_cost_cents INTEGER, fulfillment_est_cents INTEGER);
    CREATE TABLE orders (id TEXT PRIMARY KEY, store_id TEXT, order_date TEXT, fulfillment_status TEXT);
  `);
  // 10 billed days at ~$6.92/order
  const ins = db.prepare('INSERT INTO daily_pnl VALUES (?,?,?,?,0)');
  for (let i = 1; i <= 10; i++) ins.run('elvris', new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), 20, 20 * 692);
  return db;
}

beforeEach(() => { _clearUnfulfilledCache(); creds.mockReset(); get.mockReset(); });

describe('what ShipSourced actually bills per order', () => {
  it('measures it from billed days in the ledger', () => {
    const r = measurePerOrderCents(fixture() as any, 'elvris');
    expect(r.cents).toBe(692);
    expect(r.basisOrders).toBe(200);
  });

  it('one re-billed day does not skew it — the median holds', () => {
    const db = fixture();
    db.prepare('INSERT INTO daily_pnl VALUES (?,?,?,?,0)').run('elvris', '2026-09-06', 20, 20 * 692 + 301100);
    expect(measurePerOrderCents(db as any, 'elvris').cents).toBe(692);
  });

  it('estimated days are excluded, so an estimate is never priced off an estimate', () => {
    const db = fixture();
    db.prepare('INSERT INTO daily_pnl VALUES (?,?,?,?,?)').run('elvris', '2026-09-05', 20, 40000, 40000);
    expect(measurePerOrderCents(db as any, 'elvris').basisDays).toBe(10);
  });

  it('says it cannot price an order rather than guessing', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE daily_pnl (store_id TEXT, date TEXT, order_count INTEGER, shipping_cost_cents INTEGER, fulfillment_est_cents INTEGER)');
    const r = measurePerOrderCents(db as any, 'nobody');
    expect(r.cents).toBeNull();
    expect(r.note).toMatch(/not enough billed history/);
  });
});

describe('the unfulfilled bill', () => {
  it('takes the count live from Shopify and prices it at the measured rate', async () => {
    creds.mockReturnValue({ shop_domain: 'x.myshopify.com' });
    get.mockResolvedValueOnce({ count: 157 }).mockResolvedValueOnce({ count: 139 });
    const r = await getUnfulfilledLiability(fixture() as any, 'elvris');
    expect(r).toMatchObject({ source: 'shopify', openCount: 139, staleCount: 18, perOrderCents: 692, cents: 139 * 692 });
    expect(r.note).toContain('live from Shopify');
    expect(r.note).toContain('18 older than');
  });

  it('never folds months-old unfulfilled orders into the bill', async () => {
    creds.mockReturnValue({ shop_domain: 'x.myshopify.com' });
    get.mockResolvedValueOnce({ count: 100 }).mockResolvedValueOnce({ count: 10 });
    const r = await getUnfulfilledLiability(fixture() as any, 'elvris');
    expect(r.openCount).toBe(10);
    expect(r.staleCount).toBe(90);
    expect(r.cents).toBe(10 * 692);
  });

  it('reports an unknown cost as unknown when there is no billed history', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE daily_pnl (store_id TEXT, date TEXT, order_count INTEGER, shipping_cost_cents INTEGER, fulfillment_est_cents INTEGER);
             CREATE TABLE orders (id TEXT PRIMARY KEY, store_id TEXT, order_date TEXT, fulfillment_status TEXT);`);
    creds.mockReturnValue({ shop_domain: 'x.myshopify.com' });
    get.mockResolvedValueOnce({ count: 5 }).mockResolvedValueOnce({ count: 5 });
    const r = await getUnfulfilledLiability(db as any, 'new-store');
    expect(r.openCount).toBe(5);
    expect(r.cents).toBeNull();
    expect(r.note).toContain('cost is unknown');
  });

  it('falls back to the local table when the store has no Shopify app, and dates it honestly', async () => {
    const db = fixture();
    db.prepare("INSERT INTO orders VALUES ('o1','elvris','2026-08-31','unfulfilled'), ('o2','elvris','2026-08-30','partial')").run();
    creds.mockReturnValue(null);
    const r = await getUnfulfilledLiability(db as any, 'elvris');
    expect(r).toMatchObject({ source: 'local_orders', openCount: 2, asOf: '2026-08-31', cents: 2 * 692 });
    expect(r.note).toContain('last updated 2026-08-31');
    expect(r.note).toContain('connect this store');
  });

  it('a Shopify error falls back instead of breaking the CFO page, and says what Shopify said', async () => {
    const db = fixture();
    creds.mockReturnValue({ shop_domain: 'x.myshopify.com' });
    get.mockRejectedValue(new Error('401 Invalid API key'));
    const r = await getUnfulfilledLiability(db as any, 'elvris');
    expect(r.source).toBe('local_orders');
    expect(r.note).toContain('401 Invalid API key');
  });

  it('caches so the CFO page does not hit Shopify on every load', async () => {
    creds.mockReturnValue({ shop_domain: 'x.myshopify.com' });
    get.mockResolvedValue({ count: 10 });
    const db = fixture();
    await getUnfulfilledLiability(db as any, 'elvris');
    await getUnfulfilledLiability(db as any, 'elvris');
    expect(get).toHaveBeenCalledTimes(2);   // two counts, one round of calls
  });

  it('the stale cutoff is a real window, not an off-by-one', () => {
    expect(STALE_AFTER_DAYS).toBeGreaterThan(30);
  });
});
