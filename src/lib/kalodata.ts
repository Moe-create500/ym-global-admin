// ── Kalodata Open API client ─────────────────────────────────────────────────
// Replaces the manual export-file dance: instead of Kalodata → Excel →
// upload, YM pulls winning videos (and product main images) straight from
// the API into the existing video pool.
//
// Spec (extracted from kalodata.com/open-center docs, 2026-08-22):
//   base   POST https://www.kalodata.com/openapi/v1/tiktok/*
//   auth   header `secret-key: <API key>`   (env KALODATA_API_KEY)
//   cost   rank endpoints 0.1 points/call · detail endpoints 1.0 points/call
//   common region/language/currency/date_range (lastDay|last7Day|last30Day…)
//
//   /video/rank    filters: keyword, product_id, creator_id, shop_id,
//                  category_ids, revenue_range, ads_roas, is_ai_video;
//                  sort_field {field, type}; page_size ≤ 100
//                  → video_id, belonged_creator_handle, revenue, views, roas…
//                  TikTok URL = https://www.tiktok.com/@{handle}/video/{id}
//   /product/rank  → master_image_url (the product's MAIN IMAGE), keyword,
//                  seller info, revenue splits; `need_image: true`
//   /product/detail→ same, single product by product_id

const BASE = 'https://www.kalodata.com/openapi/v1/tiktok';

export class KalodataError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function kaloPost(path: string, body: Record<string, any>): Promise<any> {
  const key = process.env.KALODATA_API_KEY;
  if (!key) throw new KalodataError('KALODATA_API_KEY not configured — generate one at kalodata.com/open-center (Account → Generate Key) and add it to .env');
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'secret-key': key, 'content-type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ region: 'US', language: 'en-US', currency: 'USD', ...body }),
  });
  const d: any = await res.json().catch(() => ({}));
  if (!d?.success) {
    const msg = d?.message || `HTTP ${res.status}`;
    throw new KalodataError(
      /not allowed|not null/i.test(msg)
        ? `Kalodata rejected the API key (${msg}) — regenerate it at kalodata.com/open-center and update KALODATA_API_KEY`
        : `Kalodata ${path}: ${msg}`,
      d?.code
    );
  }
  return d.data;
}

export interface KaloVideo {
  video_id: string;
  video_title: string;
  belonged_creator_handle: string;
  belonged_creator_id: string;
  revenue: number;
  views: number;
  ads_roas: number | null;
  ad: number;              // 1 = ad, 0 = organic
  ai_video: number | null; // 1 = AI-generated
  tiktok_url: string;      // constructed
}

export function tiktokUrl(handle: string, videoId: string): string {
  return `https://www.tiktok.com/@${String(handle || '').replace(/^@/, '')}/video/${videoId}`;
}

/** Top revenue videos. Filter by keyword OR productId (Kalodata's TikTok
 *  product id) OR categoryIds — mirrors what the manual export gave us. */
export async function videoRank(opts: {
  keyword?: string; productId?: string; creatorId?: string; shopId?: string;
  categoryIds?: string[]; dateRange?: string; count?: number; page?: number;
  minRevenue?: number; region?: string;
}): Promise<KaloVideo[]> {
  const body: Record<string, any> = {
    date_range: opts.dateRange || 'last7Day',
    page_size: Math.min(Math.max(opts.count || 20, 1), 100),
    page_number: opts.page || 1,
    sort_field: { field: 'revenue', type: 'DESC' },
  };
  if (opts.region) body.region = opts.region;
  if (opts.keyword) body.keyword = opts.keyword;
  if (opts.productId) body.product_id = opts.productId;
  if (opts.creatorId) body.creator_id = opts.creatorId;
  if (opts.shopId) body.shop_id = opts.shopId;
  if (opts.categoryIds?.length) body.category_ids = opts.categoryIds;
  if (opts.minRevenue) body.revenue_range = `>${opts.minRevenue}`;
  const rows: any[] = (await kaloPost('/video/rank', body)) || [];
  return rows
    .filter(r => r.video_id && r.belonged_creator_handle)
    .map(r => ({ ...r, tiktok_url: tiktokUrl(r.belonged_creator_handle, r.video_id) }));
}

export interface KaloProduct {
  product_id: string;
  product_name: string;
  revenue: number;
  unit_price: number;
  master_image_url: string | null;  // the MAIN IMAGE
  seller_name?: string;
}

/** Search products by keyword — returns Kalodata product ids + MAIN IMAGE.
 *  The product id then feeds videoRank({productId}) for that product's
 *  winning videos: keyword → product → its top videos + its main image. */
export async function productRank(opts: {
  keyword?: string; dateRange?: string; count?: number; region?: string; categoryIds?: string[];
}): Promise<KaloProduct[]> {
  const body: Record<string, any> = {
    date_range: opts.dateRange || 'last7Day',
    page_size: Math.min(Math.max(opts.count || 10, 1), 100),
    page_number: 1,
    sort_field: { field: 'revenue', type: 'DESC' },
    need_image: true,
  };
  if (opts.region) body.region = opts.region;
  if (opts.keyword) body.keyword = opts.keyword;
  if (opts.categoryIds?.length) body.category_ids = opts.categoryIds;
  return ((await kaloPost('/product/rank', body)) || []) as KaloProduct[];
}

/** Single product detail (1.0 points) — master_image_url + revenue splits. */
export async function productDetail(productId: string, opts: { dateRange?: string; region?: string } = {}): Promise<KaloProduct> {
  return (await kaloPost('/product/detail', {
    product_id: productId,
    date_range: opts.dateRange || 'last7Day',
    ...(opts.region ? { region: opts.region } : {}),
    need_image: true,
  })) as KaloProduct;
}
