import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { videoRank, productRank, productDetail, KalodataError } from '@/lib/kalodata';
import { importVideos } from '@/lib/video-pool';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// The export-file dance, automated:
//   POST {action:'pull_videos', storeId, productId?, keyword?, kaloProductId?,
//         count?, dateRange?, region?}
//     → kalodata video/rank → straight into video_ads_pool (same importer the
//       xlsx upload used: dedupe by video id, revenue attached, winners first)
//   POST {action:'search_products', keyword, ...}
//     → product candidates with MAIN IMAGE (master_image_url) — pick one,
//       then pull_videos with its kaloProductId for that product's winners
//   POST {action:'product_image', kaloProductId}
//     → single product's main image (1.0 pts)
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const db = getDb();
  try {
    if (b.action === 'search_products') {
      if (!b.keyword) return NextResponse.json({ error: 'keyword required' }, { status: 400 });
      const products = await productRank({ keyword: b.keyword, dateRange: b.dateRange, count: Math.min(b.count || 10, 20), region: b.region });
      return NextResponse.json({ success: true, products });
    }

    if (b.action === 'product_image') {
      if (!b.kaloProductId) return NextResponse.json({ error: 'kaloProductId required' }, { status: 400 });
      const p = await productDetail(b.kaloProductId, { dateRange: b.dateRange, region: b.region });
      return NextResponse.json({ success: true, product: p, imageUrl: p.master_image_url });
    }

    if (b.action === 'pull_videos') {
      if (!b.storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
      if (!b.keyword && !b.kaloProductId && !b.creatorId) {
        return NextResponse.json({ error: 'keyword, kaloProductId or creatorId required — the Brain never pulls a blind global list' }, { status: 400 });
      }
      const videos = await videoRank({
        keyword: b.keyword || undefined,
        productId: b.kaloProductId || undefined,
        creatorId: b.creatorId || undefined,
        dateRange: b.dateRange || 'last7Day',
        count: Math.min(b.count || 20, 50),
        region: b.region,
        minRevenue: b.minRevenue,
      });
      const rows = videos.map(v => ({
        id: v.video_id,
        caption: v.video_title || '',
        author: v.belonged_creator_handle || '',
        url: v.tiktok_url,
        revenue: Math.round(v.revenue || 0),
        duration: '',
        productTitle: b.productTitle || undefined,
      }));
      const r = importVideos(db, b.storeId, b.productId || null, rows);
      return NextResponse.json({
        success: true, found: videos.length, ...r,
        topVideos: videos.slice(0, 10).map(v => ({ url: v.tiktok_url, revenue: v.revenue, views: v.views, roas: v.ads_roas, ad: v.ad })),
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    const msg = String(e?.message || e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: e instanceof KalodataError ? 502 : 500 });
  }
}
