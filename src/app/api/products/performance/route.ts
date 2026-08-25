import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProductPerformance, getActiveTests, backfillLaunches } from '@/lib/product-performance';
import { brainCached } from '@/lib/brain-cache';

export const dynamic = 'force-dynamic';

// Product-level truth for the dashboard: leaderboard, per-store top products,
// and the active-test tracker fed by the Launch Flow registry.
export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const storeId = sp.get('storeId') || undefined;
  const days = Number(sp.get('days')) || 30;

  const payload = brainCached(`products:${storeId || 'all'}:${days}`, () => {
    backfillLaunches(db);
    const perf = getProductPerformance(db, { storeId, days });
    const yesterday = getProductPerformance(db, { storeId, days: 2 });
    const tests = getActiveTests(db);
    // per-store top product (yesterday window) for the store cards
    const topByStore: Record<string, any> = {};
    for (const p of yesterday.products) {
      if (!p.store_id || p.revenue_cents <= 0) continue;
      if (!topByStore[p.store_id] || p.revenue_cents > topByStore[p.store_id].revenue_cents) {
        topByStore[p.store_id] = { title: p.title, revenue_cents: p.revenue_cents, units: p.units, roas: p.roas };
      }
    }
    return { leaderboard: perf.products.slice(0, 40), unattributedSpendCents: perf.unattributedSpendCents, tests: tests.tests, thresholds: tests.thresholds, topByStore };
  });
  return NextResponse.json(payload);
}
