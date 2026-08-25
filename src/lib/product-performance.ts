// ── Product performance: which PRODUCT made the money ────────────────────────
// Joins three truths the system already owns:
//   revenue  — orders.line_items (sku, qty, price) via SQLite json_each
//   spend    — ad_spend, attributed to products through the LAUNCH REGISTRY
//              (Launch Flow records exactly which campaign/ad-set it created
//              for which product), with campaign-name matching as a flagged
//              fallback — never force-fitted
//   tests    — a launch's first N days tracked cumulatively with deterministic
//              verdicts (thresholds in brain_config, visible, never silent)
//
// Attribution correctness rules:
//   · NEW-campaign launches attribute at CAMPAIGN level (the campaign exists
//     only for that product)
//   · ATTACH launches (existingCampaignId) attribute at AD-SET level — the
//     shared campaign serves other products; taking the whole campaign's
//     spend would steal their dollars
//   · spend that matches nothing stays UNATTRIBUTED and is reported as such

import type DatabaseType from 'better-sqlite3';
import { getBrainConfig } from '@/lib/forward-cash';

export function ensureProductPerfTables(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS product_launches (
    workflow_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    product_id TEXT,
    product_title TEXT,
    launch_date TEXT NOT NULL,
    campaign_id TEXT,
    ad_set_id TEXT,
    attribution_level TEXT NOT NULL DEFAULT 'campaign',
    workflow_status TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_launches_store ON product_launches(store_id, launch_date)`);
}

/** Harvest every Launch Flow workflow that created FB objects. Idempotent —
 *  keyed by workflow id; re-runs refresh status only. */
export function backfillLaunches(db: DatabaseType.Database): { added: number } {
  ensureProductPerfTables(db);
  const rows: any[] = db.prepare(`
    SELECT w.id, w.store_id, w.product_id, w.status, w.created_at,
           json_extract(w.result_json, '$.campaignId') AS campaign_id,
           json_extract(w.result_json, '$.adSetId') AS ad_set_id,
           json_extract(w.config_json, '$.existingCampaignId') AS existing_campaign,
           json_extract(w.result_json, '$.productHandle') AS product_handle,
           p.title AS product_title
    FROM ad_workflows w LEFT JOIN products p ON p.id = w.product_id
    WHERE json_extract(w.result_json, '$.campaignId') IS NOT NULL
  `).all();
  const ins = db.prepare(`INSERT INTO product_launches
      (workflow_id, store_id, product_id, product_title, launch_date, campaign_id, ad_set_id, attribution_level, workflow_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workflow_id) DO UPDATE SET workflow_status = excluded.workflow_status,
      product_title = COALESCE(excluded.product_title, product_launches.product_title)`);
  let added = 0;
  for (const r of rows) {
    const before = db.prepare('SELECT 1 FROM product_launches WHERE workflow_id = ?').get(r.id);
    // attach-launch → ad-set attribution; own campaign → campaign attribution
    const level = r.existing_campaign ? 'adset' : 'campaign';
    ins.run(r.id, r.store_id, r.product_id, r.product_title || r.product_handle || null,
      String(r.created_at).slice(0, 10), String(r.campaign_id), r.ad_set_id ? String(r.ad_set_id) : null,
      level, r.status);
    if (!before) added++;
  }
  return { added };
}

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Revenue per product per store from real order line items. product_key =
 *  sku when present, else normalized item name. Fulfillment cost allocated by
 *  line-value share of the order's actual SS charge — never invented. */
export function getProductRevenue(db: DatabaseType.Database, opts: { storeId?: string; days?: number } = {}) {
  const d = `-${Math.min(Math.max(opts.days || 30, 1), 365)} days`;
  const where = opts.storeId ? 'AND o.store_id = ?' : '';
  const params: any[] = [d];
  if (opts.storeId) params.push(opts.storeId);
  const rows: any[] = db.prepare(`
    SELECT o.store_id, s.name AS store_name, o.order_date,
      COALESCE(NULLIF(json_extract(li.value, '$.sku'), ''), lower(json_extract(li.value, '$.name'))) AS product_key,
      json_extract(li.value, '$.name') AS product_name,
      SUM(COALESCE(json_extract(li.value, '$.qty'), 1)) AS units,
      SUM(COALESCE(json_extract(li.value, '$.qty'), 1) * COALESCE(json_extract(li.value, '$.priceCents'), 0)) AS revenue_cents,
      SUM(CASE WHEN o.subtotal_cents > 0
        THEN CAST(o.ss_charge_cents * (COALESCE(json_extract(li.value, '$.qty'), 1) * COALESCE(json_extract(li.value, '$.priceCents'), 0)) AS REAL) / o.subtotal_cents
        ELSE 0 END) AS fulfillment_cents,
      COUNT(DISTINCT o.id) AS orders
    FROM orders o
    JOIN stores s ON s.id = o.store_id, json_each(o.line_items) li
    WHERE o.line_items IS NOT NULL AND json_valid(o.line_items)
      AND o.order_date >= date('now', ?) AND o.fulfillment_status != 'cancelled' ${where}
    GROUP BY o.store_id, o.order_date, product_key
  `).all(...params);
  return rows.map(r => ({ ...r, fulfillment_cents: Math.round(r.fulfillment_cents || 0) }));
}

/** Spend per product via launch registry (exact) + name matching (inferred).
 *  Returns per-product totals AND the honest unattributed remainder. */
export function getProductSpend(db: DatabaseType.Database, opts: { storeId?: string; days?: number } = {}) {
  ensureProductPerfTables(db);
  const d = `-${Math.min(Math.max(opts.days || 30, 1), 365)} days`;
  const whereStore = opts.storeId ? 'AND a.store_id = ?' : '';
  const params: any[] = [d];
  if (opts.storeId) params.push(opts.storeId);

  const launches: any[] = db.prepare(`SELECT * FROM product_launches ${opts.storeId ? 'WHERE store_id = ?' : ''}`)
    .all(...(opts.storeId ? [opts.storeId] : []));
  const byCampaign = new Map<string, any>();   // campaign-level launches
  const byAdSet = new Map<string, any>();      // adset-level launches
  for (const l of launches) {
    if (l.attribution_level === 'adset' && l.ad_set_id) byAdSet.set(l.ad_set_id, l);
    else if (l.campaign_id) byCampaign.set(l.campaign_id, l);
  }

  const spendRows: any[] = db.prepare(`
    SELECT a.store_id, a.date, a.campaign_id, a.ad_set_id, MAX(a.campaign_name) AS campaign_name,
           SUM(a.spend_cents) AS spend_cents, SUM(a.purchase_value_cents) AS fb_value_cents, SUM(a.purchases) AS fb_purchases
    FROM ad_spend a
    WHERE a.date >= date('now', ?) ${whereStore}
    GROUP BY a.store_id, a.date, a.campaign_id, a.ad_set_id
  `).all(...params);

  // product titles for name-fallback matching (per store)
  const products: any[] = db.prepare(`SELECT id, store_id, title, sku FROM products WHERE title IS NOT NULL`).all();
  const titlesByStore = new Map<string, { id: string; title: string; n: string; sku: string | null }[]>();
  for (const p of products) {
    if (!titlesByStore.has(p.store_id)) titlesByStore.set(p.store_id, []);
    const n = norm(p.title);
    if (n.length >= 6) titlesByStore.get(p.store_id)!.push({ id: p.id, title: p.title, n, sku: p.sku });
  }

  const perProduct = new Map<string, { product_id: string | null; title: string | null; spend_cents: number; fb_value_cents: number; fb_purchases: number; exact: boolean }>();
  let unattributedCents = 0;
  const add = (key: string, pid: string | null, title: string | null, r: any, exact: boolean) => {
    if (!perProduct.has(key)) perProduct.set(key, { product_id: pid, title, spend_cents: 0, fb_value_cents: 0, fb_purchases: 0, exact });
    const e = perProduct.get(key)!;
    e.spend_cents += r.spend_cents;
    e.fb_value_cents += r.fb_value_cents || 0;
    e.fb_purchases += r.fb_purchases || 0;
    if (exact) e.exact = true;
  };

  for (const r of spendRows) {
    // 1. exact: ad-set-level launch match wins first (most specific)
    const la = r.ad_set_id ? byAdSet.get(String(r.ad_set_id)) : null;
    const lc = byCampaign.get(String(r.campaign_id));
    const launch = la || lc;
    if (launch && (launch.product_id || launch.product_title)) {
      add(launch.product_id || `t:${norm(launch.product_title)}`, launch.product_id, launch.product_title, r, true);
      continue;
    }
    // 2. inferred: campaign name contains a product title (longest match wins)
    const cands = (titlesByStore.get(r.store_id) || [])
      .filter(p => norm(r.campaign_name || '').includes(p.n))
      .sort((a, b) => b.n.length - a.n.length);
    if (cands.length) {
      add(cands[0].id, cands[0].id, cands[0].title, r, false);
      continue;
    }
    unattributedCents += r.spend_cents;
  }

  return { perProduct, unattributedCents, launches };
}

/** The joined picture: per product — revenue, units, spend, ROAS, margin.
 *  Bridging identities: launch/product-id side ↔ line-item sku/name side via
 *  products table (sku match first, then normalized-title match). */
export function getProductPerformance(db: DatabaseType.Database, opts: { storeId?: string; days?: number } = {}) {
  const revenue = getProductRevenue(db, opts);
  const { perProduct, unattributedCents } = getProductSpend(db, opts);
  const products: any[] = db.prepare('SELECT id, store_id, title, sku, image_url FROM products').all();
  const bySku = new Map(products.filter(p => p.sku).map(p => [`${p.store_id}|${p.sku}`, p]));
  const byTitle = new Map(products.map(p => [`${p.store_id}|${norm(p.title)}`, p]));

  const agg = new Map<string, any>();
  for (const r of revenue) {
    const meta = bySku.get(`${r.store_id}|${r.product_key}`) || byTitle.get(`${r.store_id}|${norm(r.product_name)}`) || null;
    const key = meta ? meta.id : `${r.store_id}|${r.product_key}`;
    if (!agg.has(key)) {
      agg.set(key, {
        product_id: meta?.id || null, store_id: r.store_id, store_name: r.store_name,
        title: meta?.title || r.product_name, image_url: meta?.image_url || null,
        units: 0, orders: 0, revenue_cents: 0, fulfillment_cents: 0, spend_cents: 0,
        fb_purchases: 0, spend_exact: false, daily: new Map<string, number>(),
      });
    }
    const e = agg.get(key);
    e.units += r.units;
    e.orders += r.orders;
    e.revenue_cents += r.revenue_cents;
    e.fulfillment_cents += r.fulfillment_cents;
    e.daily.set(r.order_date, (e.daily.get(r.order_date) || 0) + r.revenue_cents);
  }
  // attach spend (by product_id, else by title)
  for (const [key, sp] of perProduct) {
    let target = sp.product_id ? [...agg.values()].find(a => a.product_id === sp.product_id) : null;
    if (!target && sp.title) { const t = sp.title; target = [...agg.values()].find(a => norm(a.title) === norm(t)); }
    if (!target) {
      // spent but no sales yet — a test burning with zero revenue MUST be visible
      const meta = products.find(p => p.id === sp.product_id);
      agg.set(`spend:${key}`, {
        product_id: sp.product_id, store_id: meta?.store_id || null,
        store_name: meta?.store_id ? ((db.prepare('SELECT name FROM stores WHERE id = ?').get(meta.store_id) as any)?.name || null) : null,
        title: sp.title || key, image_url: meta?.image_url || null,
        units: 0, orders: 0, revenue_cents: 0, fulfillment_cents: 0,
        spend_cents: sp.spend_cents, fb_purchases: sp.fb_purchases, spend_exact: sp.exact, daily: new Map(),
      });
      continue;
    }
    target.spend_cents += sp.spend_cents;
    target.fb_purchases += sp.fb_purchases;
    target.spend_exact = target.spend_exact || sp.exact;
  }

  const list = [...agg.values()].map(e => ({
    ...e,
    daily: undefined,
    roas: e.spend_cents > 0 ? Math.round(100 * e.revenue_cents / e.spend_cents) / 100 : null,
    net_cents: e.revenue_cents - e.spend_cents - e.fulfillment_cents,
  })).sort((a, b) => b.revenue_cents - a.revenue_cents);

  return { products: list, unattributedSpendCents: unattributedCents };
}

/** Active tests: launches inside the test window, cumulative since launch,
 *  deterministic verdicts with visible thresholds and evidence. */
export function getActiveTests(db: DatabaseType.Database) {
  ensureProductPerfTables(db);
  backfillLaunches(db);
  const testDays = getBrainConfig(db, 'test_days', 14);
  const targetRoas = getBrainConfig(db, 'test_target_roas', 150) / 100;   // stored ×100
  const killFloor = getBrainConfig(db, 'test_kill_roas', 80) / 100;
  const killMinSpend = getBrainConfig(db, 'test_kill_min_spend_cents', 15000);
  const scaleMinOrders = getBrainConfig(db, 'test_scale_min_orders', 3);

  // one launch row per product (earliest launch in window = day zero)
  const launches: any[] = db.prepare(`
    SELECT store_id, product_id, MIN(launch_date) AS launch_date,
           MAX(product_title) AS product_title, COUNT(*) AS launch_count
    FROM product_launches
    WHERE launch_date >= date('now', ?) AND product_id IS NOT NULL
    GROUP BY store_id, product_id
  `).all(`-${testDays} days`);
  if (!launches.length) return { tests: [], thresholds: { testDays, targetRoas, killFloor, killMinSpendCents: killMinSpend, scaleMinOrders } };

  const tests = launches.map(l => {
    const daysIn = Math.max(1, Math.round((Date.now() - new Date(l.launch_date + 'T12:00:00Z').getTime()) / 86400000));
    const perf = getProductPerformance(db, { storeId: l.store_id, days: daysIn + 1 });
    const p = perf.products.find(x => x.product_id === l.product_id)
      || perf.products.find(x => l.product_title && norm(x.title) === norm(l.product_title));
    const spend = p?.spend_cents || 0;
    const revenue = p?.revenue_cents || 0;
    const orders = p?.orders || 0;
    const roas = spend > 0 ? revenue / spend : null;

    let verdict = 'watch';
    let why = `day ${daysIn}/${testDays} — accumulating signal`;
    if (spend >= killMinSpend && (roas ?? 0) < killFloor) {
      verdict = 'kill_candidate';
      why = `$${(spend / 100).toFixed(0)} spent at ${roas == null ? '0' : roas.toFixed(2)}x ROAS (floor ${killFloor}x) — ${orders} orders in ${daysIn} days`;
    } else if ((roas ?? 0) >= targetRoas && orders >= scaleMinOrders) {
      verdict = 'scale';
      why = `${roas!.toFixed(2)}x ROAS (target ${targetRoas}x) on ${orders} orders — signal proven`;
    } else if (spend === 0) {
      verdict = 'not_spending';
      why = 'launched but no attributed spend yet — campaigns paused or spend not flowing';
    }
    return {
      store_id: l.store_id,
      store_name: p?.store_name || ((db.prepare('SELECT name FROM stores WHERE id = ?').get(l.store_id) as any)?.name),
      product_id: l.product_id, title: p?.title || l.product_title || 'unknown product',
      image_url: p?.image_url || null,
      launch_date: l.launch_date, days_in: daysIn, launch_count: l.launch_count,
      spend_cents: spend, revenue_cents: revenue, orders, units: p?.units || 0,
      roas: roas != null ? Math.round(roas * 100) / 100 : null,
      spend_exact: p?.spend_exact ?? false,
      verdict, why,
    };
  }).sort((a, b) => b.spend_cents - a.spend_cents);

  return { tests, thresholds: { testDays, targetRoas, killFloor, killMinSpendCents: killMinSpend, scaleMinOrders } };
}
