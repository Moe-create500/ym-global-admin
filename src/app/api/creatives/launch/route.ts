/**
 * POST /api/creatives/launch
 *
 * Launch creatives into Meta Ads with ABO structure:
 *   Campaign (ABO, no CBO)
 *     → Ad Set per concept ($30/day)
 *       → Ads = variations of that concept
 *
 * Required body:
 * {
 *   storeId: string,
 *   profileId: string,        // fb_profiles.id — which ad account to use
 *   packages: [               // grouped by concept
 *     {
 *       concept: string,      // concept/angle name → becomes ad set name
 *       creatives: [          // creatives in this concept → become ads
 *         {
 *           id: string,       // creatives.id
 *           title: string,
 *           headline: string,
 *           primaryText: string,
 *           imageUrl: string,
 *           linkUrl: string,
 *           callToAction?: string,
 *         }
 *       ]
 *     }
 *   ],
 *   campaignName?: string,
 *   dailyBudget?: number,      // cents per ad set, default 3000 ($30)
 *   status?: 'PAUSED' | 'ACTIVE',
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';
import {
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  uploadAdImage,
  uploadVideoFromBuffer,
  checkVideoProcessingStatus,
  getAdSets,
} from '@/lib/facebook';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5min — only matters if someone awaits; POST returns immediately

function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}
function jsonError(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

// ═══ In-memory launch job tracker ═══
// Survives across requests within the same PM2 process.
// Cleaned up automatically when over 100 jobs.
interface LaunchJob {
  id: string;
  status: 'queued' | 'launching' | 'completed' | 'failed' | 'partial';
  progress: string;
  startedAt: number;
  completedAt?: number;
  campaign?: { id: string; name: string };
  adSets: {
    concept: string;
    adSetId: string;
    ads: { adId: string; creativeId: string; name: string; imageHash: string }[];
    errors: string[];
  }[];
  summary?: any;
  error?: string;
  errorDetails?: any;
}
const launchJobs = new Map<string, LaunchJob>();

setInterval(() => {
  if (launchJobs.size > 100) {
    const keys = Array.from(launchJobs.keys());
    for (let i = 0; i < keys.length - 50; i++) {
      launchJobs.delete(keys[i]);
    }
  }
}, 60000);

/**
 * GET /api/creatives/launch?storeId=xxx                          → FB profile list
 * GET /api/creatives/launch?jobId=xxx                            → launch job status
 * GET /api/creatives/launch?profileId=xxx&pages=1                → accessible pages
 * GET /api/creatives/launch?profileId=xxx&campaigns=1            → campaigns in ad account
 * GET /api/creatives/launch?profileId=xxx&adsets=1&campaignId=xxx → ad sets in campaign
 */
export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get('jobId');
    const pagesQuery = req.nextUrl.searchParams.get('pages');
    const campaignsQuery = req.nextUrl.searchParams.get('campaigns');
    const adsetsQuery = req.nextUrl.searchParams.get('adsets');
    const profileIdQuery = req.nextUrl.searchParams.get('profileId');
    const campaignIdQuery = req.nextUrl.searchParams.get('campaignId');

    // Job status polling
    if (jobId) {
      const job = launchJobs.get(jobId);
      if (!job) {
        return jsonError('JOB_NOT_FOUND', 'Launch job not found (may have expired)', null, 404);
      }
      return jsonSuccess({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        campaign: job.campaign,
        adSets: job.adSets,
        summary: job.summary,
        error: job.error,
        errorDetails: job.errorDetails,
        elapsedMs: (job.completedAt || Date.now()) - job.startedAt,
      });
    }

    // Campaigns in ad account (for scale mode — pick an existing campaign to add to)
    if (campaignsQuery && profileIdQuery) {
      let db: any;
      try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }
      const profile: any = db.prepare(
        'SELECT id, ad_account_id, access_token FROM fb_profiles WHERE id = ? AND is_active = 1'
      ).get(profileIdQuery);
      if (!profile) return jsonError('PROFILE_NOT_FOUND', 'Profile not found', null, 404);
      if (!profile.access_token || !profile.ad_account_id) return jsonError('NO_TOKEN', 'Missing token or ad account', null, 400);
      try {
        const res = await fetch(`https://graph.facebook.com/v24.0/${profile.ad_account_id}/campaigns?fields=id,name,status,objective,created_time&limit=100&access_token=${profile.access_token}`);
        const data = await res.json();
        if (data.error) return jsonError('CAMPAIGNS_FETCH_FAILED', data.error.message || 'Failed to fetch campaigns', data.error, 400);
        const campaigns = (data.data || [])
          .filter((c: any) => c.status !== 'DELETED' && c.status !== 'ARCHIVED')
          .sort((a: any, b: any) => (b.created_time || '').localeCompare(a.created_time || ''));
        return jsonSuccess({ campaigns });
      } catch (e: any) {
        return jsonError('CAMPAIGNS_FETCH_FAILED', `Failed to fetch campaigns: ${e.message}`, null, 500);
      }
    }

    // Ad sets in a campaign (for scale mode — match concept → existing ad set)
    if (adsetsQuery && profileIdQuery && campaignIdQuery) {
      let db: any;
      try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }
      const profile: any = db.prepare(
        'SELECT id, access_token FROM fb_profiles WHERE id = ? AND is_active = 1'
      ).get(profileIdQuery);
      if (!profile) return jsonError('PROFILE_NOT_FOUND', 'Profile not found', null, 404);
      if (!profile.access_token) return jsonError('NO_TOKEN', 'Missing token', null, 400);
      try {
        const res = await fetch(`https://graph.facebook.com/v24.0/${campaignIdQuery}/adsets?fields=id,name,status,daily_budget&limit=200&access_token=${profile.access_token}`);
        const data = await res.json();
        if (data.error) return jsonError('ADSETS_FETCH_FAILED', data.error.message || 'Failed to fetch ad sets', data.error, 400);
        // Also fetch ad counts per ad set so we can warn about max creatives
        const adsets = (data.data || []).filter((a: any) => a.status !== 'DELETED' && a.status !== 'ARCHIVED');

        // Fetch ad counts in parallel (best-effort — skip if fails)
        const withCounts = await Promise.all(adsets.map(async (a: any) => {
          try {
            const adsRes = await fetch(`https://graph.facebook.com/v24.0/${a.id}/ads?fields=id,effective_status&limit=50&access_token=${profile.access_token}`);
            const adsData = await adsRes.json();
            const allAds = adsData.data || [];
            const activeAds = allAds.filter((ad: any) => ad.effective_status !== 'DELETED' && ad.effective_status !== 'ARCHIVED');
            return { ...a, adCount: activeAds.length };
          } catch {
            return { ...a, adCount: 0 };
          }
        }));

        return jsonSuccess({ adsets: withCounts });
      } catch (e: any) {
        return jsonError('ADSETS_FETCH_FAILED', `Failed to fetch ad sets: ${e.message}`, null, 500);
      }
    }

    // Pages accessible by this profile's token
    if (pagesQuery && profileIdQuery) {
      let db: any;
      try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

      const profile: any = db.prepare(
        'SELECT id, fb_page_id, fb_page_name, access_token FROM fb_profiles WHERE id = ? AND is_active = 1'
      ).get(profileIdQuery);

      if (!profile) return jsonError('PROFILE_NOT_FOUND', 'Profile not found', null, 404);
      if (!profile.access_token) return jsonError('NO_TOKEN', 'No access token for this profile', null, 400);

      try {
        const res = await fetch(`https://graph.facebook.com/v24.0/me/accounts?fields=id,name,access_token,tasks&limit=200&access_token=${profile.access_token}`);
        const data = await res.json();
        if (data.error) {
          return jsonError('PAGES_FETCH_FAILED', data.error.message || 'Failed to fetch pages', data.error, 400);
        }
        // Return list without access_token (sensitive)
        const pages = (data.data || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          canCreateAds: (p.tasks || []).includes('MANAGE') || (p.tasks || []).includes('ADVERTISE') || (p.tasks || []).includes('CREATE_CONTENT'),
        }));
        return jsonSuccess({
          pages,
          currentPageId: profile.fb_page_id || null,
          currentPageName: profile.fb_page_name || null,
        });
      } catch (e: any) {
        return jsonError('PAGES_FETCH_FAILED', `Failed to fetch pages: ${e.message}`, null, 500);
      }
    }

    // Profile list
    const storeId = req.nextUrl.searchParams.get('storeId');
    if (!storeId) return jsonError('MISSING_STORE', 'storeId, profileId, or jobId query param required');

    let db: any;
    try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

    const profiles = db.prepare(
      'SELECT id, profile_name, ad_account_id, ad_account_name, fb_page_id, fb_page_name, pixel_id, is_active FROM fb_profiles WHERE store_id = ? AND is_active = 1'
    ).all(storeId);

    return jsonSuccess({ profiles });
  } catch (fatalErr: any) {
    console.error('[LAUNCH GET] Fatal error:', fatalErr);
    return jsonError('INTERNAL_ERROR', `Failed to load data: ${fatalErr?.message || 'Unknown error'}`, null, 500);
  }
}

export async function POST(req: NextRequest) {
  // ═══ TOP-LEVEL TRY/CATCH ═══
  // Guarantees the route ALWAYS returns JSON, never an HTML error page.
  try {
    return await handleLaunchPost(req);
  } catch (fatalErr: any) {
    console.error('[LAUNCH] Fatal unhandled error:', fatalErr);
    return jsonError('INTERNAL_ERROR', `Launch failed: ${fatalErr?.message || 'Unknown server error'}`, { stack: fatalErr?.stack?.substring(0, 500) }, 500);
  }
}

// ═══ Structural constants ═══
const DEFAULT_DAILY_BUDGET_CENTS = 3000; // $30/day
const DEFAULT_AGE_MIN = 18;
const DEFAULT_AGE_MAX = 65;
const DEFAULT_COUNTRIES = ['US'];

/**
 * Normalize a concept name for matching across launches.
 * Strips TEST/SCALE prefix and trailing (N) suffix so the same concept always matches.
 */
function normalizeConceptName(name: string): string {
  return name
    .replace(/^(TEST|SCALE)\s*[–-]\s*/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .toLowerCase()
    .trim();
}

async function handleLaunchPost(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('INVALID_BODY', 'Request body is not valid JSON', null, 400);
  }

  const {
    storeId, profileId, packages, campaignName, dailyBudget, status,
    mode, brandName, targeting: customTargeting, countries, ageMin, ageMax,
    overridePageId, savePageOverride,
    // ═══ Scale mode ═══
    existingCampaignId,        // If set, use this campaign instead of creating a new one
    existingAdSetMap,          // { [conceptName]: adSetId } — maps concepts to existing ad sets
    maxAdsPerExistingAdSet,    // Default 8 — skip concept if adding would exceed this
  } = body;

  if (!storeId) return jsonError('MISSING_STORE', 'storeId is required');
  if (!profileId) return jsonError('MISSING_PROFILE', 'profileId is required — select an ad account');
  if (!packages || !Array.isArray(packages) || packages.length === 0) {
    return jsonError('MISSING_PACKAGES', 'packages array is required with at least 1 concept group');
  }

  // Launch mode: 'test' (default) or 'scale'
  const launchMode = mode === 'scale' ? 'scale' : 'test';

  let db: any;
  try {
    db = getDb();
  } catch (e: any) {
    return jsonError('DB_ERROR', 'Database connection failed', e.message, 500);
  }

  // ── Load FB profile with access token + ad account ──
  let profile: any;
  let storeName: string = '';
  try {
    profile = db.prepare(
      'SELECT id, ad_account_id, fb_page_id, fb_page_access_token, pixel_id, access_token, profile_name FROM fb_profiles WHERE id = ? AND is_active = 1'
    ).get(profileId);
    const store: any = db.prepare('SELECT name FROM stores WHERE id = ?').get(storeId);
    storeName = store?.name || profile?.profile_name || 'Brand';
  } catch (e: any) {
    return jsonError('DB_QUERY_ERROR', `Failed to load FB profile: ${e.message}`, null, 500);
  }

  if (!profile) return jsonError('PROFILE_NOT_FOUND', 'Facebook profile not found or inactive');
  if (!profile.access_token) return jsonError('NO_TOKEN', 'No access token for this profile. Reconnect Facebook.');
  if (!profile.ad_account_id) return jsonError('NO_AD_ACCOUNT', 'No ad account linked to this profile.');

  // Resolve page ID: use override if provided, otherwise fall back to stored profile page
  const effectivePageId = overridePageId || profile.fb_page_id;
  if (!effectivePageId) {
    return jsonError('NO_PAGE', 'No Facebook Page selected. Choose a page in the launch modal.');
  }

  const token = profile.access_token;
  const adAccountId = profile.ad_account_id;
  const pageId = effectivePageId;
  let pixelId: string | undefined = profile.pixel_id || undefined;

  // ── Auto-discover pixel_id when missing ──
  // Meta's OUTCOME_SALES campaigns with OFFSITE_CONVERSIONS optimization REQUIRE
  // a promoted_object with a pixel. If the profile has no pixel saved, fetch it
  // from the ad account and persist it so future launches skip this lookup.
  if (!pixelId) {
    try {
      const pixelRes = await fetch(
        `https://graph.facebook.com/v24.0/${adAccountId}/adspixels?fields=id,name,last_fired_time&access_token=${encodeURIComponent(token)}`,
      );
      const pixelData = await pixelRes.json();
      if (pixelData?.error) {
        console.error('[LAUNCH] Pixel lookup error:', pixelData.error.message);
      } else {
        const pixels: any[] = (pixelData.data || []).filter((p: any) => p && p.id);
        if (pixels.length > 0) {
          // Prefer the most recently fired pixel (active one) if last_fired_time is present
          pixels.sort((a, b) => {
            const at = a.last_fired_time ? new Date(a.last_fired_time).getTime() : 0;
            const bt = b.last_fired_time ? new Date(b.last_fired_time).getTime() : 0;
            return bt - at;
          });
          pixelId = pixels[0].id;
          console.log(`[LAUNCH] Auto-discovered pixel ${pixelId} ("${pixels[0].name}") for profile ${profile.id}`);
          // Persist for future launches
          try {
            db.prepare('UPDATE fb_profiles SET pixel_id = ? WHERE id = ?').run(pixelId, profile.id);
          } catch (dbe: any) {
            console.error('[LAUNCH] Failed to persist discovered pixel_id:', dbe.message);
          }
        } else {
          console.error(`[LAUNCH] Ad account ${adAccountId} has no pixels linked`);
        }
      }
    } catch (e: any) {
      console.error('[LAUNCH] Pixel auto-discovery failed:', e.message);
    }
  }

  if (!pixelId) {
    return jsonError(
      'NO_PIXEL',
      `No Meta Pixel found on ad account ${adAccountId}. OUTCOME_SALES campaigns require a pixel. Create one in Meta Events Manager and link it to this ad account, then try again.`,
      null,
      400,
    );
  }

  // ── Resolve Page Access Token ──
  // Meta REQUIRES the Page Access Token (not the user token) when creating ad creatives
  // with object_story_spec.page_id. Always fetch from /me/accounts to ensure the token
  // matches the effective page (which may be different from the stored one if overridden).
  let pageAccessToken: string = '';
  let pageName: string = profile.fb_page_name || '';

  // Only use the cached token if the effective page matches the stored page AND no override
  const canUseCachedToken = profile.fb_page_access_token && profile.fb_page_id === pageId && !overridePageId;
  if (canUseCachedToken) {
    pageAccessToken = profile.fb_page_access_token;
  } else {
    try {
      console.log(`[LAUNCH] Fetching page access token for page ${pageId}...`);
      const pagesRes = await fetch(`https://graph.facebook.com/v24.0/me/accounts?fields=id,name,access_token&limit=200&access_token=${token}`);
      const pagesData = await pagesRes.json();
      if (pagesData.error) {
        return jsonError('PAGE_TOKEN_FETCH_FAILED', `Failed to fetch page list: ${pagesData.error.message}`, pagesData.error, 400);
      }
      const matchedPage = (pagesData.data || []).find((p: any) => p.id === pageId);
      if (!matchedPage) {
        const availableList = (pagesData.data || []).slice(0, 10).map((p: any) => `${p.name} (${p.id})`).join(', ');
        return jsonError(
          'PAGE_NO_ACCESS',
          `Your Facebook user does not have admin access to page ${pageId}. First 10 available: ${availableList || 'none'}. Use "Select different page" in the launch modal.`,
          { configuredPageId: pageId, availablePages: (pagesData.data || []).map((p: any) => ({ id: p.id, name: p.name })) },
          400
        );
      }
      pageAccessToken = matchedPage.access_token;
      pageName = matchedPage.name;

      // Save the override to the profile if requested, OR if no page was previously set
      const shouldSave = savePageOverride || !profile.fb_page_id;
      if (shouldSave) {
        try {
          db.prepare('UPDATE fb_profiles SET fb_page_id = ?, fb_page_access_token = ?, fb_page_name = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(pageId, pageAccessToken, matchedPage.name, profile.id);
          console.log(`[LAUNCH] Saved page "${matchedPage.name}" (${pageId}) to profile`);
        } catch {}
      } else {
        // Only cache the token, don't overwrite the stored page ID
        try {
          db.prepare('UPDATE fb_profiles SET fb_page_access_token = ?, fb_page_name = ?, updated_at = datetime(\'now\') WHERE id = ? AND fb_page_id = ?')
            .run(pageAccessToken, matchedPage.name, profile.id, pageId);
        } catch {}
      }
    } catch (e: any) {
      return jsonError('PAGE_TOKEN_FETCH_FAILED', `Failed to resolve page access token: ${e.message}`, null, 500);
    }
  }
  const budget = dailyBudget || DEFAULT_DAILY_BUDGET_CENTS;
  const adStatus = status || 'PAUSED';
  const dateStr = new Date().toISOString().slice(0, 10);
  const brand = brandName || storeName;
  const modePrefix = launchMode === 'scale' ? 'SCALE' : 'TEST';
  const campName = campaignName || `${modePrefix} – ${brand} – ${dateStr}`;

  // Build default broad targeting
  const defaultTargeting = {
    geo_locations: { countries: Array.isArray(countries) && countries.length > 0 ? countries : DEFAULT_COUNTRIES },
    age_min: typeof ageMin === 'number' ? ageMin : DEFAULT_AGE_MIN,
    age_max: typeof ageMax === 'number' ? ageMax : DEFAULT_AGE_MAX,
  };

  // ── Validate input packages structure ──
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    if (!pkg.concept) return jsonError('INVALID_PACKAGE', `Package ${i + 1} missing concept name`);
    if (!pkg.creatives || !Array.isArray(pkg.creatives) || pkg.creatives.length === 0) {
      return jsonError('INVALID_PACKAGE', `Package "${pkg.concept}" has no creatives`);
    }
    for (let j = 0; j < pkg.creatives.length; j++) {
      const cr = pkg.creatives[j];
      // Accept either imageUrl (image ad) or videoUrl (video ad)
      const hasMedia = cr.imageUrl || cr.videoUrl;
      if (!hasMedia) return jsonError('INVALID_CREATIVE', `Creative ${j + 1} in "${pkg.concept}" has no media URL (expected imageUrl or videoUrl)`);
      if (!cr.linkUrl) return jsonError('INVALID_CREATIVE', `Creative ${j + 1} in "${pkg.concept}" has no landing page URL`);
    }
  }

  // ═══ ONE CONCEPT = ONE AD SET ═══
  // No splitting, no creative limit. All creatives (image + video) for the same
  // concept go into the same ad set. Existing ad sets are reused automatically.
  const adSetPlan: { name: string; concept: string; creatives: any[] }[] = [];
  for (const pkg of packages) {
    adSetPlan.push({
      name: pkg.concept,
      concept: pkg.concept,
      creatives: pkg.creatives, // ALL creatives — image + video, no limit
    });
  }

  console.log(`[LAUNCH] Plan: ${adSetPlan.length} concept(s) → ${adSetPlan.length} ad set(s) (mode=${launchMode})`);
  for (const a of adSetPlan) {
    const imgCount = a.creatives.filter((c: any) => c.type !== 'video').length;
    const vidCount = a.creatives.filter((c: any) => c.type === 'video').length;
    console.log(`[LAUNCH]   "${a.name}": ${a.creatives.length} creatives (${imgCount} image, ${vidCount} video)`);
  }

  // ═══ Enrich creatives with real AI-generated headline/adCopy from creative_packages ═══
  // The creatives table only has shallow title/description. The real ad copy lives in
  // creative_packages.packages[package_index]. Fetch and merge now, before processing.
  try {
    // Collect all creative IDs we need to enrich
    const creativeIds = new Set<string>();
    for (const adSet of adSetPlan) {
      for (const cr of adSet.creatives) {
        if (cr.id) creativeIds.add(cr.id);
      }
    }

    if (creativeIds.size > 0) {
      // Load all relevant creatives with their package_id + package_index
      const placeholders = Array.from(creativeIds).map(() => '?').join(',');
      const creativeRows: any[] = db.prepare(
        `SELECT id, package_id, package_index, angle, title FROM creatives WHERE id IN (${placeholders})`
      ).all(...Array.from(creativeIds));

      // Group by package_id to batch-load packages
      const packageIds = new Set<string>();
      const creativeToPackage = new Map<string, { packageId: string; packageIndex: number; angle?: string; title?: string }>();
      for (const row of creativeRows) {
        if (row.package_id) {
          packageIds.add(row.package_id);
          creativeToPackage.set(row.id, {
            packageId: row.package_id,
            packageIndex: row.package_index ?? 0,
            angle: row.angle,
            title: row.title,
          });
        }
      }

      // Load packages
      const packageCopy = new Map<string, any[]>(); // package_id → parsed packages array
      if (packageIds.size > 0) {
        const pkgPlaceholders = Array.from(packageIds).map(() => '?').join(',');
        const pkgRows: any[] = db.prepare(
          `SELECT id, packages FROM creative_packages WHERE id IN (${pkgPlaceholders})`
        ).all(...Array.from(packageIds));
        for (const pkgRow of pkgRows) {
          try {
            packageCopy.set(pkgRow.id, JSON.parse(pkgRow.packages || '[]'));
          } catch {}
        }
      }

      // Enrich each creative in the plan with real headline/adCopy
      for (const adSet of adSetPlan) {
        for (const cr of adSet.creatives) {
          const mapping = creativeToPackage.get(cr.id);
          if (!mapping) continue;
          const pkgList = packageCopy.get(mapping.packageId);
          if (!pkgList || !pkgList[mapping.packageIndex]) continue;
          const srcPkg = pkgList[mapping.packageIndex];

          // Pull real ad copy from the package — prefer these over the shallow creative fields
          const realHeadline = srcPkg.headline || srcPkg.hook || mapping.title || cr.headline || '';
          const realAdCopy = srcPkg.adCopy || srcPkg.hook || mapping.angle || cr.primaryText || '';
          const realAngle = mapping.angle || srcPkg.angle || '';

          // Only override if we got something meaningful
          if (realHeadline) cr.headline = String(realHeadline).substring(0, 40);
          if (realAdCopy) {
            // Filter out render-prompt leakage
            const isRenderPrompt = /STRICT LAYOUT|TOP ZONE|BOTTOM ZONE|MIDDLE ZONE|Create a high-converting/i.test(realAdCopy);
            cr.primaryText = isRenderPrompt ? (realAngle || realHeadline) : String(realAdCopy).substring(0, 500);
          }
          // Store the concept angle for naming consistency
          if (realAngle) cr._conceptAngle = realAngle;
        }
      }
      console.log(`[LAUNCH] Enriched ${creativeToPackage.size} creatives with package-level ad copy`);
    }
  } catch (enrichErr: any) {
    console.error('[LAUNCH] Enrichment failed (continuing with shallow fields):', enrichErr.message);
  }

  // ═══ CREATE JOB RECORD AND RETURN IMMEDIATELY ═══
  const jobId = crypto.randomUUID();
  const job: LaunchJob = {
    id: jobId,
    status: 'queued',
    progress: `Queued: ${adSetPlan.length} ad sets, ${adSetPlan.reduce((s, a) => s + a.creatives.length, 0)} ads`,
    startedAt: Date.now(),
    adSets: [],
  };
  launchJobs.set(jobId, job);

  // Fire-and-forget background processing — frontend polls GET ?jobId=xxx
  // Wrap in catch so unhandled rejections don't crash the process
  processLaunchJob(jobId, {
    adAccountId, token, pageAccessToken, pageId, pixelId,
    campName, adStatus, budget, modePrefix,
    adSetPlan, customTargeting, defaultTargeting,
    launchMode, brand, conceptsReceived: packages.length, dateStr,
    existingCampaignId: existingCampaignId || null,
    existingAdSetMap: existingAdSetMap || null,
    maxAdsPerExistingAdSet: maxAdsPerExistingAdSet || 8,
  }).catch((err: any) => {
    console.error(`[LAUNCH ${jobId.slice(0,8)}] Uncaught background error:`, err);
    const j = launchJobs.get(jobId);
    if (j && j.status !== 'completed' && j.status !== 'partial') {
      j.status = 'failed';
      j.error = `Background job crashed: ${err?.message || 'Unknown error'}`;
      j.progress = j.error;
      j.completedAt = Date.now();
    }
  });

  return jsonSuccess({
    jobId,
    status: 'queued',
    plan: {
      conceptsReceived: packages.length,
      adSetsPlanned: adSetPlan.length,
      adsPlanned: adSetPlan.reduce((s, a) => s + a.creatives.length, 0),
    },
  });
}

// ═══ Background job processor ═══
async function processLaunchJob(
  jobId: string,
  opts: {
    adAccountId: string; token: string; pageAccessToken: string; pageId: string; pixelId?: string;
    campName: string; adStatus: string; budget: number; modePrefix: string;
    adSetPlan: { name: string; concept: string; creatives: any[] }[];
    customTargeting?: any; defaultTargeting: any;
    launchMode: string; brand: string; conceptsReceived: number; dateStr: string;
    existingCampaignId?: string | null;
    existingAdSetMap?: Record<string, string> | null;
    maxAdsPerExistingAdSet?: number;
  }
) {
  const job = launchJobs.get(jobId);
  if (!job) return;

  const { adAccountId, token, pageAccessToken, pageId, pixelId, campName, adStatus, budget, modePrefix, adSetPlan, customTargeting, defaultTargeting, launchMode, brand, conceptsReceived, existingCampaignId, existingAdSetMap, maxAdsPerExistingAdSet } = opts;

  const isScaleMode = !!existingCampaignId && !!existingAdSetMap && Object.keys(existingAdSetMap).length > 0;

  job.status = 'launching';
  job.progress = isScaleMode ? 'Adding ads to existing ad sets...' : 'Creating campaign...';

  const results: {
    campaignId: string;
    campaignName: string;
    adSets: {
      concept: string;
      adSetId: string;
      ads: { adId: string; creativeId: string; name: string; imageHash: string }[];
      errors: string[];
    }[];
  } = {
    campaignId: '',
    campaignName: campName,
    adSets: [],
  };

  // DB for writing updates
  let db: any;
  try { db = getDb(); } catch {}

  try {
    // ── Step 1: Campaign — either use existing (scale mode) or create new ──
    let campaign: { id: string };
    if (isScaleMode && existingCampaignId) {
      campaign = { id: existingCampaignId };
      results.campaignId = existingCampaignId;
      job.campaign = { id: existingCampaignId, name: `(existing) ${campName}` };
      console.log(`[LAUNCH ${jobId.slice(0,8)}] SCALE MODE: reusing campaign ${existingCampaignId}`);
      job.progress = 'Adding ads to existing ad sets...';
    } else {
      console.log(`[LAUNCH ${jobId.slice(0,8)}] Creating campaign "${campName}" in ${adAccountId}`);
      job.progress = `Creating campaign "${campName}"...`;
      campaign = await createCampaign(adAccountId, token, {
        name: campName,
        objective: 'OUTCOME_SALES',
        status: adStatus,
      });
      results.campaignId = campaign.id;
      console.log(`[LAUNCH ${jobId.slice(0,8)}] Campaign created: ${campaign.id}`);
      job.campaign = { id: campaign.id, name: campName };
    }

    // ── Step 2: Fetch existing ad sets in this campaign ONCE for auto-reuse ──
    // For BOTH new and scale modes: if an ad set with the same concept name already
    // exists, reuse it. Never create a duplicate.
    let existingAdSetsByConcept: Map<string, string> = new Map(); // normalized name → adset_id
    try {
      const existingAdSets = await getAdSets(campaign.id, token);
      for (const a of existingAdSets) {
        const normalized = normalizeConceptName(a.name);
        if (normalized && !existingAdSetsByConcept.has(normalized)) {
          existingAdSetsByConcept.set(normalized, a.id);
        }
      }
      console.log(`[LAUNCH ${jobId.slice(0,8)}] Found ${existingAdSetsByConcept.size} existing ad sets in campaign ${campaign.id}`);
    } catch (e: any) {
      console.error(`[LAUNCH ${jobId.slice(0,8)}] Failed to fetch existing ad sets (will create new):`, e.message);
    }

    // ── Step 3: For each concept, REUSE existing ad set OR create new ──
    let adSetIdx = 0;
    let reusedCount = 0;
    let createdCount = 0;
    for (const pkg of adSetPlan) {
      adSetIdx++;
      const adSetResult: typeof results.adSets[0] = {
        concept: pkg.name,
        adSetId: '',
        ads: [],
        errors: [],
      };

      try {
        let adSetId: string;
        const normalizedConcept = normalizeConceptName(pkg.name);

        // PRIORITY 1: explicit scale mode mapping (user picked specific ad set)
        const explicitMapping = isScaleMode && existingAdSetMap
          ? (existingAdSetMap[pkg.name] || existingAdSetMap[pkg.concept])
          : null;

        // PRIORITY 2: auto-match against existing ad sets in the campaign
        const autoMatchedId = existingAdSetsByConcept.get(normalizedConcept);

        if (explicitMapping) {
          adSetId = explicitMapping;
          adSetResult.adSetId = adSetId;
          reusedCount++;
          console.log(`[LAUNCH ${jobId.slice(0,8)}] EXPLICIT REUSE ad set ${adSetId} for "${pkg.name}"`);
          job.progress = `Adding to existing ad set ${adSetIdx}/${adSetPlan.length}: ${pkg.name}`;
        } else if (autoMatchedId) {
          adSetId = autoMatchedId;
          adSetResult.adSetId = adSetId;
          reusedCount++;
          console.log(`[LAUNCH ${jobId.slice(0,8)}] AUTO-REUSE ad set ${adSetId} for "${pkg.name}" (matched existing)`);
          job.progress = `Reusing ad set ${adSetIdx}/${adSetPlan.length}: ${pkg.name}`;
        } else {
          // No existing ad set — create one
          const adSetName = `${modePrefix} – ${pkg.name}`;
          console.log(`[LAUNCH ${jobId.slice(0,8)}] Creating ad set ${adSetIdx}/${adSetPlan.length}: "${adSetName}" (${pkg.creatives.length} creatives)`);
          job.progress = `Creating ad set ${adSetIdx}/${adSetPlan.length}: ${pkg.name}`;

          const adSet = await createAdSet(adAccountId, token, {
            name: adSetName,
            campaignId: campaign.id,
            dailyBudget: budget,
            pixelId,
            status: adStatus,
            targeting: customTargeting || defaultTargeting,
          });
          adSetId = adSet.id;
          adSetResult.adSetId = adSetId;
          createdCount++;
          // Track the new ad set so subsequent concepts in same launch can match against it
          existingAdSetsByConcept.set(normalizedConcept, adSetId);
          console.log(`[LAUNCH ${jobId.slice(0,8)}] Ad set created: ${adSetId}`);
        }
        // Normalize variable name for downstream code
        const adSet = { id: adSetId };

        // ── Step 3: Create ads (V1, V2, V3...) for this ad set ──
        let variantNumber = 1;
        for (const cr of pkg.creatives) {
          job.progress = `Ad set ${adSetIdx}/${adSetPlan.length}: uploading ad ${variantNumber}/${pkg.creatives.length}`;
          try {
            const isVideo = cr.type === 'video' || (cr.videoUrl && !cr.imageUrl);
            const mediaUrl = isVideo ? (cr.videoUrl || cr.imageUrl || '') : (cr.imageUrl || '');

            // Read media from disk or download
            let mediaBuffer: Buffer;
            if (mediaUrl.startsWith('/api/products/uploads?file=')) {
              const { readFile } = await import('fs/promises');
              const path = await import('path');
              const filename = new URL(mediaUrl, 'http://localhost').searchParams.get('file');
              if (!filename) throw new Error('Invalid local file URL');
              const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
              mediaBuffer = await readFile(filePath);
              console.log(`[LAUNCH] Read local ${isVideo ? 'video' : 'image'}: ${filename} (${mediaBuffer.length} bytes)`);
            } else if (mediaUrl.startsWith('/')) {
              const res = await fetch(`http://localhost:${process.env.PORT || 3001}${mediaUrl}`);
              if (!res.ok) throw new Error(`Failed to read local media: ${res.status}`);
              mediaBuffer = Buffer.from(await res.arrayBuffer());
            } else if (mediaUrl.includes('api.openai.com')) {
              // Sora URL — needs OpenAI auth
              const res = await fetch(mediaUrl, { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } });
              if (!res.ok) throw new Error('Sora video URL expired or inaccessible');
              mediaBuffer = Buffer.from(await res.arrayBuffer());
            } else {
              const res = await fetch(mediaUrl);
              if (!res.ok) throw new Error(`Failed to download media: ${res.status}`);
              mediaBuffer = Buffer.from(await res.arrayBuffer());
            }

            const variantLabel = `V${variantNumber}`;
            variantNumber++;
            const creativeName = `${pkg.name} – ${variantLabel} – Creative`;
            let adCreative: { id: string };

            // ═══ Concept-aligned headline & primary text ═══
            // Priority:
            //   headline: creative.headline (from package) → concept name
            //   primaryText: creative.primaryText (adCopy from package) → concept-aligned fallback
            // The ad set IS the concept, so every ad in it should feel aligned to that concept.
            const conceptName = pkg.concept; // e.g. "Ours vs Typical Ingredients"
            const enrichedHeadline = (cr.headline || '').trim();
            const enrichedPrimaryText = (cr.primaryText || '').trim();

            // Headline: max 40 chars. Must be non-empty.
            let finalHeadline = enrichedHeadline;
            if (!finalHeadline || finalHeadline.length < 3) {
              finalHeadline = conceptName.substring(0, 40);
            } else {
              finalHeadline = finalHeadline.substring(0, 40);
            }

            // Primary text: max 500 chars. Must be non-empty and not a render prompt.
            let finalPrimaryText = enrichedPrimaryText;
            const isRenderPrompt = /STRICT LAYOUT|TOP ZONE|BOTTOM ZONE|MIDDLE ZONE|Create a high-converting|FORMAT RULES|AESTHETIC:/i.test(finalPrimaryText);
            if (isRenderPrompt || !finalPrimaryText || finalPrimaryText.length < 10) {
              // Fallback: build concept-aligned ad copy from the angle/concept
              finalPrimaryText = `${conceptName}. ${finalHeadline}`.substring(0, 500);
            } else {
              finalPrimaryText = finalPrimaryText.substring(0, 500);
            }

            console.log(`[LAUNCH] Ad copy — headline: "${finalHeadline}" | primary: "${finalPrimaryText.substring(0, 80)}${finalPrimaryText.length > 80 ? '...' : ''}"`);


            if (isVideo) {
              // ═══ VIDEO AD FLOW ═══
              console.log(`[LAUNCH] Uploading video for "${cr.title || 'untitled'}" (${mediaBuffer.length} bytes)`);
              const fbVideoResult = await uploadVideoFromBuffer(
                adAccountId, token, mediaBuffer,
                (cr.headline || cr.title || pkg.concept).substring(0, 255),
                (cr.primaryText || '').substring(0, 500)
              );
              const fbVideoId = fbVideoResult.id;
              console.log(`[LAUNCH] FB video uploaded: ${fbVideoId}, waiting for processing...`);
              job.progress = `Ad set ${adSetIdx}/${adSetPlan.length}: waiting for video ${variantNumber - 1}/${pkg.creatives.length} to process`;

              // Poll for video processing (max 5 min — Meta can take 2-4 min per video)
              let videoReady = false;
              let videoThumbnailUrl: string | undefined;
              let lastStatus = 'unknown';
              const POLL_INTERVAL_MS = 4000;
              const MAX_POLLS = 75; // 75 * 4s = 300s (5 minutes)
              for (let i = 0; i < MAX_POLLS; i++) {
                await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                try {
                  const status = await checkVideoProcessingStatus(fbVideoId, token);
                  lastStatus = status.status;
                  if (status.status === 'ready') {
                    videoReady = true;
                    if (status.thumbnailUrl) videoThumbnailUrl = status.thumbnailUrl;
                    break;
                  }
                  if (status.status === 'error') {
                    throw new Error(`FB video processing errored: ${status.status}`);
                  }
                  // Update job progress every 5 polls
                  if (i % 5 === 0) {
                    job.progress = `Ad set ${adSetIdx}/${adSetPlan.length}: video ${variantNumber - 1}/${pkg.creatives.length} processing (${status.status}, ${i * 4}s)`;
                  }
                } catch (e: any) {
                  console.error(`[LAUNCH ${jobId.slice(0,8)}] Video status poll error:`, e.message);
                }
              }
              if (!videoReady) {
                throw new Error(`FB video processing timeout after ${(MAX_POLLS * POLL_INTERVAL_MS) / 1000}s (last status: ${lastStatus})`);
              }
              console.log(`[LAUNCH ${jobId.slice(0,8)}] FB video ready: ${fbVideoId}`);

              // Create video ad creative
              adCreative = await createAdCreative(adAccountId, pageAccessToken, {
                name: creativeName,
                pageId,
                videoId: fbVideoId,
                thumbnailUrl: videoThumbnailUrl || cr.thumbnailUrl || '',
                title: finalHeadline,
                message: finalPrimaryText,
                ctaType: cr.callToAction || 'SHOP_NOW',
                ctaLink: cr.linkUrl,
              });

            } else {
              // ═══ IMAGE AD FLOW ═══
              // Always convert to JPEG for Meta compatibility (WebP/HEIC from MiniMax/Gemini not accepted).
              // Also compress if over 7MB (Meta max is 8MB).
              const META_MAX_IMAGE_BYTES = 7 * 1024 * 1024;
              try {
                const sharp = (await import('sharp')).default;
                const meta = await sharp(mediaBuffer).metadata();
                const needsResize = (meta.width || 0) > 2048 || (meta.height || 0) > 2048;
                const needsCompress = mediaBuffer.length > META_MAX_IMAGE_BYTES;
                const needsConvert = meta.format !== 'jpeg' && meta.format !== 'png';

                if (needsConvert || needsCompress || needsResize) {
                  console.log(`[LAUNCH] Processing image: ${meta.format} ${meta.width}x${meta.height} (${(mediaBuffer.length/1024/1024).toFixed(1)}MB)${needsConvert ? ' → JPEG' : ''}${needsResize ? ' → resize' : ''}${needsCompress ? ' → compress' : ''}`);
                  let pipeline = sharp(mediaBuffer).rotate();
                  if (needsResize) {
                    pipeline = pipeline.resize(2048, 2048, { fit: 'inside', withoutEnlargement: true });
                  }
                  mediaBuffer = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();

                  if (mediaBuffer.length > META_MAX_IMAGE_BYTES) {
                    mediaBuffer = await sharp(mediaBuffer)
                      .resize(1536, 1536, { fit: 'inside' })
                      .jpeg({ quality: 75, mozjpeg: true })
                      .toBuffer();
                    console.log(`[LAUNCH] Aggressive compress to ${(mediaBuffer.length/1024/1024).toFixed(1)}MB`);
                  }
                }
              } catch (compErr: any) {
                console.error(`[LAUNCH] Image processing failed:`, compErr.message);
              }

              console.log(`[LAUNCH] Uploading image for "${cr.title || 'untitled'}" (${mediaBuffer.length} bytes)`);
              const b64 = mediaBuffer.toString('base64');
              const imageUpload = await uploadAdImage(adAccountId, token, b64);

              adCreative = await createAdCreative(adAccountId, pageAccessToken, {
                name: creativeName,
                pageId,
                imageHash: imageUpload.hash,
                headline: finalHeadline,
                primaryText: finalPrimaryText,
                linkUrl: cr.linkUrl,
                callToAction: cr.callToAction || 'SHOP_NOW',
                description: cr.description || '',
              });
            }

            // 3c. Create ad — standardized "Concept – V1" naming
            const adName = `${pkg.name} – ${variantLabel}`;
            const ad = await createAd(adAccountId, token, {
              name: adName,
              adSetId: adSet.id,
              creativeId: adCreative.id,
              status: adStatus,
            });

            adSetResult.ads.push({
              adId: ad.id,
              creativeId: adCreative.id,
              name: adName,
              imageHash: '',
            });

            // Update the creative in DB with FB ad ID
            try {
              db.prepare('UPDATE creatives SET fb_post_id = ?, status = ? WHERE id = ?')
                .run(ad.id, 'published', cr.id);
            } catch {}

            console.log(`[LAUNCH] Ad created: ${ad.id} (${adName})`);

          } catch (adErr: any) {
            const errMsg = adErr.fbError?.message || adErr.message || 'Unknown ad creation error';
            console.error(`[LAUNCH] Failed to create ad for "${cr.title}":`, errMsg);
            adSetResult.errors.push(`${cr.title || 'Creative'}: ${errMsg}`);
          }
        }
      } catch (setErr: any) {
        const errMsg = setErr.fbError?.message || setErr.message || 'Unknown ad set error';
        console.error(`[LAUNCH] Failed to create ad set "${pkg.concept}":`, errMsg);
        adSetResult.errors.push(`Ad set creation failed: ${errMsg}`);
      }

      results.adSets.push(adSetResult);
      // Live update job state so polling shows partial progress
      job.adSets = [...results.adSets];
    }

    const totalAds = results.adSets.reduce((s, as) => s + as.ads.length, 0);
    const totalErrors = results.adSets.reduce((s, as) => s + as.errors.length, 0);
    const successfulAdSets = results.adSets.filter(s => s.adSetId).length;

    console.log(`[LAUNCH ${jobId.slice(0,8)}] Complete: ${conceptsReceived} concepts → ${successfulAdSets} ad sets (${reusedCount} reused, ${createdCount} created), ${totalAds} ads, ${totalErrors} errors`);

    // Determine final status: partial if some errors but some success
    const finalStatus = totalErrors > 0 && (successfulAdSets > 0 || totalAds > 0) ? 'partial' : 'completed';

    job.status = finalStatus;
    job.progress = `Done: ${totalAds} ads in ${successfulAdSets} ad sets (${reusedCount} reused, ${createdCount} created)${totalErrors > 0 ? `, ${totalErrors} errors` : ''}`;
    job.completedAt = Date.now();
    job.campaign = { id: results.campaignId, name: results.campaignName };
    job.adSets = results.adSets;
    job.summary = {
      mode: launchMode,
      brand,
      conceptsReceived,
      adSetsCreated: successfulAdSets,
      adSetsReused: reusedCount,
      adSetsNewlyCreated: createdCount,
      adsCreated: totalAds,
      errorsCount: totalErrors,
      budgetPerAdSet: `$${(budget / 100).toFixed(0)}/day`,
      targeting: `${(customTargeting || defaultTargeting).age_min}-${(customTargeting || defaultTargeting).age_max}, ${((customTargeting || defaultTargeting).geo_locations?.countries || []).join(', ')}`,
      status: adStatus,
    };

  } catch (err: any) {
    // Build detailed error message with all available context
    const fbError = err.fbError || {};
    const parts: string[] = [];
    if (err.message) parts.push(err.message);
    if (fbError.error_user_msg && fbError.error_user_msg !== err.message) {
      parts.push(`Detail: ${fbError.error_user_msg}`);
    }
    if (fbError.error_data?.blame_field_specs) {
      parts.push(`Failed field: ${JSON.stringify(fbError.error_data.blame_field_specs)}`);
    }
    if (err.subcode) parts.push(`subcode=${err.subcode}`);
    const fullErrMsg = parts.join(' | ') || 'Campaign creation failed';

    console.error(`[LAUNCH ${jobId.slice(0,8)}] Fatal error:`, fullErrMsg);
    console.error(`[LAUNCH ${jobId.slice(0,8)}] Full FB error:`, JSON.stringify(fbError, null, 2).substring(0, 2000));

    // Partial failure: campaign was created and some ad sets succeeded
    const hasPartialSuccess = results.campaignId && results.adSets.some(s => s.adSetId);

    job.status = hasPartialSuccess ? 'partial' : 'failed';
    job.progress = hasPartialSuccess ? 'Campaign created but some ad sets failed' : fullErrMsg;
    job.completedAt = Date.now();
    job.error = fullErrMsg;
    job.errorDetails = {
      campaignId: results.campaignId,
      adSets: results.adSets,
      fbError,
      blameFields: err.blameFields,
      subcode: err.subcode,
    };
    if (results.campaignId) {
      job.campaign = { id: results.campaignId, name: results.campaignName };
    }
    if (results.adSets.length > 0) {
      job.adSets = results.adSets;
    }
  }
}
