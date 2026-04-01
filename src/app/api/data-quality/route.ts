import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();

  // Use Pacific time for "today"
  const pacificNow = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const pacificYesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  // Current UTC hour for staleness checks
  const utcHour = new Date().getUTCHours();

  const issues: {
    id: string;
    severity: 'critical' | 'warning' | 'info';
    category: string;
    store_id: string;
    store_name: string;
    title: string;
    detail: string;
    action: string;
    link?: string;
  }[] = [];

  const stores: any[] = db.prepare('SELECT * FROM stores WHERE is_active = 1').all();

  for (const store of stores) {
    // 1. Missing SS charges on orders
    const missingCharges: any = db.prepare(`
      SELECT COUNT(*) as cnt FROM orders
      WHERE store_id = ? AND (ss_charge_cents = 0 OR ss_charge_cents IS NULL)
      AND source = 'shipsourced'
    `).get(store.id);

    if (missingCharges.cnt > 0) {
      issues.push({
        id: `missing-ss-${store.id}`,
        severity: missingCharges.cnt > 10 ? 'critical' : 'warning',
        category: 'Missing Data',
        store_id: store.id,
        store_name: store.name,
        title: `${missingCharges.cnt} orders missing SS charges`,
        detail: `Orders from ShipSourced without fulfillment charges — profit calculations are inaccurate.`,
        action: 'Re-pull orders from ShipSourced',
        link: `/dashboard/stores/${store.id}`,
      });
    }

    // 2. Ad spend at $0 today when store has FB profile
    const fbProfile: any = db.prepare(
      'SELECT id, profile_name, last_sync_at FROM fb_profiles WHERE store_id = ? AND is_active = 1'
    ).get(store.id);

    if (fbProfile) {
      const todayAd: any = db.prepare(
        "SELECT SUM(spend_cents) as total FROM ad_spend WHERE store_id = ? AND date = ? AND platform = 'facebook'"
      ).get(store.id, pacificNow);

      // Only flag if it's past 10am Pacific (UTC hour >= 17) and spend is still $0
      if ((!todayAd || !todayAd.total || todayAd.total === 0) && utcHour >= 17) {
        // Check if yesterday had ad spend (to confirm ads are normally running)
        const yesterdayAd: any = db.prepare(
          "SELECT SUM(spend_cents) as total FROM ad_spend WHERE store_id = ? AND date = ? AND platform = 'facebook'"
        ).get(store.id, pacificYesterday);

        if (yesterdayAd?.total > 0) {
          issues.push({
            id: `zero-ads-${store.id}`,
            severity: 'critical',
            category: 'Ad Spend',
            store_id: store.id,
            store_name: store.name,
            title: `Ad spend is $0 today`,
            detail: `Yesterday had $${(yesterdayAd.total / 100).toFixed(2)} in spend. Ads may be paused or FB sync broken.`,
            action: 'Check Facebook Ads Manager or re-sync',
            link: `/dashboard/ads`,
          });
        }
      }

      // 3. FB sync stale (>2 hours)
      if (fbProfile.last_sync_at) {
        const lastSync = new Date(fbProfile.last_sync_at + 'Z');
        const hoursSince = (Date.now() - lastSync.getTime()) / 3600000;
        if (hoursSince > 2) {
          issues.push({
            id: `stale-fb-${store.id}`,
            severity: 'warning',
            category: 'Sync',
            store_id: store.id,
            store_name: store.name,
            title: `FB ad sync stale (${Math.floor(hoursSince)}h ago)`,
            detail: `Last synced: ${fbProfile.last_sync_at}. Ad data may be outdated.`,
            action: 'Check FB token or trigger manual sync',
            link: `/dashboard/ads/connect`,
          });
        }
      }
    }

    // 4. Store has no FB profile but other stores do (might be missing)
    if (!fbProfile) {
      const hasAdSpendHistory: any = db.prepare(
        "SELECT COUNT(*) as cnt FROM ad_spend WHERE store_id = ? AND platform = 'facebook'"
      ).get(store.id);

      // If store previously had ad spend but no profile now, flag it
      if (hasAdSpendHistory.cnt > 0) {
        issues.push({
          id: `no-fb-profile-${store.id}`,
          severity: 'warning',
          category: 'Ad Spend',
          store_id: store.id,
          store_name: store.name,
          title: `No FB ad account linked`,
          detail: `Store has ${hasAdSpendHistory.cnt} historical ad records but no active FB profile. New ad spend won't sync.`,
          action: 'Connect Facebook ad account',
          link: `/dashboard/ads/connect`,
        });
      }
    }

    // 5. Revenue at $0 today but had revenue yesterday (sync may be broken)
    if (store.shipsourced_client_id && utcHour >= 17) {
      const todayRev: any = db.prepare(
        'SELECT revenue_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
      ).get(store.id, pacificNow);

      const yesterdayRev: any = db.prepare(
        'SELECT revenue_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
      ).get(store.id, pacificYesterday);

      if ((!todayRev || todayRev.revenue_cents === 0) && yesterdayRev?.revenue_cents > 5000) {
        issues.push({
          id: `zero-rev-${store.id}`,
          severity: 'warning',
          category: 'Revenue',
          store_id: store.id,
          store_name: store.name,
          title: `No revenue today`,
          detail: `Yesterday had $${(yesterdayRev.revenue_cents / 100).toFixed(2)}. ShipSourced sync may have failed.`,
          action: 'Check ShipSourced sync or trigger manual sync',
          link: `/dashboard/stores/${store.id}`,
        });
      }
    }

    // 6. Store sync stale (>2 hours)
    if (store.shipsourced_client_id && store.last_synced_at) {
      const lastSync = new Date(store.last_synced_at + 'Z');
      const hoursSince = (Date.now() - lastSync.getTime()) / 3600000;
      if (hoursSince > 2) {
        issues.push({
          id: `stale-sync-${store.id}`,
          severity: 'warning',
          category: 'Sync',
          store_id: store.id,
          store_name: store.name,
          title: `Store sync stale (${Math.floor(hoursSince)}h ago)`,
          detail: `Last synced: ${store.last_synced_at}. Revenue and fulfillment data may be outdated.`,
          action: 'Trigger manual sync',
          link: `/dashboard/settings`,
        });
      }
    }

    // 7. Platform fee not configured for Amazon/eBay stores
    if ((store.platform === 'amazon' || store.platform === 'ebay') && (!store.platform_fee_pct || store.platform_fee_pct === 0)) {
      issues.push({
        id: `no-platform-fee-${store.id}`,
        severity: 'warning',
        category: 'Config',
        store_id: store.id,
        store_name: store.name,
        title: `No platform fee configured`,
        detail: `${store.platform} store without referral fee — profit is overstated.`,
        action: 'Set platform fee percentage in settings',
        link: `/dashboard/stores/${store.id}`,
      });
    }

    // 8. Negative profit for 3+ consecutive days
    const recentPnl: any[] = db.prepare(
      'SELECT date, net_profit_cents FROM daily_pnl WHERE store_id = ? ORDER BY date DESC LIMIT 3'
    ).all(store.id);

    if (recentPnl.length >= 3 && recentPnl.every(r => r.net_profit_cents < 0)) {
      issues.push({
        id: `neg-profit-${store.id}`,
        severity: 'info',
        category: 'Profitability',
        store_id: store.id,
        store_name: store.name,
        title: `Negative profit 3+ days straight`,
        detail: `Last 3 days all show losses. May indicate data issue or actual performance problem.`,
        action: 'Review cost breakdown and verify data accuracy',
        link: `/dashboard/stores/${store.id}`,
      });
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Summary stats
  const summary = {
    total: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
    stores_checked: stores.length,
  };

  return NextResponse.json({ issues, summary });
}
