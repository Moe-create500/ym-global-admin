import { describe, it, expect } from 'vitest';
import { fallbackEstimatesFromHistory } from './fulfillment-estimate';

/** Unshipped orders must never read as free fulfilment. When ShipSourced's
 *  order list is unavailable, the store's own recent billing sets the rate. */
function history(days: number, orders: number, chargePerOrder: number, today: string) {
  const t = new Date(today + 'T00:00:00Z').getTime(); const d: Record<string, { orders: number; charges: number }> = {};
  for (let i = 0; i < days; i++) d[new Date(t - i * 86400000).toISOString().slice(0, 10)] = { orders, charges: orders * chargePerOrder };
  return d;
}

describe('fallback fulfilment estimate from the store\'s own billing', () => {
  it('fills today when orders exist but nothing is billed yet, at the trailing per-order rate', () => {
    const h = history(20, 20, 1377, '2026-09-16');
    h['2026-09-16'] = { orders: 18, charges: 0 };
    h['2026-09-15'] = { orders: 26, charges: 9800 };          // 10 of 26 shipped (yesterday)
    const r = fallbackEstimatesFromHistory(h, '2026-09-16');
    expect(r.avgPerOrderCents).toBe(1377);
    expect(r.estByDay['2026-09-16']).toBe(18 * 1377);
    expect(r.estByDay['2026-09-15']).toBe(26 * 1377 - 9800);
  });

  it('never tops up a day that is mostly billed, and never touches days before yesterday', () => {
    const h = history(20, 20, 1377, '2026-09-16');
    h['2026-09-15'] = { orders: 20, charges: 20 * 1377 - 1500 };  // one cheap order short — essentially billed
    h['2026-09-14'] = { orders: 20, charges: 0 };                 // two days back: shipped by now; a gap here is a billing question, not "unshipped"
    h['2026-09-05'] = { orders: 20, charges: 0 };
    const r = fallbackEstimatesFromHistory(h, '2026-09-16');
    expect(r.estByDay['2026-09-15']).toBeUndefined();
    expect(r.estByDay['2026-09-14']).toBeUndefined();
    expect(r.estByDay['2026-09-05']).toBeUndefined();
  });

  it('uses the MEDIAN daily rate, so a one-off re-bill day does not inflate the estimate', () => {
    const h = history(20, 20, 1000, '2026-09-16');
    h['2026-09-06'] = { orders: 20, charges: 20 * 1000 + 301100 };  // tallow COGS re-billed at cost that day
    h['2026-09-16'] = { orders: 10, charges: 0 };
    const r = fallbackEstimatesFromHistory(h, '2026-09-16');
    expect(r.avgPerOrderCents).toBe(1000);
    expect(r.estByDay['2026-09-16']).toBe(10000);
  });

  it('stays silent without enough billed history (unknown is not zero, but it is not invented either)', () => {
    const h = history(3, 10, 1000, '2026-09-16');
    h['2026-09-16'] = { orders: 10, charges: 0 };
    const r = fallbackEstimatesFromHistory(h, '2026-09-16');
    expect(r.avgPerOrderCents).toBeNull();
    expect(Object.keys(r.estByDay)).toHaveLength(0);
  });

  it('the trailing window excludes the recent days themselves, so under-billed recent days do not drag the rate down', () => {
    const h = history(20, 20, 1000, '2026-09-16');
    for (const d of ['2026-09-16', '2026-09-15', '2026-09-14']) h[d] = { orders: 20, charges: 0 };
    const r = fallbackEstimatesFromHistory(h, '2026-09-16');
    expect(r.avgPerOrderCents).toBe(1000);
    expect(r.estByDay['2026-09-15']).toBe(20000);
    expect(r.estByDay['2026-09-14']).toBeUndefined();
  });
});
