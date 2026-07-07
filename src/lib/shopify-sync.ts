import type Database from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// Shopify per-store credential vault + client_credentials token minting.
//
// We store the custom app's Client ID + Secret (shpss_…) ONCE per store. Before
// every API call the server mints a short-lived (~24h) access token via the
// OAuth client_credentials grant and caches it until it expires. The user never
// hand-pastes a token, and each credential is bound to exactly one shop domain —
// so cross-store data mixups become structurally impossible.
// ─────────────────────────────────────────────────────────────────────────────

const API_VERSION = '2025-01';

export function ensureShopifyCredsTable(db: Database.Database) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS shopify_credentials (
      store_id TEXT PRIMARY KEY,
      shop_domain TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      token_cache TEXT,
      token_expires_at INTEGER,
      last_synced_at TEXT,
      last_sync_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
}

/** Normalize any pasted domain to the bare myshopify host (no scheme, no path). */
export function normalizeShopDomain(input: string): string {
  let d = (input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!d.includes('.')) d = `${d}.myshopify.com`;
  return d;
}

export function saveShopifyCreds(db: Database.Database, storeId: string, shopDomain: string, clientId: string, clientSecret: string) {
  ensureShopifyCredsTable(db);
  const domain = normalizeShopDomain(shopDomain);
  db.prepare(`
    INSERT INTO shopify_credentials (store_id, shop_domain, client_id, client_secret, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(store_id) DO UPDATE SET
      shop_domain = excluded.shop_domain,
      client_id = excluded.client_id,
      client_secret = excluded.client_secret,
      token_cache = NULL, token_expires_at = NULL,
      updated_at = datetime('now')
  `).run(storeId, domain, clientId.trim(), clientSecret.trim());
}

export interface StoreCreds {
  store_id: string; shop_domain: string; client_id: string; client_secret: string;
  token_cache: string | null; token_expires_at: number | null;
  last_synced_at: string | null; last_sync_note: string | null;
}

export function getCreds(db: Database.Database, storeId: string): StoreCreds | null {
  ensureShopifyCredsTable(db);
  return (db.prepare('SELECT * FROM shopify_credentials WHERE store_id = ?').get(storeId) as any) || null;
}

/** Mint (or reuse a cached) access token via client_credentials. Returns the token string. */
export async function getAccessToken(db: Database.Database, storeId: string, nowMs: number): Promise<string> {
  const creds = getCreds(db, storeId);
  if (!creds) throw new Error('No Shopify credentials saved for this store');

  // reuse cached token until 5 min before expiry
  if (creds.token_cache && creds.token_expires_at && creds.token_expires_at - 5 * 60_000 > nowMs) {
    return creds.token_cache;
  }

  const res = await fetch(`https://${creds.shop_domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      grant_type: 'client_credentials',
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token mint failed (${res.status}): ${text.slice(0, 300)}`);
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`Token response not JSON: ${text.slice(0, 200)}`); }
  const token = json.access_token;
  if (!token) throw new Error(`No access_token in response: ${text.slice(0, 200)}`);
  const expiresMs = nowMs + (Number(json.expires_in) || 86400) * 1000;

  db.prepare('UPDATE shopify_credentials SET token_cache = ?, token_expires_at = ? WHERE store_id = ?')
    .run(token, expiresMs, storeId);
  return token;
}

/** Authenticated GET against the store's Admin API. */
export async function shopifyGet(db: Database.Database, storeId: string, path: string, nowMs: number): Promise<any> {
  const creds = getCreds(db, storeId);
  if (!creds) throw new Error('No Shopify credentials saved for this store');
  const token = await getAccessToken(db, storeId, nowMs);
  const url = `https://${creds.shop_domain}/admin/api/${API_VERSION}/${path}`;
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Response not JSON for ${path}: ${text.slice(0, 200)}`); }
}

/** Live probe: mint a token and confirm the store identity + payments scope. */
export async function probeStore(db: Database.Database, storeId: string, nowMs: number): Promise<{ shop: string; currency: string; payouts_visible: boolean }> {
  const shop = await shopifyGet(db, storeId, 'shop.json', nowMs);
  let payoutsVisible = false;
  try {
    await shopifyGet(db, storeId, 'shopify_payments/payouts.json?limit=1', nowMs);
    payoutsVisible = true;
  } catch { /* scope not granted or not a Shopify Payments store */ }
  return {
    shop: shop?.shop?.myshopify_domain || shop?.shop?.name || 'unknown',
    currency: shop?.shop?.currency || 'USD',
    payouts_visible: payoutsVisible,
  };
}
