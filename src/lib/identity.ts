// ── Identity map ─────────────────────────────────────────────────────────────
// THE authoritative answer to "which store does this external ID belong to".
// YM Global and ShipSourced are sibling companies with different units (stores
// vs clients); every subsystem used to re-derive the mapping from scattered
// columns (stores.shipsourced_client_id, fb_profiles.store_id, bank_accounts.
// store_id, funding-card last4s) and every mis-attribution incident traced
// back to that. This table is seeded from those columns, then becomes the
// single place to look — and the single place to fix.
//
// Rules:
//   · (namespace, external_id) is unique — an ID can only belong to one store.
//   · source='manual' rows are never touched by the seeder. Fixing a wrong
//     mapping by hand is permanent until changed by hand.
//   · The seeder is idempotent and additive; it records provenance in source.

import type DatabaseType from 'better-sqlite3';

export type IdentityNamespace =
  | 'ss_client'        // ShipSourced Client.id
  | 'shopify_domain'   // myshopify domain or custom domain
  | 'fb_profile'       // fb_profiles.id (YM-internal but joins ad data)
  | 'fb_ad_account'    // act_ id (digits only, no act_ prefix)
  | 'funding_card'     // FB/Google funding card last4
  | 'bank_account'     // bank_accounts.id
  | 'google_account';  // Google Ads account id

export const IDENTITY_NAMESPACES: IdentityNamespace[] = [
  'ss_client', 'shopify_domain', 'fb_profile', 'fb_ad_account',
  'funding_card', 'bank_account', 'google_account',
];

export function ensureIdentityTables(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS entity_aliases (
    namespace TEXT NOT NULL,
    external_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'seed',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (namespace, external_id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_aliases_store ON entity_aliases(store_id)`);
}

/** Harvest every mapping the system already knows into the map. Idempotent;
 *  never overwrites manual rows; re-seeds keep provenance current. */
export function seedIdentityMap(db: DatabaseType.Database): { added: number; refreshed: number } {
  ensureIdentityTables(db);
  let added = 0;
  let refreshed = 0;

  const upsert = db.prepare(`INSERT INTO entity_aliases (namespace, external_id, store_id, source, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(namespace, external_id) DO UPDATE SET
      store_id = CASE WHEN entity_aliases.source = 'manual' THEN entity_aliases.store_id ELSE excluded.store_id END,
      source   = CASE WHEN entity_aliases.source = 'manual' THEN 'manual' ELSE excluded.source END,
      updated_at = datetime('now')`);

  const put = (ns: IdentityNamespace, id: string | null | undefined, storeId: string, src: string) => {
    if (!id || !String(id).trim()) return;
    const before = db.prepare('SELECT store_id FROM entity_aliases WHERE namespace = ? AND external_id = ?').get(ns, String(id).trim()) as any;
    upsert.run(ns, String(id).trim(), storeId, src);
    if (!before) added++;
    else refreshed++;
  };

  db.transaction(() => {
    // Stores: SS client ids (primary + extras) + shopify domain
    const stores: any[] = db.prepare('SELECT id, shipsourced_client_id, shipsourced_extra_client_ids, shopify_domain FROM stores').all();
    for (const s of stores) {
      put('ss_client', s.shipsourced_client_id, s.id, 'seed:stores.shipsourced_client_id');
      if (s.shipsourced_extra_client_ids) {
        for (const extra of String(s.shipsourced_extra_client_ids).split(',')) {
          put('ss_client', extra, s.id, 'seed:stores.shipsourced_extra_client_ids');
        }
      }
      // "@shiphero.shipsourced.com" pseudo-domains are SS routing labels, not shops
      if (s.shopify_domain && !String(s.shopify_domain).includes('@')) {
        put('shopify_domain', s.shopify_domain, s.id, 'seed:stores.shopify_domain');
      }
    }

    // FB profiles: profile id, ad account, funding cards
    const profiles: any[] = db.prepare(`SELECT id, store_id, ad_account_id, primary_card_last4, working_card_last4 FROM fb_profiles WHERE store_id IS NOT NULL`).all();
    for (const p of profiles) {
      put('fb_profile', p.id, p.store_id, 'seed:fb_profiles');
      if (p.ad_account_id) put('fb_ad_account', String(p.ad_account_id).replace(/^act_/, ''), p.store_id, 'seed:fb_profiles.ad_account_id');
      put('funding_card', p.primary_card_last4, p.store_id, 'seed:fb_profiles.primary_card_last4');
      put('funding_card', p.working_card_last4, p.store_id, 'seed:fb_profiles.working_card_last4');
    }

    // Bank accounts assigned to a store
    const accounts: any[] = db.prepare(`SELECT id, store_id FROM bank_accounts WHERE store_id IS NOT NULL AND status != 'disconnected'`).all();
    for (const a of accounts) put('bank_account', a.id, a.store_id, 'seed:bank_accounts.store_id');
  })();

  return { added, refreshed };
}

/** The one lookup everything should use. */
export function resolveStore(db: DatabaseType.Database, namespace: IdentityNamespace, externalId: string): string | null {
  ensureIdentityTables(db);
  const row: any = db.prepare('SELECT store_id FROM entity_aliases WHERE namespace = ? AND external_id = ?')
    .get(namespace, String(externalId).trim());
  return row?.store_id || null;
}

/** Everything known about one store, grouped by namespace. */
export function storeIdentity(db: DatabaseType.Database, storeId: string): Record<string, string[]> {
  ensureIdentityTables(db);
  const rows: any[] = db.prepare('SELECT namespace, external_id FROM entity_aliases WHERE store_id = ? ORDER BY namespace, external_id').all(storeId);
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (!out[r.namespace]) out[r.namespace] = [];
    out[r.namespace].push(r.external_id);
  }
  return out;
}

/** Identity matrix + gaps for the foundation dashboard. A gap is a namespace a
 *  store of that kind is expected to have but doesn't. */
export function identityMatrix(db: DatabaseType.Database) {
  ensureIdentityTables(db);
  const stores: any[] = db.prepare(`SELECT id, name, is_active, platform FROM stores WHERE COALESCE(dashboard_hidden,0) = 0 ORDER BY is_active DESC, name`).all();
  const aliases: any[] = db.prepare('SELECT namespace, external_id, store_id, source FROM entity_aliases').all();
  const byStore = new Map<string, any[]>();
  for (const a of aliases) {
    if (!byStore.has(a.store_id)) byStore.set(a.store_id, []);
    byStore.get(a.store_id)!.push(a);
  }
  return stores.map(s => {
    const mine = byStore.get(s.id) || [];
    const ns = (n: string) => mine.filter(a => a.namespace === n).map(a => ({ id: a.external_id, source: a.source }));
    const isSelling = !!s.is_active && s.name !== 'ShipSourced' && s.name !== 'Apex Loom';
    const gaps: string[] = [];
    if (isSelling) {
      if (!ns('ss_client').length) gaps.push('no ShipSourced client — fulfillment/COGS can\'t attribute');
      if (!ns('fb_profile').length && !ns('fb_ad_account').length) gaps.push('no FB identity — ad spend can\'t attribute');
      if (!ns('funding_card').length) gaps.push('no funding card — FB charges can\'t verify');
    }
    return {
      storeId: s.id, name: s.name, isActive: !!s.is_active, platform: s.platform || 'shopify',
      ss_client: ns('ss_client'), shopify_domain: ns('shopify_domain'),
      fb_profile: ns('fb_profile'), fb_ad_account: ns('fb_ad_account'),
      funding_card: ns('funding_card'), bank_account: ns('bank_account'),
      google_account: ns('google_account'),
      gaps,
    };
  });
}

/** Manually pin an external ID to a store — permanent until changed by hand. */
export function assignAlias(db: DatabaseType.Database, namespace: IdentityNamespace, externalId: string, storeId: string, note?: string) {
  ensureIdentityTables(db);
  if (!IDENTITY_NAMESPACES.includes(namespace)) throw new Error(`unknown namespace ${namespace}`);
  const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(storeId);
  if (!store) throw new Error('store not found');
  db.prepare(`INSERT INTO entity_aliases (namespace, external_id, store_id, source, note, updated_at)
    VALUES (?, ?, ?, 'manual', ?, datetime('now'))
    ON CONFLICT(namespace, external_id) DO UPDATE SET
      store_id = excluded.store_id, source = 'manual', note = excluded.note, updated_at = datetime('now')`)
    .run(namespace, String(externalId).trim(), storeId, note || null);
}
