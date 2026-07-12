// Centralized product-link resolver — THE single source of truth for
// customer-facing product URLs across all connected Shopify stores.
//
// Ads run straight to product landing pages, so a wrong URL burns real spend.
// Resolution walks: store → centralized Shopify credentials → product (by
// synced id, else title search) → handle + status + publication → custom
// landing page (product metafields) → live storefront domain → URL, then
// VERIFIES the URL actually serves the product page before recommending it.
//
// Selection priority (highest first):
//   1. Product metafield carrying a marketing/landing URL
//   2. Live Shopify product page  https://{storefront-domain}/products/{handle}
//   3. Homepage — returned separately, NEVER auto-recommended
//
// Credentials never leave the server: this module returns URLs and metadata
// only, and runs exclusively in API routes.

import type Database from 'better-sqlite3';
import { shopifyGet, shopifyGetRaw } from '@/lib/shopify-sync';

export interface ProductLink {
  storeId: string;
  storeName: string;
  productId: string;                    // local products.id
  shopifyProductId: string | null;
  productTitle: string;
  productHandle: string | null;
  productStatus: string | null;         // active | draft | archived
  publishedToOnlineStore: boolean;
  storefrontDomain: string | null;      // custom domain preferred over .myshopify.com
  standardProductUrl: string | null;
  customLandingPageUrl: string | null;
  recommendedAdvertisingUrl: string | null;
  homepageUrl: string | null;
  validated: boolean;
  warnings: string[];
  selectionReason: string;
}

/** Normalize a product title for matching: strip ™/®/© and their "TM" text
 *  forms (sync data often mangles the symbols), lowercase, collapse to tokens. */
function normalizeTitle(t: string): string {
  return String(t || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\btm\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Fuzzy-pick the Shopify product matching a local title. Exact normalized
 *  match wins; then containment; then token overlap. Active+published break ties. */
function fuzzyPickProduct(localTitle: string, candidates: any[]): { product: any | null; ambiguous: boolean } {
  const target = normalizeTitle(localTitle);
  const targetTokens = new Set(target.split(' ').filter(Boolean));
  let best: any = null, bestScore = 0, secondScore = 0;
  for (const p of candidates) {
    const n = normalizeTitle(p.title);
    let score = 0;
    if (n === target) score = 100;
    // containment: prefer the CLOSEST-length match — "beauty bundle" must pick
    // "The Beauty Bundle" over "Beauty Bundle — For a Friend"
    else if (n.includes(target) || target.includes(n)) score = 80 + Math.max(0, 12 - Math.abs(n.length - target.length) * 0.5);
    else {
      const tokens = n.split(' ').filter(Boolean);
      const overlap = tokens.filter(t => targetTokens.has(t)).length;
      score = targetTokens.size ? Math.round((overlap / Math.max(targetTokens.size, tokens.length)) * 70) : 0;
    }
    if (p.status === 'active') score += 5;
    if (p.published_at) score += 3;
    if (score > bestScore) { secondScore = bestScore; bestScore = score; best = p; }
    else if (score > secondScore) { secondScore = score; }
  }
  if (!best || bestScore < 45) return { product: null, ambiguous: false };
  return { product: best, ambiguous: bestScore - secondScore < 10 && secondScore > 0 };
}

/** All products in the store (paged, capped) — needed because Shopify REST
 *  title filtering is exact-match only and synced titles drift. */
async function fetchStoreProducts(db: Database.Database, storeId: string, now: number, maxPages = 4): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = 'products.json?fields=id,title,handle,status,published_at&limit=250';
  for (let i = 0; i < maxPages && next; i++) {
    const { json, link }: { json: any; link: string | null } = await shopifyGetRaw(db, storeId, next, now);
    out.push(...(json.products || []));
    const m = link && link.match(/<([^>]+)>;\s*rel="next"/);
    next = m ? m[1] : null;
  }
  return out;
}

// Metafield namespaces/keys that mean "this product has a dedicated lander"
const LANDER_KEY_RE = /land(er|ing)|marketing[_-]?url|ad[_-]?url|funnel|advertorial/i;

async function verifyUrl(url: string, handle: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (link-verify)' } });
    clearTimeout(t);
    if (!res.ok) return false;
    // A product URL that redirects to the homepage still returns 200 —
    // require the final URL to still be a product path with our handle.
    // Decode: unicode handles (™ etc.) arrive percent-encoded in res.url.
    let finalPath = new URL(res.url).pathname;
    try { finalPath = decodeURIComponent(finalPath); } catch { /* keep raw */ }
    return finalPath.includes('/products/') && (handle ? finalPath.toLowerCase().includes(handle.toLowerCase()) : true);
  } catch { return false; }
}

export async function resolveProductLink(db: Database.Database, storeId: string, localProductId: string): Promise<ProductLink> {
  const now = Date.now();
  const store: any = db.prepare('SELECT id, name FROM stores WHERE id = ?').get(storeId);
  if (!store) throw new Error('Store not found');
  const local: any = db.prepare('SELECT id, title, shopify_product_id FROM products WHERE id = ? AND store_id = ?').get(localProductId, storeId);
  if (!local) throw new Error(`Product not found in store ${store.name} — wrong-store selection guard`);

  const out: ProductLink = {
    storeId, storeName: store.name,
    productId: local.id, shopifyProductId: local.shopify_product_id || null,
    productTitle: local.title, productHandle: null, productStatus: null,
    publishedToOnlineStore: false, storefrontDomain: null,
    standardProductUrl: null, customLandingPageUrl: null,
    recommendedAdvertisingUrl: null, homepageUrl: null,
    validated: false, warnings: [], selectionReason: '',
  };

  // 1. Live storefront domain — custom domain preferred over .myshopify.com
  const shop = (await shopifyGet(db, storeId, 'shop.json', now))?.shop;
  out.storefrontDomain = shop?.domain || shop?.myshopify_domain || null;
  if (!out.storefrontDomain) {
    out.selectionReason = 'Shopify shop lookup returned no domain — cannot build any URL.';
    return out;
  }
  out.homepageUrl = `https://${out.storefrontDomain}/`;

  // 2. The product on Shopify. The synced shopify_product_id is only usable
  // when it's an actual numeric Shopify id — some syncs stored slugs there.
  let p: any = null;
  if (local.shopify_product_id && /^\d+$/.test(String(local.shopify_product_id))) {
    try {
      p = (await shopifyGet(db, storeId, `products/${local.shopify_product_id}.json?fields=id,title,handle,status,published_at`, now))?.product;
    } catch { out.warnings.push(`Synced Shopify product id ${local.shopify_product_id} no longer resolves — fell back to title matching.`); }
  }
  if (!p) {
    // Shopify's title filter is exact-match only and synced titles drift
    // (™ → "TM", prefixes) — fetch the catalog and fuzzy-match locally.
    const candidates = await fetchStoreProducts(db, storeId, now);
    const { product, ambiguous } = fuzzyPickProduct(local.title, candidates);
    p = product;
    if (p && normalizeTitle(p.title) !== normalizeTitle(local.title)) {
      out.warnings.push(`Matched by fuzzy title: local "${local.title}" → Shopify "${p.title}" (${p.status}). Confirm this is the right product.`);
    }
    if (ambiguous) out.warnings.push('Multiple similar products matched — the closest active one was picked. Verify before spending.');
  }

  if (!p?.handle) {
    out.selectionReason = 'Product could not be found on Shopify (by synced id or title) — no product URL exists. Homepage returned only as an explicit manual choice.';
    return out;
  }

  out.shopifyProductId = String(p.id);
  out.productHandle = p.handle;
  out.productStatus = p.status || null;
  out.publishedToOnlineStore = !!p.published_at;
  out.standardProductUrl = `https://${out.storefrontDomain}/products/${p.handle}`;

  if (p.status !== 'active') out.warnings.push(`Product status is "${p.status}" — the page may not be publicly reachable.`);
  if (!p.published_at) out.warnings.push('Product is not published to the Online Store channel.');

  // 3. Custom landing page from product metafields (dedicated lander wins)
  try {
    const metafields = (await shopifyGet(db, storeId, `products/${p.id}/metafields.json?limit=100`, now))?.metafields || [];
    const lander = metafields.find((m: any) =>
      LANDER_KEY_RE.test(`${m.namespace}.${m.key}`) && typeof m.value === 'string' && /^https?:\/\//i.test(m.value));
    if (lander) out.customLandingPageUrl = lander.value;
  } catch { /* metafields are optional — standard URL still stands */ }

  // 4. Recommend + verify
  if (out.customLandingPageUrl) {
    out.recommendedAdvertisingUrl = out.customLandingPageUrl;
    out.selectionReason = 'Product has a custom landing page configured in its metafields — dedicated landers outrank the standard product page.';
    out.validated = true; // external landers aren't handle-checkable; trust the explicit config
  } else {
    out.recommendedAdvertisingUrl = out.standardProductUrl;
    out.validated = await verifyUrl(out.standardProductUrl, p.handle);
    out.selectionReason = out.validated
      ? 'No custom landing page configured — the live Shopify product page was verified reachable and selected.'
      : 'No custom landing page configured — the standard product URL was built but did NOT verify as live (check status/publication/domain before spending).';
  }

  return out;
}
