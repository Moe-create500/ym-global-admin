import { getDb } from '@/lib/db';
import { getClientBilling, getClientOrders } from '@/lib/shipsourced';
import { getAdInsights, getAdCreatives, getBillingCharges, getFundingSource, getAccountPaymentMethods, getVideoSourceUrls, getPages } from '@/lib/facebook';
import crypto from 'crypto';

/**
 * Amazon referral fee schedule by category.
 * Each category has price tiers: [{maxCents, pct}, ...] — last entry has no max (catch-all).
 * Source: Amazon Seller Central referral fee schedule.
 */
const AMAZON_FEE_SCHEDULE: Record<string, { maxCents?: number; pct: number }[]> = {
  'health_personal_care':   [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  'beauty':                 [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  'grocery':                [{ maxCents: 1500, pct: 8 }, { pct: 15 }],
  'clothing':               [{ maxCents: 2000, pct: 17 }, { pct: 17 }],
  'electronics':            [{ pct: 8 }],
  'computers':              [{ pct: 6 }],
  'automotive':             [{ pct: 12 }],
  'home_garden':            [{ pct: 15 }],
  'kitchen':                [{ pct: 15 }],
  'sports':                 [{ pct: 15 }],
  'toys':                   [{ pct: 15 }],
  'pet_supplies':           [{ pct: 15 }],
  'baby':                   [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  'supplements':            [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  'default':                [{ pct: 15 }],
};

const EBAY_FEE_PCT = 13.25; // eBay final value fee (12.9% + 0.35% for payment processing)

/**
 * Calculate platform fee for a single order based on platform, category, and price.
 */
function calculatePlatformFee(platform: string, category: string | null, orderTotalCents: number): number {
  if (platform === 'ebay') {
    return Math.round(orderTotalCents * EBAY_FEE_PCT / 100);
  }
  if (platform === 'amazon') {
    const tiers = AMAZON_FEE_SCHEDULE[category || 'default'] || AMAZON_FEE_SCHEDULE['default'];
    for (const tier of tiers) {
      if (!tier.maxCents || orderTotalCents <= tier.maxCents) {
        return Math.round(orderTotalCents * tier.pct / 100);
      }
    }
    // Fallback to last tier
    return Math.round(orderTotalCents * tiers[tiers.length - 1].pct / 100);
  }
  return 0; // Shopify fees handled separately
}

/**
 * Calculate total platform fees for a store on a given date using per-order data.
 * Falls back to flat rate if no order-level data exists.
 */
function calculateDailyPlatformFees(db: any, storeId: string, date: string, platform: string, category: string | null, fallbackRevenueCents: number, fallbackFeePct: number): number {
  if (platform !== 'amazon' && platform !== 'ebay') return 0;

  // Try per-order calculation first
  const orders: any[] = db.prepare(
    'SELECT total_cents FROM orders WHERE store_id = ? AND order_date = ? AND total_cents > 0'
  ).all(storeId, date);

  if (orders.length > 0) {
    let totalFees = 0;
    for (const o of orders) {
      totalFees += calculatePlatformFee(platform, category, o.total_cents);
    }
    return totalFees;
  }

  // Fallback: use flat rate on revenue
  return fallbackFeePct > 0 ? Math.round(fallbackRevenueCents * fallbackFeePct / 100) : 0;
}

/** Return YYYY-MM-DD in Pacific time */
function pacificDate(date?: Date | number): string {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export interface SyncResult {
  storeId: string;
  storeName: string;
  synced: number;
  error?: string;
}

export async function syncStore(storeId: string): Promise<SyncResult> {
  const db = getDb();
  const store: any = db.prepare(
    'SELECT * FROM stores WHERE id = ? AND is_active = 1'
  ).get(storeId);

  if (!store) {
    return { storeId, storeName: 'Unknown', synced: 0, error: 'Store not found or inactive' };
  }

  if (!store.shipsourced_client_id) {
    return { storeId, storeName: store.name, synced: 0, error: 'No ShipSourced client ID' };
  }

  let synced = 0;

  try {
    // Fetch billing (shipping/pick-pack/packaging) and orders (revenue/COGS) in parallel
    // Pass sync_start_date (or 2020-01-01) so we get ALL historical daily revenue, not just 30 days
    const fromDate = store.sync_start_date || '2020-01-01';
    const [billing, ordersData] = await Promise.all([
      getClientBilling(store.shipsourced_client_id),
      getClientOrders(store.shipsourced_client_id, fromDate).catch(() => null),
    ]);

    // Build daily revenue/charges map from orders endpoint
    const dailyRevMap: Record<string, { revenue: number; orders: number; charges: number; usCogs: number; chinaCogs: number }> = {};
    if (ordersData?.dailyRevenue) {
      for (const d of ordersData.dailyRevenue) {
        dailyRevMap[d.day] = {
          revenue: Math.round((d.revenue || 0) * 100),
          orders: d.orderCount || 0,
          charges: d.chargesCents || 0,
          usCogs: d.usCogsCents || 0,
          chinaCogs: d.chinaCogsCents || 0,
        };
      }
    }

    // Primary sync from orders endpoint dailyRevenue
    // shipping_cost_cents = ShipSourced fulfillment charges (per-order Charge)
    // cogs_cents = product cost only (usCogs + chinaCogs)
    for (const [day, rev] of Object.entries(dailyRevMap)) {
      // Skip days before sync start date
      if (store.sync_start_date && day < store.sync_start_date) continue;

      const revenueCents = rev.revenue;
      const orderCount = rev.orders;
      const productCost = (rev.usCogs || 0) + (rev.chinaCogs || 0);
      const fulfillmentCharges = rev.charges || 0;

      const existing: any = db.prepare(
        'SELECT id, revenue_cents, ad_spend_cents, shopify_fees_cents, other_costs_cents, chargeback_cents, app_costs_cents, is_confirmed, source FROM daily_pnl WHERE store_id = ? AND date = ?'
      ).get(store.id, day);

      // Auto-calculate platform fees (Amazon/eBay) per-order or flat fallback
      const platformFeePct = store.platform_fee_pct || 0;
      const storeCategory = store.amazon_category || null;

      if (existing) {
        // If source is 'shopify', keep Shopify revenue; otherwise update from ShipSourced
        const useShipSourcedRevenue = existing.source !== 'shopify';
        const effectiveRevenue = useShipSourcedRevenue ? revenueCents : (existing.revenue_cents || 0);
        const effectiveOrders = useShipSourcedRevenue ? orderCount : undefined;
        const adSpend = existing.ad_spend_cents || 0;
        const platformFees = (store.platform === 'amazon' || store.platform === 'ebay')
          ? calculateDailyPlatformFees(db, store.id, day, store.platform, storeCategory, effectiveRevenue, platformFeePct)
          : (existing.shopify_fees_cents || 0);
        const otherCosts = existing.other_costs_cents || 0;
        const chargebacks = existing.chargeback_cents || 0;
        const appCosts = existing.app_costs_cents || 0;
        const totalCosts = productCost + fulfillmentCharges + adSpend + platformFees + otherCosts + chargebacks + appCosts;
        const netProfit = effectiveRevenue - totalCosts;
        const margin = effectiveRevenue > 0 ? (netProfit / effectiveRevenue) * 100 : 0;

        if (useShipSourcedRevenue) {
          db.prepare(`
            UPDATE daily_pnl SET
              revenue_cents = ?, order_count = ?,
              cogs_cents = ?, us_cogs_cents = ?, china_cogs_cents = ?,
              shipping_cost_cents = ?, pick_pack_cents = 0, packaging_cents = 0,
              shopify_fees_cents = ?,
              net_profit_cents = ?, margin_pct = ?, source = 'shipsourced',
              synced_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
          `).run(revenueCents, orderCount, productCost, rev.usCogs, rev.chinaCogs, fulfillmentCharges,
            platformFees, netProfit, margin, existing.id);
        } else {
          db.prepare(`
            UPDATE daily_pnl SET
              cogs_cents = ?, us_cogs_cents = ?, china_cogs_cents = ?,
              shipping_cost_cents = ?, pick_pack_cents = 0, packaging_cents = 0,
              shopify_fees_cents = ?,
              net_profit_cents = ?, margin_pct = ?,
              synced_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
          `).run(productCost, rev.usCogs, rev.chinaCogs, fulfillmentCharges,
            platformFees, netProfit, margin, existing.id);
        }
      } else {
        const platformFees = (store.platform === 'amazon' || store.platform === 'ebay')
          ? calculateDailyPlatformFees(db, store.id, day, store.platform, storeCategory, revenueCents, platformFeePct)
          : 0;
        const totalCosts = productCost + fulfillmentCharges + platformFees;
        const netProfit = revenueCents - totalCosts;
        const margin = revenueCents > 0 ? (netProfit / revenueCents) * 100 : 0;

        db.prepare(`
          INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count, cogs_cents,
            us_cogs_cents, china_cogs_cents,
            shipping_cost_cents, pick_pack_cents, packaging_cents, shopify_fees_cents, net_profit_cents, margin_pct, source, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 'sync', datetime('now'))
        `).run(crypto.randomUUID(), store.id, day, revenueCents, orderCount,
          productCost, rev.usCogs, rev.chinaCogs, fulfillmentCharges,
          platformFees, netProfit, margin);
      }
      synced++;
    }

    // Also sync billing-only days (days with billing data but no orders data)
    if (billing.days) {
      for (const day of billing.days) {
        if (store.sync_start_date && day.date < store.sync_start_date) continue;
        // Skip if already synced from orders data above
        if (dailyRevMap[day.date]) continue;

        // For billing-only days, use totalCharge as COGS (per-SKU total)
        const cogsCents = Math.round((day.totalCharge || 0) * 100);
        const orderCount = day.labelCount || 0;

        const existing: any = db.prepare(
          'SELECT id, revenue_cents, ad_spend_cents, shopify_fees_cents, other_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
        ).get(store.id, day.date);

        if (existing) {
          // Keep existing revenue/orders (from Shopify CSV), only update COGS from billing
          const revenueCents = existing.revenue_cents || 0;
          const adSpend = existing.ad_spend_cents || 0;
          const shopifyFees = existing.shopify_fees_cents || 0;
          const otherCosts = existing.other_costs_cents || 0;
          const totalCosts = cogsCents + adSpend + shopifyFees + otherCosts;
          const netProfit = revenueCents - totalCosts;
          const margin = revenueCents > 0 ? (netProfit / revenueCents) * 100 : 0;

          db.prepare(`
            UPDATE daily_pnl SET
              cogs_cents = ?,
              shipping_cost_cents = 0, pick_pack_cents = 0, packaging_cents = 0,
              net_profit_cents = ?, margin_pct = ?,
              synced_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
          `).run(cogsCents, netProfit, margin, existing.id);
        } else {
          db.prepare(`
            INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count, cogs_cents,
              shipping_cost_cents, pick_pack_cents, packaging_cents, net_profit_cents, margin_pct, source, synced_at)
            VALUES (?, ?, ?, 0, ?, ?, 0, 0, 0, ?, ?, 'sync', datetime('now'))
          `).run(crypto.randomUUID(), store.id, day.date, orderCount,
            cogsCents, -cogsCents, 0);
        }
        synced++;
      }
    }

    // Sync individual payment records from ShipSourced
    if (billing.recentPayments && billing.recentPayments.length > 0) {
      for (const pmt of billing.recentPayments) {
        const extId = pmt.id || pmt.transactionId || null;
        if (!extId) continue;
        const exists = db.prepare('SELECT id FROM ss_payments WHERE store_id = ? AND external_id = ?').get(store.id, String(extId));
        if (!exists) {
          const pmtCents = Math.round((pmt.amount || 0) * 100);
          const pmtDate = pmt.date || pmt.createdAt || new Date().toISOString().slice(0, 10);
          db.prepare(
            'INSERT INTO ss_payments (id, store_id, amount_cents, date, note, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(crypto.randomUUID(), store.id, pmtCents, typeof pmtDate === 'string' ? pmtDate.slice(0, 10) : pmtDate,
            pmt.note || pmt.description || null, 'shipsourced', String(extId));
        }
      }
    }

    // Update ShipSourced billing stats
    // ss_charges_pending_cents = actual billed amount from ShipSourced (combinedPending)
    // ss_total_paid_cents = sum of all ss_payments (manual entries)
    // ss_net_owed_cents = ShipSourced's reported balance (netOwed)
    const ssBilled = Math.round((billing.stats?.combinedPending || 0) * 100);
    const ssNetOwed = Math.round((billing.stats?.netOwed || 0) * 100);
    const totalPaidRow: any = db.prepare(
      'SELECT COALESCE(SUM(amount_cents), 0) as total FROM ss_payments WHERE store_id = ?'
    ).get(store.id);
    const totalPaid = totalPaidRow.total;
    db.prepare(`
      UPDATE stores SET ss_charges_pending_cents = ?, ss_total_paid_cents = ?, ss_net_owed_cents = ?
      WHERE id = ?
    `).run(ssBilled, totalPaid, ssNetOwed, store.id);

    // Update last_synced_at
    db.prepare('UPDATE stores SET last_synced_at = datetime(\'now\') WHERE id = ?').run(store.id);

    return { storeId: store.id, storeName: store.name, synced };
  } catch (err: any) {
    return { storeId: store.id, storeName: store.name, synced, error: err.message };
  }
}

/**
 * Sync Shopify revenue for a store via Shopify Admin API.
 * Sets revenue_cents and order_count in daily_pnl using Shopify's "Total sales" metric
 * (new order revenue - refunds processed that day).
 */
export async function syncShopifyRevenue(storeId: string): Promise<{ synced: number; error?: string }> {
  const db = getDb();
  const store: any = db.prepare('SELECT * FROM stores WHERE id = ? AND is_active = 1').get(storeId);

  if (!store?.shopify_domain || !store?.shopify_access_token) {
    return { synced: 0 };
  }

  try {
    const { getShopifyDailySales } = await import('@/lib/shopify');

    const to = pacificDate();

    // Determine start date: first sync = full history, subsequent = last 7 days
    const hasShopifyData: any = db.prepare(
      "SELECT COUNT(*) as cnt FROM daily_pnl WHERE store_id = ? AND source = 'shopify'"
    ).get(storeId);

    const from = hasShopifyData?.cnt > 0
      ? pacificDate(Date.now() - 7 * 86400000)
      : (store.sync_start_date || pacificDate(Date.now() - 365 * 86400000));

    console.log(`[shopify-sync] ${store.name}: fetching ${from} to ${to}`);
    const dailySales = await getShopifyDailySales(store.shopify_domain, store.shopify_access_token, from, to);

    let synced = 0;

    for (const [date, data] of Object.entries(dailySales)) {
      const existing: any = db.prepare(
        'SELECT id, ad_spend_cents, shopify_fees_cents, other_costs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
      ).get(storeId, date);

      if (existing) {
        const adSpend = existing.ad_spend_cents || 0;
        const shopifyFees = existing.shopify_fees_cents || 0;
        const otherCosts = existing.other_costs_cents || 0;
        const shipping = existing.shipping_cost_cents || 0;
        const pickPack = existing.pick_pack_cents || 0;
        const packaging = existing.packaging_cents || 0;
        const totalCosts = shipping + pickPack + packaging + adSpend + shopifyFees + otherCosts;
        const netProfit = data.netSalesCents - totalCosts;
        const margin = data.netSalesCents > 0 ? (netProfit / data.netSalesCents) * 100 : 0;

        db.prepare(`
          UPDATE daily_pnl SET
            revenue_cents = ?, order_count = ?,
            net_profit_cents = ?, margin_pct = ?,
            source = 'shopify', synced_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(data.netSalesCents, data.orderCount, netProfit, margin, existing.id);
      } else {
        db.prepare(`
          INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count,
            cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents,
            ad_spend_cents, shopify_fees_cents, other_costs_cents,
            net_profit_cents, margin_pct, source, synced_at)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?, 'shopify', datetime('now'))
        `).run(crypto.randomUUID(), storeId, date, data.netSalesCents, data.orderCount,
          data.netSalesCents, data.netSalesCents > 0 ? 100 : 0);
      }
      synced++;
    }

    console.log(`[shopify-sync] ${store.name}: synced ${synced} days`);
    return { synced };
  } catch (err: any) {
    console.error(`[shopify-sync] ${store.name}: ${err.message}`);
    return { synced: 0, error: err.message };
  }
}

export async function syncAllStores(): Promise<{ results: SyncResult[]; logId: string }> {
  const db = getDb();
  const stores: any[] = db.prepare(
    'SELECT id FROM stores WHERE is_active = 1 AND auto_sync = 1 AND shipsourced_client_id IS NOT NULL'
  ).all();

  const logId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO sync_log (id, sync_type, status) VALUES (?, ?, ?)'
  ).run(logId, 'shipsourced_auto', 'running');

  const results: SyncResult[] = [];
  let totalSynced = 0;
  const errors: string[] = [];

  for (const store of stores) {
    // Sync Shopify revenue first (if configured), then ShipSourced fulfillment/COGS
    await syncShopifyRevenue(store.id);
    const result = await syncStore(store.id);
    results.push(result);
    totalSynced += result.synced;
    if (result.error) errors.push(`${result.storeName}: ${result.error}`);
  }

  db.prepare(`
    UPDATE sync_log SET status = ?, records_synced = ?, error_message = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(errors.length > 0 ? 'error' : 'success', totalSynced,
    errors.length > 0 ? errors.join('; ') : null, logId);

  return { results, logId };
}

export function getStaleStores(maxAgeMinutes = 60): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, name, last_synced_at FROM stores
    WHERE is_active = 1 AND auto_sync = 1 AND shipsourced_client_id IS NOT NULL
    AND (last_synced_at IS NULL OR last_synced_at < datetime('now', ?))
  `).all(`-${maxAgeMinutes} minutes`);
}

/**
 * Sync Facebook ad spend for all active profiles.
 * If maxAgeMinutes is provided, only sync profiles not synced in that window.
 */
export async function syncFacebookAds(maxAgeMinutes?: number): Promise<{ synced: number; invoicesImported: number; errors: string[] }> {
  const db = getDb();

  let profiles: any[];
  if (maxAgeMinutes) {
    profiles = db.prepare(`
      SELECT * FROM fb_profiles
      WHERE is_active = 1 AND ad_account_id IS NOT NULL AND access_token IS NOT NULL
      AND (last_sync_at IS NULL OR last_sync_at < datetime('now', ?))
    `).all(`-${maxAgeMinutes} minutes`);
  } else {
    profiles = db.prepare(
      'SELECT * FROM fb_profiles WHERE is_active = 1 AND ad_account_id IS NOT NULL AND access_token IS NOT NULL'
    ).all();
  }

  if (profiles.length === 0) {
    return { synced: 0, invoicesImported: 0, errors: [] };
  }

  let totalSynced = 0;
  let invoicesImported = 0;
  const errors: string[] = [];

  const to = pacificDate();

  for (const profile of profiles) {
    // First sync: pull max history (36 months) or store's sync_start_date. Subsequent: last 30 days.
    // Facebook API limits to 37 months max, so cap at 36 months.
    const store: any = db.prepare('SELECT sync_start_date FROM stores WHERE id = ?').get(profile.store_id);
    const maxHistory = pacificDate(Date.now() - 36 * 30 * 86400000); // ~36 months
    let from = profile.last_sync_at
      ? pacificDate(Date.now() - 30 * 86400000)
      : (store?.sync_start_date || maxHistory);
    if (from < maxHistory) from = maxHistory;
    try {
      // For large date ranges (>90 days), chunk into 90-day windows to avoid FB "too much data" errors
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const daySpan = (toDate.getTime() - fromDate.getTime()) / 86400000;
      let allInsights: any[] = [];
      if (daySpan > 30) {
        let chunkStart = new Date(fromDate);
        while (chunkStart < toDate) {
          const chunkEnd = new Date(Math.min(chunkStart.getTime() + 30 * 86400000, toDate.getTime()));
          const chunkFrom = chunkStart.toISOString().slice(0, 10);
          const chunkTo = chunkEnd.toISOString().slice(0, 10);
          const chunk = await getAdInsights(profile.ad_account_id, profile.access_token, chunkFrom, chunkTo, 'ad');
          allInsights = allInsights.concat(chunk);
          chunkStart = new Date(chunkEnd.getTime() + 86400000);
        }
      } else {
        allInsights = await getAdInsights(profile.ad_account_id, profile.access_token, from, to, 'ad');
      }
      const insights = allInsights;
      const adIds = new Set<string>();

      for (const insight of insights) {
        const date = insight.date_start;
        const spendCents = Math.round(parseFloat(insight.spend || '0') * 100);
        const impressions = parseInt(insight.impressions || '0');
        const clicks = parseInt(insight.clicks || '0');

        let purchases = 0;
        let purchaseValueCents = 0;
        if (insight.actions) {
          for (const action of insight.actions) {
            if (action.action_type === 'purchase') purchases += parseInt(action.value);
          }
        }
        if (insight.action_values) {
          for (const av of insight.action_values) {
            if (av.action_type === 'purchase') purchaseValueCents += Math.round(parseFloat(av.value) * 100);
          }
        }

        const roas = spendCents > 0 ? purchaseValueCents / spendCents : 0;
        const reach = parseInt(insight.reach || '0');
        const frequency = parseFloat(insight.frequency || '0');
        const cpm = parseFloat(insight.cpm || '0');
        const cpc = parseFloat(insight.cpc || '0');
        const ctr = parseFloat(insight.ctr || '0');

        if (insight.ad_id) adIds.add(insight.ad_id);

        const adSetId = insight.adset_id || null;
        const adId = insight.ad_id || null;
        if (adId) {
          db.prepare(`DELETE FROM ad_spend WHERE store_id = ? AND date = ? AND platform = 'facebook' AND campaign_id = ? AND ad_id = ?`)
            .run(profile.store_id, date, insight.campaign_id, adId);
        } else if (adSetId) {
          db.prepare(`DELETE FROM ad_spend WHERE store_id = ? AND date = ? AND platform = 'facebook' AND campaign_id = ? AND ad_set_id = ? AND ad_id IS NULL`)
            .run(profile.store_id, date, insight.campaign_id, adSetId);
        } else {
          db.prepare(`DELETE FROM ad_spend WHERE store_id = ? AND date = ? AND platform = 'facebook' AND campaign_id = ? AND ad_set_id IS NULL AND ad_id IS NULL`)
            .run(profile.store_id, date, insight.campaign_id);
        }

        db.prepare(`
          INSERT INTO ad_spend (id, store_id, date, platform, campaign_id, campaign_name,
            ad_set_id, ad_set_name, ad_id, ad_name, spend_cents, impressions, clicks, purchases,
            purchase_value_cents, roas, reach, frequency, cpm, cpc, ctr, source)
          VALUES (?, ?, ?, 'facebook', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')
        `).run(crypto.randomUUID(), profile.store_id, date,
          insight.campaign_id, insight.campaign_name,
          adSetId, insight.adset_name || null,
          adId, insight.ad_name || null,
          spendCents, impressions, clicks, purchases, purchaseValueCents, roas,
          reach, frequency, cpm, cpc, ctr);

        totalSynced++;
      }

      // Fetch creative context
      if (adIds.size > 0) {
        try {
          const creatives = await getAdCreatives(profile.access_token, Array.from(adIds));
          const videoIdMap = new Map<string, string>();
          for (const c of creatives) {
            if (c.video_id) videoIdMap.set(c.video_id, c.ad_id);
          }

          let videoSourceUrls = new Map<string, string>();
          if (videoIdMap.size > 0) {
            try {
              const pages = await getPages(profile.access_token);
              const pageTokens = pages.map((p: any) => p.access_token).filter(Boolean);
              if (pageTokens.length > 0) {
                videoSourceUrls = await getVideoSourceUrls(pageTokens, Array.from(videoIdMap.keys()));
              }
            } catch {}
          }

          const updateStmt = db.prepare(`
            UPDATE ad_spend SET
              creative_url = COALESCE(?, creative_url),
              ad_headline = ?, ad_body = ?, ad_cta = ?,
              ad_link_url = ?, ad_preview_url = ?, ad_status = ?,
              fb_video_id = COALESCE(?, fb_video_id),
              video_source_url = COALESCE(?, video_source_url)
            WHERE ad_id = ? AND store_id = ?
          `);
          for (const c of creatives) {
            const url = c.thumbnail_url || c.image_url || null;
            const videoSourceUrl = c.video_id ? (videoSourceUrls.get(c.video_id) || null) : null;
            updateStmt.run(url, c.title || null, c.body || null,
              c.call_to_action_type || null, c.link_url || null, c.preview_url || null,
              c.ad_status || null, c.video_id || null, videoSourceUrl,
              c.ad_id, profile.store_id);
          }
        } catch {}
      }

      // Backfill missing video source URLs
      try {
        const missingVideoUrls: any[] = db.prepare(
          'SELECT DISTINCT fb_video_id FROM ad_spend WHERE store_id = ? AND fb_video_id IS NOT NULL AND video_source_url IS NULL'
        ).all(profile.store_id);
        if (missingVideoUrls.length > 0) {
          const pages = await getPages(profile.access_token);
          const pageTokens = pages.map((p: any) => p.access_token).filter(Boolean);
          if (pageTokens.length > 0) {
            const backfilled = await getVideoSourceUrls(pageTokens, missingVideoUrls.map((r: any) => r.fb_video_id));
            const backfillStmt = db.prepare('UPDATE ad_spend SET video_source_url = ? WHERE fb_video_id = ? AND store_id = ?');
            backfilled.forEach((sourceUrl, vid) => backfillStmt.run(sourceUrl, vid, profile.store_id));
          }
        }
      } catch {}

      // Update last sync time
      db.prepare("UPDATE fb_profiles SET last_sync_at = datetime('now') WHERE id = ?").run(profile.id);

      // Roll up into daily_pnl
      const days = db.prepare(`
        SELECT date, SUM(spend_cents) as total FROM ad_spend
        WHERE store_id = ? AND date >= ? AND date <= ? AND platform = 'facebook'
        GROUP BY date
      `).all(profile.store_id, from, to);

      for (const day of days as any[]) {
        const existing: any = db.prepare(
          'SELECT id, revenue_cents, cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, shopify_fees_cents, other_costs_cents, chargeback_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
        ).get(profile.store_id, day.date);
        if (existing) {
          const totalCosts = (existing.cogs_cents || 0) + (existing.shipping_cost_cents || 0) +
            (existing.pick_pack_cents || 0) + (existing.packaging_cents || 0) +
            day.total + (existing.shopify_fees_cents || 0) + (existing.other_costs_cents || 0) +
            (existing.chargeback_cents || 0) + (existing.app_costs_cents || 0);
          const netProfit = (existing.revenue_cents || 0) - totalCosts;
          const margin = existing.revenue_cents > 0 ? (netProfit / existing.revenue_cents) * 100 : 0;
          db.prepare('UPDATE daily_pnl SET ad_spend_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(day.total, netProfit, margin, existing.id);
        } else {
          // Create PNL row with just ad spend if none exists
          const id = require('crypto').randomUUID();
          db.prepare(`
            INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count, cogs_cents,
              shipping_cost_cents, pick_pack_cents, packaging_cents, ad_spend_cents,
              shopify_fees_cents, other_costs_cents, net_profit_cents, margin_pct, source)
            VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, ?, 0, 0, ?, ?, 'fb_sync')
          `).run(id, profile.store_id, day.date, day.total, -day.total, 0);
        }
      }

      // Sync billing charges from FB activities API
      try {
        const chargesFrom = profile.last_sync_at ? from : '2024-01-01';
        const charges = await getBillingCharges(profile.ad_account_id, profile.access_token, chargesFrom);

        // Get ALL payment methods on the account (not just current one)
        const paymentMethods = await getAccountPaymentMethods(profile.ad_account_id, profile.access_token);
        // Build a map: funding_source_id → { display_string, card_last4 }
        const pmById = new Map<string, { display_string: string; card_last4: string }>();
        for (const pm of paymentMethods) {
          if (pm.id && pm.card_last4) {
            pmById.set(pm.id, { display_string: pm.display_string, card_last4: pm.card_last4 });
          }
        }

        // If there's only ONE payment method on the account, we know all charges used it
        const singleCard = paymentMethods.length === 1 && paymentMethods[0].card_last4
          ? { display_string: paymentMethods[0].display_string, card_last4: paymentMethods[0].card_last4 }
          : null;

        for (const charge of charges) {
          const existingPayment = db.prepare('SELECT id FROM ad_payments WHERE transaction_id = ?').get(charge.transaction_id);
          if (existingPayment) continue;

          // Try to determine which card was used for this specific charge:
          // 1. If the charge has a funding_source_id, match it to a payment method
          // 2. If only one payment method exists on the account, use that
          // 3. Otherwise, leave card as null (unknown) — CSV import can fill it later
          let chargePaymentMethod = '';
          let chargeCardLast4 = '';
          if (charge.funding_source_id && pmById.has(charge.funding_source_id)) {
            const pm = pmById.get(charge.funding_source_id)!;
            chargePaymentMethod = pm.display_string;
            chargeCardLast4 = pm.card_last4;
          } else if (singleCard) {
            chargePaymentMethod = singleCard.display_string;
            chargeCardLast4 = singleCard.card_last4;
          }
          // If neither condition met, card_last4 stays empty — much better than wrong card

          db.prepare(`
            INSERT INTO ad_payments (id, store_id, platform, date, transaction_id, payment_method, card_last4, amount_cents, currency, status, account_id)
            VALUES (?, ?, 'facebook', ?, ?, ?, ?, ?, ?, 'paid', ?)
          `).run(crypto.randomUUID(), profile.store_id, charge.date,
            charge.transaction_id, chargePaymentMethod || null, chargeCardLast4 || null,
            charge.amount_cents, charge.currency, profile.ad_account_id);
          invoicesImported++;
        }
      } catch (invoiceErr: any) {
        errors.push(`Invoices for ${profile.profile_name}: ${invoiceErr.message}`);
      }
    } catch (err: any) {
      errors.push(`Profile ${profile.profile_name}: ${err.message}`);
    }

    // Always rollup ad_spend → daily_pnl even if ad-level sync failed
    try {
      const rollupDays = db.prepare(`
        SELECT date, SUM(spend_cents) as total FROM ad_spend
        WHERE store_id = ? AND date >= ? AND date <= ? AND platform = 'facebook'
        GROUP BY date
      `).all(profile.store_id, from, to);

      for (const day of rollupDays as any[]) {
        const existing: any = db.prepare(
          'SELECT id, revenue_cents, cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, shopify_fees_cents, other_costs_cents, chargeback_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
        ).get(profile.store_id, day.date);
        if (existing) {
          const totalCosts = (existing.cogs_cents || 0) + (existing.shipping_cost_cents || 0) + (existing.pick_pack_cents || 0) + (existing.packaging_cents || 0) +
            day.total + (existing.shopify_fees_cents || 0) + (existing.other_costs_cents || 0) +
            (existing.chargeback_cents || 0) + (existing.app_costs_cents || 0);
          const netProfit = (existing.revenue_cents || 0) - totalCosts;
          const margin = existing.revenue_cents > 0 ? (netProfit / existing.revenue_cents) * 100 : 0;
          db.prepare("UPDATE daily_pnl SET ad_spend_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now') WHERE id = ?")
            .run(day.total, netProfit, margin, existing.id);
        }
      }
    } catch {}
  }

  return { synced: totalSynced, invoicesImported, errors };
}
