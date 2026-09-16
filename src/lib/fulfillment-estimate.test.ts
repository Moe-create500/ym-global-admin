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
    h['2026-09-15'] = { orders: 26, charges: 9800 };          // 10 of 26 shipped
    const r = fallbackEstimatesFromHistory(h, '2026-09-16');
    expect(r.avgPerOrderCents).toBe(1377);
    expect(r.estByDay['2026-09-16']).toBe(18 * 1377);
    expect(r.estByDay['2026-09-15']).toBe(26 * 1377 - 9800);
  });

  it('never tops up a day that is already billed at the average, and ignores days older than the recent window', () => {
    const h = history(20, 20, 1377, '2026-09-16');
    h['2026-09-14'] = { orders: 20, charges: 20 * 1377 - 300 };   // rounding noise, not a missing order
    h['2026-09-05'] = { orders: 20, charges: 0 };                 // old day with no charges is a data gap, not "unshipped"
    const r = fallbackEstimatesFromHistory(h, '2026-09-16');
    expect(r.estByDay['2026-09-14']).toBeUndefined();
    expect(r.estByDay['2026-09-05']).toBeUndefined();
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
    for (const d of ['2026-09-16', '2026-09-15', '2026-09-14', '2026-09-13']) h[d] = { orders: 20, charges: 0 };
    const r = fallbackEstimatesFromHistory(h, '2026-09-16');
    expect(r.avgPerOrderCents).toBe(1000);
    expect(r.estByDay['2026-09-13']).toBe(20000);
  });
});
