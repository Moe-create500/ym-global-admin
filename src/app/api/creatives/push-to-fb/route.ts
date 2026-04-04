import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  getCampaigns,
  getAdSets,
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  uploadVideoFromBuffer,
  checkVideoProcessingStatus,
  getPages,
} from '@/lib/facebook';
import { readFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/creatives/push-to-fb?storeId=...&campaignId=...
 *
 * Lists FB campaigns (if no campaignId) or ad sets (if campaignId provided)
 */
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const campaignId = req.nextUrl.searchParams.get('campaignId');

  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  const db = getDb();
  const profile: any = db.prepare(
    'SELECT * FROM fb_profiles WHERE store_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1'
  ).get(storeId);

  if (!profile || !profile.access_token) {
    return NextResponse.json({ error: 'No Facebook account connected. Go to Ads > Connect first.' }, { status: 400 });
  }

  if (!profile.ad_account_id) {
    return NextResponse.json({ error: 'No ad account selected. Go to Ads > Connect to select one.' }, { status: 400 });
  }

  try {
    if (campaignId) {
      const adsets = await getAdSets(campaignId, profile.access_token);
      return NextResponse.json({ adsets });
    } else {
      const campaigns = await getCampaigns(profile.ad_account_id, profile.access_token);
      return NextResponse.json({ campaigns, profile: { pageId: profile.fb_page_id, pixelId: profile.pixel_id } });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/creatives/push-to-fb
 *
 * Full push flow: download video → upload to FB → create campaign/adset/creative/ad
 */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    creativeId, storeId,
    campaignMode, existingCampaignId, newCampaign,
    adSetMode, existingAdSetId, newAdSet,
    headline, primaryText, ctaType, landingPageUrl, adStatus,
  } = body;

  if (!creativeId || !storeId) {
    return NextResponse.json({ error: 'creativeId and storeId are required' }, { status: 400 });
  }
  if (!headline || !landingPageUrl) {
    return NextResponse.json({ error: 'headline and landingPageUrl are required' }, { status: 400 });
  }

  const db = getDb();

  // Load creative
  const creative: any = db.prepare('SELECT * FROM creatives WHERE id = ?').get(creativeId);
  if (!creative) {
    return NextResponse.json({ error: 'Creative not found' }, { status: 404 });
  }
  if (creative.nb_status !== 'completed' || !creative.file_url) {
    return NextResponse.json({ error: 'Creative video is not ready yet' }, { status: 400 });
  }

  // Load FB profile
  const profile: any = db.prepare(
    'SELECT * FROM fb_profiles WHERE store_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1'
  ).get(storeId);

  if (!profile?.access_token) {
    return NextResponse.json({ error: 'No Facebook account connected. Go to Ads > Connect.' }, { status: 400 });
  }
  if (!profile.ad_account_id) {
    return NextResponse.json({ error: 'No ad account selected. Go to Ads > Connect.' }, { status: 400 });
  }
  if (!profile.fb_page_id) {
    // Auto-resolve: fetch first available page and save it
    try {
      const pages = await getPages(profile.access_token);
      if (pages.length > 0) {
        profile.fb_page_id = pages[0].id;
        db.prepare('UPDATE fb_profiles SET fb_page_id = ?, fb_page_name = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(pages[0].id, pages[0].name, profile.id);
        console.log(`[PUSH-TO-FB] Auto-resolved FB page: ${pages[0].name} (${pages[0].id})`);
      } else {
        return NextResponse.json({ error: 'No Facebook Page found on this account. Create a Page in Facebook first.' }, { status: 400 });
      }
    } catch (err: any) {
      return NextResponse.json({ error: `Failed to fetch Facebook Pages: ${err.message}` }, { status: 400 });
    }
  }

  const adAccountId = profile.ad_account_id.startsWith('act_')
    ? profile.ad_account_id
    : `act_${profile.ad_account_id}`;

  try {
    // ── Step 1: Download video to buffer ──
    console.log(`[PUSH-TO-FB] Starting for creative ${creativeId}`);
    let videoBuffer: Buffer;

    const fileUrl = creative.file_url;

    // Check for auto-finalized local file first
    let templateData: any = {};
    try { templateData = JSON.parse(creative.template_data || '{}'); } catch {}

    if (fileUrl.startsWith('/api/products/uploads?file=')) {
      // Local file — read from disk
      const filename = new URL(fileUrl, 'http://localhost').searchParams.get('file');
      if (!filename) throw new Error('Invalid local file URL');
      const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
      videoBuffer = await readFile(filePath);
      console.log(`[PUSH-TO-FB] Read local file: ${filename} (${videoBuffer.length} bytes)`);
    } else if (fileUrl.includes('api.openai.com')) {
      // Sora URL — needs OpenAI auth
      const res = await fetch(fileUrl, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      });
      if (!res.ok) throw new Error('Sora video URL expired or inaccessible. Try re-generating the video.');
      videoBuffer = Buffer.from(await res.arrayBuffer());
      console.log(`[PUSH-TO-FB] Downloaded Sora video (${videoBuffer.length} bytes)`);
    } else {
      // External URL (Veo, Runway, etc.)
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`Failed to download video: ${res.status}`);
      videoBuffer = Buffer.from(await res.arrayBuffer());
      console.log(`[PUSH-TO-FB] Downloaded external video (${videoBuffer.length} bytes)`);
    }

    // ── Step 2: Upload video to Facebook ──
    console.log(`[PUSH-TO-FB] Uploading video to FB ad account ${adAccountId}...`);
    const fbVideoResult = await uploadVideoFromBuffer(
      adAccountId,
      profile.access_token,
      videoBuffer,
      headline,
      creative.description?.substring(0, 500) || ''
    );
    const fbVideoId = fbVideoResult.id;
    console.log(`[PUSH-TO-FB] FB video uploaded: ${fbVideoId}`);

    // ── Step 3: Wait for FB video processing ──
    let videoReady = false;
    for (let attempt = 0; attempt < 18; attempt++) { // max 90 seconds
      await new Promise(r => setTimeout(r, 5000));
      try {
        const status = await checkVideoProcessingStatus(fbVideoId, profile.access_token);
        if (status.status === 'ready') {
          videoReady = true;
          break;
        }
        console.log(`[PUSH-TO-FB] Video processing: ${status.status} (attempt ${attempt + 1})`);
      } catch {}
    }

    if (!videoReady) {
      // Continue anyway — FB often allows creative creation before video is fully processed
      console.log('[PUSH-TO-FB] Video still processing, continuing with creative creation...');
    }

    // ── Step 4: Create or select campaign ──
    let fbCampaignId: string;
    if (campaignMode === 'existing' && existingCampaignId) {
      fbCampaignId = existingCampaignId;
      console.log(`[PUSH-TO-FB] Using existing campaign: ${fbCampaignId}`);
    } else if (newCampaign?.name) {
      const campaign = await createCampaign(adAccountId, profile.access_token, {
        name: newCampaign.name,
        objective: newCampaign.objective || 'OUTCOME_SALES',
        status: adStatus || 'PAUSED',
        specialAdCategories: [],
      });
      fbCampaignId = campaign.id;
      console.log(`[PUSH-TO-FB] Created campaign: ${fbCampaignId}`);
    } else {
      return NextResponse.json({ error: 'No campaign selected or created' }, { status: 400 });
    }

    // ── Step 5: Create or select ad set ──
    let fbAdSetId: string;
    if (adSetMode === 'existing' && existingAdSetId) {
      fbAdSetId = existingAdSetId;
      console.log(`[PUSH-TO-FB] Using existing ad set: ${fbAdSetId}`);
    } else if (newAdSet?.name) {
      const countries = newAdSet.countries || ['US'];
      const adSet = await createAdSet(adAccountId, profile.access_token, {
        name: newAdSet.name,
        campaignId: fbCampaignId,
        dailyBudgetCents: newAdSet.dailyBudgetCents || 2000,
        targeting: {
          geo_locations: { countries },
        },
        optimizationGoal: newAdSet.optimizationGoal || 'OFFSITE_CONVERSIONS',
        billingEvent: 'IMPRESSIONS',
        status: adStatus || 'PAUSED',
        pixelId: profile.pixel_id || undefined,
        customEventType: profile.pixel_id ? 'PURCHASE' : undefined,
      });
      fbAdSetId = adSet.id;
      console.log(`[PUSH-TO-FB] Created ad set: ${fbAdSetId}`);
    } else {
      return NextResponse.json({ error: 'No ad set selected or created' }, { status: 400 });
    }

    // ── Step 6: Create ad creative ──
    const fbCreative = await createAdCreative(adAccountId, profile.access_token, {
      name: `${headline} - Creative`,
      pageId: profile.fb_page_id,
      videoId: fbVideoId,
      title: headline,
      message: primaryText || '',
      ctaType: ctaType || 'SHOP_NOW',
      ctaLink: landingPageUrl,
    });
    console.log(`[PUSH-TO-FB] Created ad creative: ${fbCreative.id}`);

    // ── Step 7: Create the ad ──
    const fbAd = await createAd(adAccountId, profile.access_token, {
      name: headline,
      adsetId: fbAdSetId,
      creativeId: fbCreative.id,
      status: adStatus || 'PAUSED',
    });
    console.log(`[PUSH-TO-FB] Created ad: ${fbAd.id}`);

    // ── Step 8: Update local records ──
    db.prepare('UPDATE creatives SET fb_video_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(fbVideoId, creativeId);

    db.prepare(`
      INSERT INTO fb_ads (id, store_id, creative_id, fb_ad_id, fb_creative_id, fb_video_id,
        fb_campaign_id, fb_ad_set_id, name, headline, primary_text, cta_type, landing_page_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), storeId, creativeId, fbAd.id, fbCreative.id, fbVideoId,
      fbCampaignId, fbAdSetId, headline, headline, primaryText || '', ctaType || 'SHOP_NOW',
      landingPageUrl, adStatus || 'PAUSED'
    );

    console.log(`[PUSH-TO-FB] Complete! Ad ${fbAd.id} created in campaign ${fbCampaignId}`);

    return NextResponse.json({
      success: true,
      fbVideoId,
      fbCreativeId: fbCreative.id,
      fbAdId: fbAd.id,
      fbCampaignId,
      fbAdSetId,
    });
  } catch (err: any) {
    console.error(`[PUSH-TO-FB] Error: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
