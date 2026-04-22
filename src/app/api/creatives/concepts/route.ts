import { requireStoreAccess } from '@/lib/auth-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/creatives/concepts?storeId=...
 *
 * Winning Concept Detection + Creative Fatigue Prediction
 *
 * Groups ads by concept (ad_name prefix), scores each concept,
 * detects fatigue signals, and classifies for action.
 */
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;

  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  const db = getDb();

  // ── Get baseline metrics for this store (last 30 days with spend) ──
  const baseline: any = db.prepare(`
    SELECT
      AVG(CASE WHEN ctr > 0 THEN ctr ELSE NULL END) as avgCtr,
      AVG(CASE WHEN roas > 0 THEN roas ELSE NULL END) as avgRoas,
      AVG(CASE WHEN spend_cents > 0 AND purchases > 0 THEN CAST(spend_cents AS REAL) / purchases ELSE NULL END) as avgCpaCents,
      SUM(spend_cents) as totalSpend
    FROM ad_spend
    WHERE store_id = ? AND date >= date('now', '-30 days') AND spend_cents > 0
  `).get(storeId);

  const baselineCtr = baseline?.avgCtr || 1.5;
  const baselineRoas = baseline?.avgRoas || 1.0;
  const baselineCpa = (baseline?.avgCpaCents || 5000) / 100;

  // ── Get per-ad aggregated metrics (last 30 days, spend > $5) ──
  const ads: any[] = db.prepare(`
    SELECT
      ad_id, ad_name, creative_url,
      SUM(spend_cents) as spend_cents,
      SUM(impressions) as impressions,
      SUM(clicks) as clicks,
      SUM(purchases) as purchases,
      SUM(purchase_value_cents) as revenue_cents,
      AVG(CASE WHEN frequency > 0 THEN frequency ELSE NULL END) as avg_frequency,
      AVG(CASE WHEN ctr > 0 THEN ctr ELSE NULL END) as avg_ctr,
      AVG(CASE WHEN roas > 0 THEN roas ELSE NULL END) as avg_roas,
      COUNT(DISTINCT date) as active_days,
      MIN(date) as first_seen,
      MAX(date) as last_seen
    FROM ad_spend
    WHERE store_id = ? AND date >= date('now', '-30 days') AND spend_cents > 500 AND ad_id IS NOT NULL
    GROUP BY ad_id
    HAVING SUM(spend_cents) > 500
    ORDER BY SUM(spend_cents) DESC
  `).all(storeId);

  // ── Group ads into concepts (by ad_name prefix before " - V" or variant number) ──
  const conceptMap = new Map<string, any[]>();
  for (const ad of ads) {
    const name = ad.ad_name || ad.ad_id || 'Unknown';
    // Extract concept name: strip variant suffixes like " - V1", " V2", " (2)", " #3"
    const conceptName = name
      .replace(/\s*[-–]\s*V\d+.*$/i, '')
      .replace(/\s*V\d+$/i, '')
      .replace(/\s*\(\d+\)$/i, '')
      .replace(/\s*#\d+$/i, '')
      .replace(/\s*variant\s*\d+$/i, '')
      .trim() || name;

    if (!conceptMap.has(conceptName)) conceptMap.set(conceptName, []);
    conceptMap.get(conceptName)!.push(ad);
  }

  // ── Score each concept ──
  const concepts: any[] = [];
  for (const [name, conceptAds] of conceptMap) {
    const totalSpend = conceptAds.reduce((s, a) => s + (a.spend_cents || 0), 0) / 100;
    const totalImpressions = conceptAds.reduce((s, a) => s + (a.impressions || 0), 0);
    const totalClicks = conceptAds.reduce((s, a) => s + (a.clicks || 0), 0);
    const totalPurchases = conceptAds.reduce((s, a) => s + (a.purchases || 0), 0);
    const totalRevenue = conceptAds.reduce((s, a) => s + (a.revenue_cents || 0), 0) / 100;
    const avgCtr = conceptAds.reduce((s, a) => s + (a.avg_ctr || 0), 0) / conceptAds.length;
    const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const cpa = totalPurchases > 0 ? totalSpend / totalPurchases : 999;
    const avgFrequency = conceptAds.reduce((s, a) => s + (a.avg_frequency || 0), 0) / conceptAds.length;
    const variations = conceptAds.length;
    const activeDays = Math.max(...conceptAds.map(a => a.active_days || 0));

    // ── CONCEPT SCORE (0-10) ──
    const ctrScore = Math.min(3, (avgCtr / baselineCtr) * 1.5);          // 0-3 points
    const roasScore = Math.min(3, (avgRoas / baselineRoas) * 1.5);       // 0-3 points
    const cpaScore = Math.min(2, baselineCpa > 0 ? (baselineCpa / Math.max(cpa, 0.01)) * 1 : 0); // 0-2 points (inverse)
    const spendConfidence = Math.min(2, totalSpend / 50);                 // 0-2 points ($0-$50 maps to 0-2)
    const score = Math.round((ctrScore + roasScore + cpaScore + spendConfidence) * 10) / 10;

    // ── CLASSIFICATION ──
    let status: 'scale' | 'test' | 'kill';
    if (score >= 8) status = 'scale';
    else if (score >= 5) status = 'test';
    else status = 'kill';

    // ── FATIGUE DETECTION ──
    // Get last 7 days of daily CTR for this concept's ads
    const recentDays: any[] = db.prepare(`
      SELECT date, AVG(ctr) as daily_ctr, AVG(frequency) as daily_freq
      FROM ad_spend
      WHERE store_id = ? AND ad_id IN (${conceptAds.map(() => '?').join(',')})
        AND date >= date('now', '-7 days') AND spend_cents > 0
      GROUP BY date ORDER BY date
    `).all(storeId, ...conceptAds.map(a => a.ad_id));

    let fatigueScore = 0;
    let fatigueSignals: string[] = [];

    if (recentDays.length >= 3) {
      // CTR trend: compare last 2 days vs first 2 days
      const early = recentDays.slice(0, 2).reduce((s, d) => s + d.daily_ctr, 0) / 2;
      const late = recentDays.slice(-2).reduce((s, d) => s + d.daily_ctr, 0) / 2;
      if (early > 0) {
        const ctrDrop = ((early - late) / early) * 100;
        if (ctrDrop > 25) { fatigueScore += 4; fatigueSignals.push(`CTR dropped ${Math.round(ctrDrop)}%`); }
        else if (ctrDrop > 15) { fatigueScore += 2; fatigueSignals.push(`CTR dropped ${Math.round(ctrDrop)}%`); }
      }
    }

    // Frequency fatigue
    if (avgFrequency > 3.0) { fatigueScore += 4; fatigueSignals.push(`Frequency ${avgFrequency.toFixed(1)}`); }
    else if (avgFrequency > 2.2) { fatigueScore += 2; fatigueSignals.push(`Frequency ${avgFrequency.toFixed(1)}`); }

    // CPA increase (compare to baseline)
    if (cpa > baselineCpa * 1.3) { fatigueScore += 2; fatigueSignals.push(`CPA $${cpa.toFixed(0)} vs baseline $${baselineCpa.toFixed(0)}`); }

    fatigueScore = Math.min(10, fatigueScore);
    let fatigueStatus: 'healthy' | 'watch' | 'fatiguing';
    if (fatigueScore >= 7) fatigueStatus = 'fatiguing';
    else if (fatigueScore >= 4) fatigueStatus = 'watch';
    else fatigueStatus = 'healthy';

    concepts.push({
      name,
      variations,
      activeDays,
      metrics: {
        spend: Math.round(totalSpend * 100) / 100,
        impressions: totalImpressions,
        clicks: totalClicks,
        purchases: totalPurchases,
        revenue: Math.round(totalRevenue * 100) / 100,
        ctr: Math.round(avgCtr * 100) / 100,
        roas: Math.round(avgRoas * 100) / 100,
        cpa: Math.round(cpa * 100) / 100,
        frequency: Math.round(avgFrequency * 100) / 100,
      },
      score: Math.min(10, score),
      status,
      fatigue: {
        score: fatigueScore,
        status: fatigueStatus,
        signals: fatigueSignals,
      },
      ads: conceptAds.map(a => ({
        id: a.ad_id,
        name: a.ad_name,
        creativeUrl: a.creative_url,
        spend: (a.spend_cents || 0) / 100,
        ctr: a.avg_ctr,
        roas: a.avg_roas,
      })),
    });
  }

  // Sort by score descending
  concepts.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    concepts,
    baseline: {
      ctr: Math.round(baselineCtr * 100) / 100,
      roas: Math.round(baselineRoas * 100) / 100,
      cpa: Math.round(baselineCpa * 100) / 100,
    },
    totalConcepts: concepts.length,
    scaleCount: concepts.filter(c => c.status === 'scale').length,
    testCount: concepts.filter(c => c.status === 'test').length,
    killCount: concepts.filter(c => c.status === 'kill').length,
    fatiguingCount: concepts.filter(c => c.fatigue.status === 'fatiguing').length,
  });
}
