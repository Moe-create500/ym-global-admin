import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { syncFacebookAds } from '@/lib/sync';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { storeId, profileId, dateFrom, dateTo } = await req.json();

  const db = getDb();

  // For manual sync with specific params, use the shared function
  // If specific profileId/storeId/dates provided, we still support that
  // but route through the shared sync function for simplicity
  if (!profileId && !dateFrom && !dateTo) {
    // Simple case: sync all (or by storeId) — use shared function
    const result = await syncFacebookAds();

    const logId = crypto.randomUUID();
    db.prepare('INSERT INTO sync_log (id, sync_type, store_id, status, records_synced, completed_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))')
      .run(logId, 'facebook_ads', storeId || null, result.errors.length > 0 ? 'error' : 'success', result.synced);

    return NextResponse.json({
      success: true,
      synced: result.synced,
      invoicesImported: result.invoicesImported,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  }

  // Advanced case with specific profile/date params — keep original logic
  const { getAdInsights, getAdCreatives, getBillingCharges, getFundingSource, getVideoSourceUrls, getPages } = await import('@/lib/facebook');

  let profiles: any[];
  if (profileId) {
    const p = db.prepare('SELECT * FROM fb_profiles WHERE id = ? AND is_active = 1').get(profileId);
    profiles = p ? [p] : [];
  } else if (storeId) {
    profiles = db.prepare('SELECT * FROM fb_profiles WHERE store_id = ? AND is_active = 1').all(storeId);
  } else {
    profiles = db.prepare('SELECT * FROM fb_profiles WHERE is_active = 1 AND ad_account_id IS NOT NULL').all();
  }

  if (profiles.length === 0) {
    return NextResponse.json({ error: 'No active Facebook profiles found' }, { status: 404 });
  }

  const logId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO sync_log (id, sync_type, store_id, status) VALUES (?, ?, ?, ?)'
  ).run(logId, 'facebook_ads', storeId || null, 'running');

  let totalSynced = 0;
  let invoicesImported = 0;
  const errors: string[] = [];

  const pacificDate = (d?: number) => (d ? new Date(d) : new Date()).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const from = dateFrom || pacificDate(Date.now() - 30 * 86400000);
  const to = dateTo || pacificDate();

  for (const profile of profiles) {
    if (!profile.ad_account_id || !profile.access_token) continue;

    try {
      const insights = await getAdInsights(profile.ad_account_id, profile.access_token, from, to, 'ad');
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
              const pageTokens = pages.map(p => p.access_token).filter(Boolean);
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

      try {
        const missingVideoUrls: any[] = db.prepare(
          'SELECT DISTINCT fb_video_id FROM ad_spend WHERE store_id = ? AND fb_video_id IS NOT NULL AND video_source_url IS NULL'
        ).all(profile.store_id);
        if (missingVideoUrls.length > 0) {
          const pages = await getPages(profile.access_token);
          const pageTokens = pages.map(p => p.access_token).filter(Boolean);
          if (pageTokens.length > 0) {
            const backfilled = await getVideoSourceUrls(pageTokens, missingVideoUrls.map((r: any) => r.fb_video_id));
            const backfillStmt = db.prepare('UPDATE ad_spend SET video_source_url = ? WHERE fb_video_id = ? AND store_id = ?');
            backfilled.forEach((sourceUrl, vid) => backfillStmt.run(sourceUrl, vid, profile.store_id));
          }
        }
      } catch {}

      db.prepare('UPDATE fb_profiles SET last_sync_at = datetime(\'now\') WHERE id = ?').run(profile.id);

      const days = db.prepare(`
        SELECT date, SUM(spend_cents) as total FROM ad_spend
        WHERE store_id = ? AND date >= ? AND date <= ? AND platform = 'facebook' AND ad_id IS NOT NULL
        GROUP BY date
      `).all(profile.store_id, from, to);

      for (const day of days as any[]) {
        const existing: any = db.prepare(
          'SELECT id, revenue_cents, cogs_cents, shipping_cost_cents, pick_pack_cents, packaging_cents, shopify_fees_cents, other_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
        ).get(profile.store_id, day.date);
        if (existing) {
          const totalCosts = (existing.cogs_cents || 0) + (existing.shipping_cost_cents || 0) +
            (existing.pick_pack_cents || 0) + (existing.packaging_cents || 0) +
            day.total + (existing.shopify_fees_cents || 0) + (existing.other_costs_cents || 0);
          const netProfit = (existing.revenue_cents || 0) - totalCosts;
          const margin = existing.revenue_cents > 0 ? (netProfit / existing.revenue_cents) * 100 : 0;
          db.prepare('UPDATE daily_pnl SET ad_spend_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(day.total, netProfit, margin, existing.id);
        }
      }

      try {
        const charges = await getBillingCharges(profile.ad_account_id, profile.access_token, from);
        const fundingSource = await getFundingSource(profile.ad_account_id, profile.access_token);
        const paymentMethod = fundingSource?.display_string || '';
        const cardMatch = paymentMethod.match(/(\d{4})\s*$/);
        const cardLast4 = cardMatch ? cardMatch[1] : '';

        for (const charge of charges) {
          const existing = db.prepare('SELECT id FROM ad_payments WHERE transaction_id = ?').get(charge.transaction_id);
          if (existing) continue;
          db.prepare(`
            INSERT INTO ad_payments (id, store_id, platform, date, transaction_id, payment_method, card_last4, amount_cents, currency, status, account_id)
            VALUES (?, ?, 'facebook', ?, ?, ?, ?, ?, ?, 'paid', ?)
          `).run(crypto.randomUUID(), profile.store_id, charge.date,
            charge.transaction_id, paymentMethod, cardLast4,
            charge.amount_cents, charge.currency, profile.ad_account_id);
          invoicesImported++;
        }
      } catch (invoiceErr: any) {
        errors.push(`Invoices for ${profile.profile_name}: ${invoiceErr.message}`);
      }
    } catch (err: any) {
      errors.push(`Profile ${profile.profile_name}: ${err.message}`);
    }
  }

  db.prepare(`
    UPDATE sync_log SET status = ?, records_synced = ?, error_message = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(errors.length > 0 ? 'error' : 'success', totalSynced,
    errors.length > 0 ? errors.join('; ') : null, logId);

  return NextResponse.json({
    success: true,
    synced: totalSynced,
    invoicesImported,
    profiles: profiles.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
