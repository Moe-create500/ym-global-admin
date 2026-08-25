import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProductPerformance, getActiveTests, backfillLaunches } from '@/lib/product-performance';
import { brainCached } from '@/lib/brain-cache';

export const dynamic = 'force-dynamic';

// Live FB truth for "is it still running": effective_status per campaign,
// batched per store token. Failure degrades to spend-recency (never blocks).
async function fetchCampaignStatuses(db: any, tests: any[]): Promise<Record<string, string>> {
  const byStore = new Map<string, Set<string>>();
  for (const t of tests) {
    if (!t.campaign_ids?.length) continue;
    if (!byStore.has(t.store_id)) byStore.set(t.store_id, new Set());
    for (const id of t.campaign_ids) byStore.get(t.store_id)!.add(id);
  }
  const out: Record<string, string> = {};
  for (const [storeId, ids] of byStore) {
    const prof: any = db.prepare(
      "SELECT access_token FROM fb_profiles WHERE store_id = ? AND is_active = 1 AND access_token IS NOT NULL LIMIT 1"
    ).get(storeId);
    if (!prof?.access_token) continue;
    const list = [...ids].slice(0, 50);
    try {
      const r: any = await fetch(
        `https://graph.facebook.com/v24.0/?ids=${list.join(',')}&fields=effective_status&access_token=${encodeURIComponent(prof.access_token)}`,
        { signal: AbortSignal.timeout(8000) }
      ).then(x => x.json());
      for (const id of list) {
        const st = r?.[id]?.effective_status;
        if (st) out[id] = st;
      }
    } catch { /* degrade to spend recency */ }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const storeId = sp.get('storeId') || undefined;
  const days = Number(sp.get('days')) || 30;

  const base = brainCached(`products:${storeId || 'all'}:${days}`, () => {
    backfillLaunches(db);
    const perf = getProductPerformance(db, { storeId, days });
    const yesterday = getProductPerformance(db, { storeId, days: 2 });
    const tests = getActiveTests(db);
    const topByStore: Record<string, any> = {};
    for (const p of yesterday.products) {
      if (!p.store_id || p.revenue_cents <= 0) continue;
      if (!topByStore[p.store_id] || p.revenue_cents > topByStore[p.store_id].revenue_cents) {
        topByStore[p.store_id] = { title: p.title, revenue_cents: p.revenue_cents, units: p.units, roas: p.roas };
      }
    }
    return { leaderboard: perf.products.slice(0, 40), unattributedSpendCents: perf.unattributedSpendCents, tests: tests.tests, thresholds: tests.thresholds, topByStore };
  });

  // Enrich with LIVE campaign status (cached 60s alongside the payload)
  const statuses = await brainCached(`products:fbstatus:${storeId || 'all'}`, () => fetchCampaignStatuses(db, base.tests || []));
  const tests = (base.tests || []).map((t: any) => {
    const sts = (t.campaign_ids || []).map((id: string) => statuses[id]).filter(Boolean);
    const liveKnown = sts.length > 0;
    const liveRunning = sts.some((x: string) => x === 'ACTIVE');
    const running = liveKnown ? liveRunning : t.running_by_spend;
    let verdict = t.verdict;
    let why = t.why;
    // live status outranks spend recency in BOTH directions
    if (liveKnown && !liveRunning && verdict === 'kill_candidate') { verdict = 'stopped'; why = `${t.why} — campaigns ${sts.join('/').toLowerCase()} on Facebook`; }
    if (liveKnown && liveRunning && verdict === 'stopped') { verdict = 'kill_candidate'; why = `${t.why.split(' — ')[0]} — campaign ACTIVE on Facebook, still eligible to spend`; }
    return { ...t, running, running_source: liveKnown ? 'facebook' : 'spend_recency', campaign_statuses: sts, verdict, why };
  });
  return NextResponse.json({ ...base, tests });
}
