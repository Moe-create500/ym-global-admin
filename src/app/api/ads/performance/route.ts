import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  const pacificDate = (d?: number) => (d ? new Date(d) : new Date()).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const from = searchParams.get('from') || pacificDate(Date.now() - 14 * 86400000);
  const to = searchParams.get('to') || pacificDate();
  const sortBy = searchParams.get('sortBy') || 'spend';

  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  const db = getDb();

  // Get all ad-level rows aggregated for the date range, including creative context
  const rows: any[] = db.prepare(`
    SELECT
      ad_set_id, ad_set_name, campaign_id, campaign_name,
      ad_id, ad_name, creative_url, ad_headline, ad_body, ad_cta,
      ad_link_url, ad_preview_url, ad_status,
      MAX(fb_video_id) as fb_video_id, MAX(video_source_url) as video_source_url,
      MAX(video_analysis) as video_analysis,
      SUM(spend_cents) as spend,
      SUM(impressions) as impressions,
      SUM(clicks) as clicks,
      SUM(COALESCE(purchases, 0)) as purchases,
      SUM(COALESCE(purchase_value_cents, 0)) as purchase_value,
      SUM(COALESCE(reach, 0)) as reach,
      CASE WHEN SUM(impressions) > 0
        THEN ROUND(CAST(SUM(clicks) AS REAL) / SUM(impressions) * 100, 2)
        ELSE 0 END as ctr,
      CASE WHEN SUM(clicks) > 0
        THEN ROUND(CAST(SUM(spend_cents) AS REAL) / SUM(clicks), 0)
        ELSE 0 END as cpc,
      CASE WHEN SUM(impressions) > 0
        THEN ROUND(CAST(SUM(spend_cents) AS REAL) / SUM(impressions) * 1000, 0)
        ELSE 0 END as cpm
    FROM ad_spend
    WHERE store_id = ? AND date >= ? AND date <= ? AND platform = 'facebook'
      AND ad_set_id IS NOT NULL
    GROUP BY ad_set_id, ad_id
    ORDER BY spend DESC
  `).all(storeId, from, to);

  // Group by ad set
  const adSetMap: Record<string, {
    adSetId: string;
    adSetName: string;
    campaignId: string;
    campaignName: string;
    totalSpend: number;
    totalImpressions: number;
    totalClicks: number;
    totalPurchases: number;
    totalPurchaseValue: number;
    totalReach: number;
    roas: number;
    cpa: number;
    ctr: number;
    ads: any[];
  }> = {};

  for (const row of rows) {
    const setId = row.ad_set_id;
    if (!adSetMap[setId]) {
      adSetMap[setId] = {
        adSetId: setId,
        adSetName: row.ad_set_name || 'Unknown',
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalPurchases: 0,
        totalPurchaseValue: 0,
        totalReach: 0,
        roas: 0,
        cpa: 0,
        ctr: 0,
        ads: [],
      };
    }

    const set = adSetMap[setId];
    const spend = Number(row.spend || 0);
    const purchases = Number(row.purchases || 0);
    const purchaseValue = Number(row.purchase_value || 0);
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);

    set.totalSpend += spend;
    set.totalImpressions += impressions;
    set.totalClicks += clicks;
    set.totalPurchases += purchases;
    set.totalPurchaseValue += purchaseValue;
    set.totalReach += Number(row.reach || 0);

    if (row.ad_id) {
      const adRoas = spend > 0 ? purchaseValue / spend : 0;
      set.ads.push({
        adId: row.ad_id,
        adName: row.ad_name || 'Unknown',
        status: row.ad_status || null,
        // Creative context
        creativeUrl: row.creative_url || null,
        headline: row.ad_headline || null,
        body: row.ad_body || null,
        cta: row.ad_cta || null,
        linkUrl: row.ad_link_url || null,
        previewUrl: row.ad_preview_url || null,
        fbVideoId: row.fb_video_id || null,
        videoSourceUrl: row.video_source_url || null,
        videoAnalysis: row.video_analysis || null,
        // Metrics
        spend,
        impressions,
        clicks,
        purchases,
        purchaseValue,
        reach: Number(row.reach || 0),
        ctr: Number(row.ctr || 0),
        cpc: Number(row.cpc || 0),
        cpm: Number(row.cpm || 0),
        roas: Math.round(adRoas * 100) / 100,
        cpa: purchases > 0 ? Math.round(spend / purchases) : 0,
        isWinner: false,
      });
    }
  }

  // Calculate set-level metrics and mark winners
  const adSets = Object.values(adSetMap).map(set => {
    set.roas = set.totalSpend > 0 ? Math.round((set.totalPurchaseValue / set.totalSpend) * 100) / 100 : 0;
    set.cpa = set.totalPurchases > 0 ? Math.round(set.totalSpend / set.totalPurchases) : 0;
    set.ctr = set.totalImpressions > 0 ? Math.round((set.totalClicks / set.totalImpressions) * 10000) / 100 : 0;

    // Winner: ad ROAS > set avg ROAS AND spend > $50 (5000 cents)
    for (const ad of set.ads) {
      ad.isWinner = ad.roas > set.roas && ad.spend > 5000;
    }

    // Sort ads within set by spend desc
    set.ads.sort((a: any, b: any) => b.spend - a.spend);
    return set;
  });

  // Sort ad sets
  if (sortBy === 'roas') {
    adSets.sort((a, b) => b.roas - a.roas);
  } else if (sortBy === 'purchases') {
    adSets.sort((a, b) => b.totalPurchases - a.totalPurchases);
  } else {
    adSets.sort((a, b) => b.totalSpend - a.totalSpend);
  }

  return NextResponse.json({ adSets, from, to });
}
