import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/creatives/intelligence?storeId=...
 *
 * Metric-driven account intelligence engine.
 * All rankings are based on real ad_spend performance data — no keyword matching.
 */
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  const db = getDb();

  // ── Core ad query: aggregate per-ad metrics (all time with spend > $50) ──
  const ads: any[] = db.prepare(`
    SELECT ad_id, ad_name, ad_headline, ad_body, ad_cta, creative_url, fb_video_id,
      SUM(spend_cents) as spend, SUM(impressions) as impressions,
      SUM(clicks) as clicks, SUM(purchases) as purchases,
      SUM(purchase_value_cents) as revenue,
      CASE WHEN SUM(spend_cents) > 0 THEN ROUND(CAST(SUM(purchase_value_cents) AS REAL) / SUM(spend_cents), 2) ELSE 0 END as roas,
      CASE WHEN SUM(impressions) > 0 THEN ROUND(CAST(SUM(clicks) AS REAL) / SUM(impressions) * 100, 2) ELSE 0 END as ctr,
      CASE WHEN SUM(purchases) > 0 THEN ROUND(CAST(SUM(spend_cents) AS REAL) / SUM(purchases) / 100, 2) ELSE 0 END as cpa,
      CASE WHEN SUM(clicks) > 0 THEN ROUND(CAST(SUM(purchases) AS REAL) / SUM(clicks) * 100, 2) ELSE 0 END as cvr
    FROM ad_spend
    WHERE store_id = ? AND ad_id IS NOT NULL AND spend_cents > 5000
    GROUP BY ad_id
    ORDER BY spend DESC
  `).all(storeId);

  if (ads.length === 0) {
    return NextResponse.json({ intelligence: null, message: 'No ad data with sufficient spend' });
  }

  // ── Time-windowed queries for trend detection ──
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const d14 = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);

  const recent7d: any[] = db.prepare(`
    SELECT ad_id,
      SUM(spend_cents) as spend, SUM(impressions) as impressions,
      SUM(clicks) as clicks, SUM(purchases) as purchases,
      SUM(purchase_value_cents) as revenue,
      CASE WHEN SUM(spend_cents) > 0 THEN ROUND(CAST(SUM(purchase_value_cents) AS REAL) / SUM(spend_cents), 2) ELSE 0 END as roas,
      CASE WHEN SUM(impressions) > 0 THEN ROUND(CAST(SUM(clicks) AS REAL) / SUM(impressions) * 100, 2) ELSE 0 END as ctr
    FROM ad_spend
    WHERE store_id = ? AND ad_id IS NOT NULL AND date >= ?
    GROUP BY ad_id HAVING spend > 0
  `).all(storeId, d7);

  const prev7d: any[] = db.prepare(`
    SELECT ad_id,
      SUM(spend_cents) as spend, SUM(impressions) as impressions,
      SUM(clicks) as clicks, SUM(purchases) as purchases,
      SUM(purchase_value_cents) as revenue,
      CASE WHEN SUM(spend_cents) > 0 THEN ROUND(CAST(SUM(purchase_value_cents) AS REAL) / SUM(spend_cents), 2) ELSE 0 END as roas,
      CASE WHEN SUM(impressions) > 0 THEN ROUND(CAST(SUM(clicks) AS REAL) / SUM(impressions) * 100, 2) ELSE 0 END as ctr
    FROM ad_spend
    WHERE store_id = ? AND ad_id IS NOT NULL AND date >= ? AND date < ?
    GROUP BY ad_id HAVING spend > 0
  `).all(storeId, d14, d7);

  const recentMap = new Map(recent7d.map(a => [a.ad_id, a]));
  const prevMap = new Map(prev7d.map(a => [a.ad_id, a]));

  // ── Product performance ──
  const productPerf: any[] = db.prepare(`
    SELECT p.id as product_id, p.title as product_name, p.image_url,
      SUM(a.spend_cents) as spend, SUM(a.purchases) as purchases,
      SUM(a.purchase_value_cents) as revenue,
      CASE WHEN SUM(a.spend_cents) > 0 THEN ROUND(CAST(SUM(a.purchase_value_cents) AS REAL) / SUM(a.spend_cents), 2) ELSE 0 END as roas
    FROM ad_spend a
    JOIN creatives c ON c.store_id = a.store_id
    JOIN products p ON p.id = c.product_id
    WHERE a.store_id = ? AND a.spend_cents > 0
    GROUP BY p.id
    ORDER BY roas DESC LIMIT 10
  `).all(storeId);

  // ── Build ranked lists (pure metrics, no keyword matching) ──

  const withPurchases = ads.filter(a => a.purchases > 0);

  // Top hooks by CTR — ranked by click-through rate, min 1000 impressions
  const topHooksByCTR = ads
    .filter(a => a.impressions > 1000 && a.ad_headline && a.ad_headline.length > 3)
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 8)
    .map(a => ({
      adId: a.ad_id, name: a.ad_name, hook: a.ad_headline,
      ctr: a.ctr, roas: a.roas, impressions: a.impressions, spend: a.spend,
    }));

  // Top creatives by ROAS — ranked by return on ad spend, min $50 spend + 1 purchase
  const topCreativesByROAS = withPurchases
    .sort((a, b) => b.roas - a.roas)
    .slice(0, 8)
    .map(a => ({
      adId: a.ad_id, name: a.ad_name, headline: a.ad_headline,
      roas: a.roas, spend: a.spend, purchases: a.purchases, revenue: a.revenue,
      thumbnail: a.creative_url, hasVideo: !!a.fb_video_id,
    }));

  // Top converters by CVR — ranked by conversion rate, min 500 clicks
  const topConvertersByCVR = ads
    .filter(a => a.clicks > 500 && a.purchases > 0)
    .sort((a, b) => b.cvr - a.cvr)
    .slice(0, 8)
    .map(a => ({
      adId: a.ad_id, name: a.ad_name, headline: a.ad_headline,
      cvr: a.cvr, purchases: a.purchases, clicks: a.clicks, roas: a.roas,
    }));

  // Most efficient by CPA — ranked by cost per acquisition (lowest), min 3 purchases
  const mostEfficientByCPA = withPurchases
    .filter(a => a.purchases >= 3)
    .sort((a, b) => a.cpa - b.cpa)
    .slice(0, 8)
    .map(a => ({
      adId: a.ad_id, name: a.ad_name, headline: a.ad_headline,
      cpa: a.cpa, purchases: a.purchases, spend: a.spend, roas: a.roas,
    }));

  // Scaling winners — highest spend + profitable (ROAS > 1)
  const scalingWinnersBySpend = withPurchases
    .filter(a => a.roas >= 1)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8)
    .map(a => ({
      adId: a.ad_id, name: a.ad_name, headline: a.ad_headline,
      spend: a.spend, roas: a.roas, purchases: a.purchases, revenue: a.revenue,
    }));

  // ── Trend detection: last 7d vs previous 7d ──

  const rising: any[] = [];
  const declining: any[] = [];
  const fatigued: any[] = [];

  for (const [adId, recent] of recentMap) {
    const prev = prevMap.get(adId);
    const adInfo = ads.find(a => a.ad_id === adId);
    const name = adInfo?.ad_name || adId;

    if (prev && prev.spend > 1000) {
      const roasChange = recent.roas - prev.roas;
      const ctrChange = recent.ctr - prev.ctr;

      if (roasChange > 0.3 && recent.roas > 1) {
        rising.push({ adId, name, recentRoas: recent.roas, prevRoas: prev.roas, change: +roasChange.toFixed(2) });
      }
      if (roasChange < -0.5 && prev.roas > 1) {
        declining.push({ adId, name, recentRoas: recent.roas, prevRoas: prev.roas, change: +roasChange.toFixed(2) });
      }
      // Fatigue: 20% performance decay rule — refresh hook when metrics drop 20% from previous period
      const roasDecayPct = prev.roas > 0 ? ((prev.roas - recent.roas) / prev.roas) * 100 : 0;
      const ctrDecayPct = prev.ctr > 0 ? ((prev.ctr - recent.ctr) / prev.ctr) * 100 : 0;
      if (recent.spend >= prev.spend * 0.8 && (roasDecayPct >= 20 || ctrDecayPct >= 20)) {
        fatigued.push({ adId, name, recentRoas: recent.roas, prevRoas: prev.roas, recentCtr: recent.ctr, prevCtr: prev.ctr, roasDecayPct: +roasDecayPct.toFixed(0), ctrDecayPct: +ctrDecayPct.toFixed(0) });
      }
    } else if (!prev && recent.purchases > 0 && recent.roas > 1) {
      // New ad with purchases — rising
      rising.push({ adId, name, recentRoas: recent.roas, prevRoas: 0, change: recent.roas });
    }
  }

  // Also detect fatigue from all-time data: high cumulative spend + low recent ROAS
  for (const ad of ads) {
    if (ad.spend > 20000) { // >$200 total spend
      const recent = recentMap.get(ad.ad_id);
      if (recent && recent.roas < 0.7 && ad.roas > 1) {
        const already = fatigued.find(f => f.adId === ad.ad_id);
        if (!already) {
          fatigued.push({ adId: ad.ad_id, name: ad.ad_name, recentRoas: recent.roas, prevRoas: ad.roas, recentCtr: recent.ctr, prevCtr: ad.ctr });
        }
      }
    }
  }

  rising.sort((a, b) => b.change - a.change);
  declining.sort((a, b) => a.change - b.change);

  // ── Scaling signals: ads with increasing spend AND maintaining/improving ROAS ──
  const scalingSignals: any[] = [];
  for (const [adId, recent] of recentMap) {
    const prev = prevMap.get(adId);
    if (prev && recent.spend > prev.spend * 1.2 && recent.roas >= prev.roas * 0.9 && recent.roas > 1) {
      const adInfo = ads.find(a => a.ad_id === adId);
      scalingSignals.push({
        adId, name: adInfo?.ad_name || adId,
        spendIncrease: +((recent.spend / prev.spend - 1) * 100).toFixed(0),
        recentRoas: recent.roas, purchases: recent.purchases,
      });
    }
  }
  scalingSignals.sort((a, b) => b.spendIncrease - a.spendIncrease);

  // ── Aggregate metrics ──
  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
  const totalPurchases = ads.reduce((s, a) => s + a.purchases, 0);
  const totalRevenue = ads.reduce((s, a) => s + a.revenue, 0);
  const avgRoas = totalSpend > 0 ? +(totalRevenue / totalSpend).toFixed(2) : 0;
  const avgCtr = ads.length > 0 ? +(ads.reduce((s, a) => s + a.ctr, 0) / ads.length).toFixed(2) : 0;
  const avgCpa = totalPurchases > 0 ? +(totalSpend / totalPurchases / 100).toFixed(2) : 0;
  const avgCvr = ads.filter(a => a.clicks > 0).length > 0
    ? +(ads.filter(a => a.clicks > 0).reduce((s, a) => s + a.cvr, 0) / ads.filter(a => a.clicks > 0).length).toFixed(2) : 0;

  // ── Recommendations (metric-driven, no guessing) ──
  const bestROASAd = topCreativesByROAS[0];
  const bestCTRAd = topHooksByCTR[0];
  const bestCPAAd = mostEfficientByCPA[0];

  const hasVideo = ads.some(a => a.fb_video_id);
  const videoAds = ads.filter(a => a.fb_video_id);
  const imageAds = ads.filter(a => !a.fb_video_id);
  const videoAvgRoas = videoAds.length > 0 ? +(videoAds.reduce((s, a) => s + a.roas, 0) / videoAds.length).toFixed(2) : 0;
  const imageAvgRoas = imageAds.length > 0 ? +(imageAds.reduce((s, a) => s + a.roas, 0) / imageAds.length).toFixed(2) : 0;

  const recommendedContentType = videoAvgRoas >= imageAvgRoas && hasVideo ? 'video' : 'image';
  const recommendedFunnel = fatigued.length > 2 ? 'tof' : avgRoas > 2 ? 'bof' : avgRoas > 1 ? 'mof' : 'tof';
  const recommendedHook = bestCTRAd ? 'aggressive' : 'curiosity';

  const confidence = Math.min(95, Math.round(
    15 + Math.min(ads.length, 30) * 1.5 + withPurchases.length * 2 + rising.length * 3
  ));

  const reasons: string[] = [];
  if (bestROASAd) reasons.push(`Best ROAS: "${bestROASAd.name}" at ${bestROASAd.roas}x (${bestROASAd.purchases} purchases)`);
  if (bestCTRAd) reasons.push(`Best CTR: "${bestCTRAd.hook}" at ${bestCTRAd.ctr}%`);
  if (bestCPAAd) reasons.push(`Best CPA: "${bestCPAAd.name}" at $${bestCPAAd.cpa}`);
  if (fatigued.length > 0) reasons.push(`${fatigued.length} ad(s) showing fatigue — fresh angles needed`);
  if (rising.length > 0) reasons.push(`${rising.length} ad(s) gaining momentum — double down`);
  if (videoAvgRoas > imageAvgRoas) reasons.push(`Video ads avg ${videoAvgRoas}x ROAS vs image ${imageAvgRoas}x`);
  else if (imageAvgRoas > videoAvgRoas) reasons.push(`Image ads avg ${imageAvgRoas}x ROAS vs video ${videoAvgRoas}x`);

  // ── Learned Patterns: feedback loop from generated packages → ad performance ──
  // Wrapped in try/catch — creative_packages table may not exist on older deployments
  let learnedPatterns: any = { whatWorks: [], whatDoesnt: [], patternScores: [], totalTracked: 0, totalWithPerformance: 0 };
  try {
  const packagePerformance: any[] = db.prepare(`
    SELECT
      cp.id as package_id,
      cp.creative_type,
      cp.funnel_stage,
      cp.hook_style,
      cp.avatar_style,
      cp.content_type,
      cp.strategy,
      c.id as creative_id,
      c.title as creative_title,
      c.angle,
      c.package_index,
      c.nb_status,
      c.file_url
    FROM creative_packages cp
    JOIN creatives c ON c.package_id = cp.id
    WHERE cp.store_id = ? AND cp.status = 'completed'
    ORDER BY cp.created_at DESC
    LIMIT 100
  `).all(storeId);

  // Match generated creatives to ad_spend by looking for ads with same creative URL or title
  const winningPatterns: { creativeType: string; funnelStage: string; hookStyle: string; avatarStyle: string; roas: number; ctr: number; cpa: number; purchases: number; title: string }[] = [];
  const losingPatterns: { creativeType: string; funnelStage: string; hookStyle: string; avatarStyle: string; roas: number; spend: number; title: string }[] = [];

  // Also check if any generated creatives got linked to ad_spend via creative_url matching
  for (const pc of packagePerformance) {
    if (pc.nb_status !== 'completed' || !pc.file_url) continue;
    // Try to find ad performance for this creative
    const adPerf: any = db.prepare(`
      SELECT SUM(spend_cents) as spend, SUM(impressions) as impressions,
        SUM(clicks) as clicks, SUM(purchases) as purchases,
        SUM(purchase_value_cents) as revenue,
        CASE WHEN SUM(spend_cents) > 0 THEN ROUND(CAST(SUM(purchase_value_cents) AS REAL) / SUM(spend_cents), 2) ELSE 0 END as roas,
        CASE WHEN SUM(impressions) > 0 THEN ROUND(CAST(SUM(clicks) AS REAL) / SUM(impressions) * 100, 2) ELSE 0 END as ctr,
        CASE WHEN SUM(purchases) > 0 THEN ROUND(CAST(SUM(spend_cents) AS REAL) / SUM(purchases) / 100, 2) ELSE 0 END as cpa
      FROM ad_spend WHERE store_id = ? AND (creative_url = ? OR ad_name LIKE ?) AND spend_cents > 1000
    `).get(storeId, pc.file_url, `%${pc.creative_title?.substring(0, 30)}%`);

    if (adPerf && adPerf.spend > 0) {
      const entry = {
        creativeType: pc.creative_type, funnelStage: pc.funnel_stage,
        hookStyle: pc.hook_style, avatarStyle: pc.avatar_style,
        roas: adPerf.roas, ctr: adPerf.ctr, cpa: adPerf.cpa,
        purchases: adPerf.purchases, spend: adPerf.spend,
        title: pc.creative_title || 'Untitled',
      };
      if (adPerf.roas >= 1 && adPerf.purchases > 0) {
        winningPatterns.push(entry);
      } else if (adPerf.spend > 5000 && adPerf.roas < 0.8) {
        losingPatterns.push(entry);
      }
    }
  }

  // Aggregate patterns by creative type + funnel stage
  const patternMap = new Map<string, { wins: number; losses: number; totalRoas: number; totalCtr: number; count: number }>();
  for (const w of winningPatterns) {
    const key = `${w.creativeType}|${w.funnelStage}|${w.hookStyle}`;
    const prev = patternMap.get(key) || { wins: 0, losses: 0, totalRoas: 0, totalCtr: 0, count: 0 };
    patternMap.set(key, { wins: prev.wins + 1, losses: prev.losses, totalRoas: prev.totalRoas + w.roas, totalCtr: prev.totalCtr + w.ctr, count: prev.count + 1 });
  }
  for (const l of losingPatterns) {
    const key = `${l.creativeType}|${l.funnelStage}|${l.hookStyle}`;
    const prev = patternMap.get(key) || { wins: 0, losses: 0, totalRoas: 0, totalCtr: 0, count: 0 };
    patternMap.set(key, { wins: prev.wins, losses: prev.losses + 1, totalRoas: prev.totalRoas + l.roas, totalCtr: prev.totalCtr, count: prev.count + 1 });
  }

  learnedPatterns = {
    whatWorks: winningPatterns
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 5)
      .map(w => ({
        pattern: `${w.creativeType} + ${w.funnelStage} + ${w.hookStyle}`,
        title: w.title, roas: w.roas, ctr: w.ctr, cpa: w.cpa, purchases: w.purchases,
      })),
    whatDoesnt: losingPatterns
      .sort((a, b) => a.roas - b.roas)
      .slice(0, 5)
      .map(l => ({
        pattern: `${l.creativeType} + ${l.funnelStage} + ${l.hookStyle}`,
        title: l.title, roas: l.roas, spendCents: l.spend,
      })),
    patternScores: [...patternMap.entries()]
      .map(([key, v]) => {
        const [creativeType, funnelStage, hookStyle] = key.split('|');
        const winRate = v.count > 0 ? Math.round((v.wins / v.count) * 100) : 0;
        return {
          creativeType, funnelStage, hookStyle,
          winRate, wins: v.wins, losses: v.losses, total: v.count,
          avgRoas: v.count > 0 ? +(v.totalRoas / v.count).toFixed(2) : 0,
          confidence: Math.min(95, v.count * 20),
        };
      })
      .sort((a, b) => b.winRate - a.winRate),
    totalTracked: packagePerformance.length,
    totalWithPerformance: winningPatterns.length + losingPatterns.length,
  };
  } catch {
    // creative_packages table may not exist yet — learnedPatterns stays empty
  }

  const intelligence = {
    // Aggregate metrics
    metrics: {
      totalAds: ads.length, adsWithPurchases: withPurchases.length,
      totalSpendCents: totalSpend, totalPurchases, totalRevenueCents: totalRevenue,
      avgRoas, avgCtr, avgCpa, avgCvr,
    },
    // Ranked winners (pure metric-driven)
    winners: {
      topHooksByCTR: topHooksByCTR.slice(0, 5),
      topCreativesByROAS: topCreativesByROAS.slice(0, 5),
      topConvertersByCVR: topConvertersByCVR.slice(0, 5),
      mostEfficientByCPA: mostEfficientByCPA.slice(0, 5),
      scalingWinnersBySpend: scalingWinnersBySpend.slice(0, 5),
    },
    // Time-based trends (7d vs 7d)
    trends: {
      rising: rising.slice(0, 5),
      declining: declining.slice(0, 5),
      fatigueSignals: fatigued.slice(0, 5),
      scalingSignals: scalingSignals.slice(0, 5),
    },
    // Product performance
    productPerformance: productPerf.slice(0, 5).map(p => ({
      productId: p.product_id, name: p.product_name, imageUrl: p.image_url,
      roas: p.roas, purchases: p.purchases, spendCents: p.spend,
    })),
    // Recommendations (data-driven)
    recommendations: {
      contentType: recommendedContentType,
      funnelStage: recommendedFunnel,
      hookStyle: recommendedHook,
      confidence,
      reasons,
    },
    // Learned patterns from feedback loop
    learnedPatterns,
    // Full ranked lists for the prompt engine
    _forPrompt: {
      topAds: ads.filter(a => a.purchases > 0).sort((a, b) => b.roas - a.roas).slice(0, 10).map(a => ({
        name: a.ad_name, headline: a.ad_headline, body: a.ad_body?.substring(0, 300),
        cta: a.ad_cta, roas: a.roas, ctr: a.ctr, cpa: a.cpa, purchases: a.purchases,
      })),
      fatiguedNames: fatigued.map(f => f.name),
      learnedWins: learnedPatterns.whatWorks.map((w: any) => `${w.pattern}: "${w.title}" — ${w.roas}x ROAS, ${w.purchases} purchases`),
      learnedLosses: learnedPatterns.whatDoesnt.map((l: any) => `${l.pattern}: "${l.title}" — ${l.roas}x ROAS, wasted $${(l.spendCents / 100).toFixed(0)}`),
    },
  };

  return NextResponse.json({ intelligence });
}
