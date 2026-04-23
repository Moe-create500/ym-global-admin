/**
 * Facebook Marketing API Integration
 *
 * Setup steps:
 * 1. Create a Facebook App at developers.facebook.com
 * 2. Add "Marketing API" product
 * 3. Set FB_APP_ID and FB_APP_SECRET in .env
 * 4. OAuth flow: /api/ads/facebook/auth → redirects to FB → callback exchanges code for token
 * 5. Long-lived token lasts ~60 days, system user token lasts indefinitely
 */

const FB_API_VERSION = 'v24.0';
const FB_GRAPH_URL = `https://graph.facebook.com/${FB_API_VERSION}`;

// Rate-limit retry helper
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, label = ''): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit = err.code === 17 || err.code === 32 || err.status === 429
        || (err.message && err.message.includes('request limit'));
      if (isRateLimit && attempt < maxRetries) {
        const waitMs = attempt * 15000;
        console.log(`[FB-RETRY] ${label} rate limited, waiting ${waitMs/1000}s (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error('withRetry exhausted');
}


const FB_APP_ID = process.env.FB_APP_ID || '';
const FB_APP_SECRET = process.env.FB_APP_SECRET || '';

export interface FBTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface FBAdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

export interface FBInsight {
  date_start: string;
  date_stop: string;
  campaign_id: string;
  campaign_name: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend: string;
  impressions: string;
  clicks: string;
  reach?: string;
  frequency?: string;
  cpm?: string;
  cpc?: string;
  ctr?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
}

export interface FBAdCreative {
  ad_id: string;
  ad_status?: string;
  title?: string;
  body?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  call_to_action_type?: string;
  link_url?: string;
  preview_url?: string;
  object_story_id?: string;
}

export interface FBPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
}

// OAuth URL generation
export function getOAuthUrl(redirectUri: string, state: string): string {
  const scopes = [
    'ads_management',
    'ads_read',
    'pages_show_list',
    'pages_read_engagement',
    'instagram_basic',
    'business_management',
    'catalog_management',
  ].join(',');

  return `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${state}&response_type=code`;
}

// Exchange code for short-lived token
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<FBTokenResponse> {
  const res = await fetch(
    `${FB_GRAPH_URL}/oauth/access_token?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${FB_APP_SECRET}&code=${code}`
  );
  if (!res.ok) throw new Error(`FB token exchange failed: ${await res.text()}`);
  return res.json();
}

// Exchange short-lived token for long-lived token (~60 days)
export async function getLongLivedToken(shortToken: string): Promise<FBTokenResponse> {
  const res = await fetch(
    `${FB_GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&fb_exchange_token=${shortToken}`
  );
  if (!res.ok) throw new Error(`FB long-lived token exchange failed: ${await res.text()}`);
  return res.json();
}

// Get user's ad accounts
export async function getAdAccounts(accessToken: string): Promise<FBAdAccount[]> {
  const res = await fetch(
    `${FB_GRAPH_URL}/me/adaccounts?fields=id,account_id,name,currency,timezone_name,account_status&access_token=${accessToken}`
  );
  if (!res.ok) throw new Error(`FB ad accounts fetch failed: ${await res.text()}`);
  const data = await res.json();
  return data.data || [];
}

// Get user's pages
export async function getPages(accessToken: string): Promise<FBPage[]> {
  const res = await fetch(
    `${FB_GRAPH_URL}/me/accounts?fields=id,name,access_token,category&access_token=${accessToken}`
  );
  if (!res.ok) throw new Error(`FB pages fetch failed: ${await res.text()}`);
  const data = await res.json();
  return data.data || [];
}

// Get daily ad insights for an ad account
export async function getAdInsights(
  adAccountId: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string,
  level: 'campaign' | 'adset' | 'ad' = 'campaign'
): Promise<FBInsight[]> {
  let fields = 'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,reach,frequency,cpm,cpc,ctr,actions,action_values,cost_per_action_type';
  if (level === 'ad') fields += ',ad_id,ad_name';
  const res = await fetch(
    `${FB_GRAPH_URL}/${adAccountId}/insights?fields=${fields}&time_range={"since":"${dateFrom}","until":"${dateTo}"}&time_increment=1&level=${level}&limit=500&access_token=${accessToken}`
  );
  if (!res.ok) throw new Error(`FB insights fetch failed: ${await res.text()}`);
  const data = await res.json();

  // Handle pagination
  let allData = data.data || [];
  let nextUrl = data.paging?.next;

  while (nextUrl) {
    const nextRes = await fetch(nextUrl);
    const nextData = await nextRes.json();
    allData = allData.concat(nextData.data || []);
    nextUrl = nextData.paging?.next;
  }

  return allData;
}

// Get full creative context for ads (batched)
export async function getAdCreatives(
  accessToken: string,
  adIds: string[]
): Promise<FBAdCreative[]> {
  const results: FBAdCreative[] = [];
  const creativeFields = 'thumbnail_url,image_url,video_id,body,title,call_to_action_type,link_url,object_story_id';

  // Process in batches of 50
  for (let i = 0; i < adIds.length; i += 50) {
    const batch = adIds.slice(i, i + 50);
    const batchRequests = batch.map(id => ({
      method: 'GET',
      relative_url: `${id}?fields=status,effective_status,preview_shareable_link,creative{${creativeFields}}`,
    }));

    try {
      const res = await fetch(`${FB_GRAPH_URL}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          batch: JSON.stringify(batchRequests),
        }),
      });

      if (!res.ok) continue;
      const batchResults = await res.json();

      for (let j = 0; j < batchResults.length; j++) {
        const item = batchResults[j];
        if (item.code !== 200) continue;
        try {
          const parsed = JSON.parse(item.body);
          const creative = parsed.creative || {};
          results.push({
            ad_id: batch[j],
            ad_status: parsed.effective_status || parsed.status || undefined,
            title: creative.title || undefined,
            body: creative.body || undefined,
            thumbnail_url: creative.thumbnail_url || undefined,
            image_url: creative.image_url || undefined,
            video_id: creative.video_id || undefined,
            call_to_action_type: creative.call_to_action_type || undefined,
            link_url: creative.link_url || undefined,
            preview_url: parsed.preview_shareable_link || undefined,
            object_story_id: creative.object_story_id || undefined,
          });
        } catch {}
      }
    } catch {}
  }

  return results;
}

// Get direct video source URL from a Facebook video ID
// Requires a page access token (user tokens don't have source field access)
export async function getVideoSourceUrl(videoId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${FB_GRAPH_URL}/${videoId}?fields=source&access_token=${accessToken}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.source || null;
  } catch {
    return null;
  }
}

// Get video source URLs for multiple video IDs using page tokens
// The source field requires page-level access, so we try each page token
export async function getVideoSourceUrls(
  pageTokens: string[],
  videoIds: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const remaining = new Set(videoIds);

  for (const token of pageTokens) {
    if (remaining.size === 0) break;

    const batch = Array.from(remaining).slice(0, 50);
    const batchRequests = batch.map(id => ({
      method: 'GET',
      relative_url: `${id}?fields=source`,
    }));

    try {
      const res = await fetch(`${FB_GRAPH_URL}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          batch: JSON.stringify(batchRequests),
        }),
      });

      if (!res.ok) continue;
      const batchResults = await res.json();

      for (let j = 0; j < batchResults.length; j++) {
        const item = batchResults[j];
        if (item.code !== 200) continue;
        try {
          const parsed = JSON.parse(item.body);
          if (parsed.source) {
            results.set(batch[j], parsed.source);
            remaining.delete(batch[j]);
          }
        } catch {}
      }
    } catch {}
  }

  return results;
}

// Upload video to Facebook page or ad account
export async function uploadVideo(
  targetId: string,
  accessToken: string,
  videoUrl: string,
  title: string,
  description?: string
): Promise<{ id: string }> {
  const res = await fetch(`${FB_GRAPH_URL}/${targetId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_url: videoUrl,
      title,
      description: description || '',
      access_token: accessToken,
    }),
  });
  if (!res.ok) throw new Error(`FB video upload failed: ${await res.text()}`);
  return res.json();
}

// Create product catalog
export async function createCatalog(
  businessId: string,
  accessToken: string,
  name: string
): Promise<{ id: string }> {
  const res = await fetch(`${FB_GRAPH_URL}/${businessId}/owned_product_catalogs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      access_token: accessToken,
    }),
  });
  if (!res.ok) throw new Error(`FB catalog creation failed: ${await res.text()}`);
  return res.json();
}

// Add product to catalog
export async function addProductToCatalog(
  catalogId: string,
  accessToken: string,
  product: {
    retailer_id: string;
    name: string;
    description: string;
    availability: string;
    condition: string;
    price: number;
    currency: string;
    image_url: string;
    url: string;
  }
): Promise<{ id: string }> {
  const res = await fetch(`${FB_GRAPH_URL}/${catalogId}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...product,
      access_token: accessToken,
    }),
  });
  if (!res.ok) throw new Error(`FB product add failed: ${await res.text()}`);
  return res.json();
}

// Get billing charges from ad account activities
export interface FBBillingCharge {
  event_time: string;
  date: string;
  amount_cents: number;
  currency: string;
  transaction_id: string;
  funding_source_id?: string;
  card_last4?: string;
  status: 'paid' | 'declined' | 'pending';
}

export async function getBillingCharges(
  adAccountId: string,
  accessToken: string,
  since?: string
): Promise<FBBillingCharge[]> {
  let url = `${FB_GRAPH_URL}/${adAccountId}/activities?fields=event_type,event_time,extra_data&limit=1000&access_token=${accessToken}`;
  if (since) url += `&since=${since}`;

  const allCharges: FBBillingCharge[] = [];

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FB activities fetch failed: ${await res.text()}`);
    const data = await res.json();

    for (const item of data.data || []) {
      if (item.event_type !== 'ad_account_billing_charge') continue;
      try {
        const extra = JSON.parse(item.extra_data || '{}');
        if (!extra.transaction_id || !extra.new_value) continue;

        // Check for declined/failed indicators in extra_data
        const chargeStatus = extra.billing_event_type || extra.charge_type || extra.status || '';
        const reason = (extra.reason || '').toLowerCase();
        const isDeclined = /decline|fail|reject|insufficient|expired/i.test(chargeStatus)
          || /decline|fail|reject|insufficient|expired/i.test(reason);

        // Skip declined charges — they should not be recorded as paid
        if (isDeclined) {
          console.log(`[FB-BILLING] Skipping declined charge ${extra.transaction_id}: ${chargeStatus || reason}`);
          continue;
        }

        allCharges.push({
          event_time: item.event_time,
          date: item.event_time.slice(0, 10),
          amount_cents: extra.new_value,
          currency: extra.currency || 'USD',
          transaction_id: extra.transaction_id,
          funding_source_id: extra.funding_source_id,
          status: 'paid',
        });
      } catch {
        continue;
      }
    }

    url = data.paging?.next || '';
  }

  return allCharges;
}

// Get all payment methods on an ad account (for billing reconciliation)
export async function getAccountPaymentMethods(
  adAccountId: string,
  accessToken: string
): Promise<{ id: string; display_string: string; card_last4: string }[]> {
  try {
    const res = await fetch(
      `${FB_GRAPH_URL}/${adAccountId}?fields=funding_source_details{id,display_string,card_last4}&access_token=${accessToken}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const fs = data.funding_source_details;
    if (!fs) return [];
    // Funding source can be a single object or an array
    const list = Array.isArray(fs) ? fs : [fs];
    return list.map((p: any) => ({
      id: p.id || '',
      display_string: p.display_string || '',
      card_last4: p.card_last4 || (p.display_string?.match(/(\d{4})\s*$/) || [])[1] || '',
    })).filter(p => p.id);
  } catch {
    return [];
  }
}

// Get ad account funding source (payment method on file)
export async function getFundingSource(
  adAccountId: string,
  accessToken: string
): Promise<{ id: string; display_string: string; type: number } | null> {
  const res = await fetch(
    `${FB_GRAPH_URL}/${adAccountId}?fields=funding_source_details&access_token=${accessToken}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.funding_source_details || null;
}

// Check token validity and expiry
export async function debugToken(accessToken: string): Promise<{
  is_valid: boolean;
  expires_at: number;
  scopes: string[];
  user_id: string;
}> {
  const res = await fetch(
    `${FB_GRAPH_URL}/debug_token?input_token=${accessToken}&access_token=${FB_APP_ID}|${FB_APP_SECRET}`
  );
  if (!res.ok) throw new Error(`FB token debug failed: ${await res.text()}`);
  const data = await res.json();
  return data.data;
}

// ═══════════════════════════════════════════════
// CAMPAIGN & AD SET LISTING
// ═══════════════════════════════════════════════

export async function getCampaigns(
  adAccountId: string,
  accessToken: string
): Promise<{ id: string; name: string; status: string; objective: string }[]> {
  const res = await fetch(
    `${FB_GRAPH_URL}/${adAccountId}/campaigns?fields=id,name,status,objective&limit=100&access_token=${accessToken}`
  );
  if (!res.ok) throw new Error(`FB getCampaigns failed: ${await res.text()}`);
  const data = await res.json();
  return data.data || [];
}

export async function getAdSets(
  campaignId: string,
  accessToken: string
): Promise<{ id: string; name: string; status: string; daily_budget: string }[]> {
  return withRetry(async () => {
    const res = await fetch(
      `${FB_GRAPH_URL}/${campaignId}/adsets?fields=id,name,status,daily_budget&limit=100&access_token=${accessToken}`
    );
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`FB getAdSets failed: ${text}`) as any;
      try { const j = JSON.parse(text); err.code = j?.error?.code; } catch {}
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data.data || [];
  }, 3, `getAdSets(${campaignId})`);
}

// ═══════════════════════════════════════════════
// VIDEO UPLOAD & PROCESSING
// ═══════════════════════════════════════════════

export async function uploadVideoFromBuffer(
  adAccountId: string,
  accessToken: string,
  videoBuffer: Buffer,
  title: string,
  description?: string
): Promise<{ id: string }> {
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('title', title);
  if (description) formData.append('description', description);
  const videoBlob = new Blob([new Uint8Array(videoBuffer)], { type: 'video/mp4' });
  formData.append('source', videoBlob, 'video.mp4');

  const res = await fetch(`${FB_GRAPH_URL}/${adAccountId}/advideos`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`FB video upload failed: ${await res.text()}`);
  return res.json();
}

export async function checkVideoProcessingStatus(
  videoId: string,
  accessToken: string
): Promise<{ status: string; processing_progress: number; thumbnailUrl?: string }> {
  // Note: 'processing_progress' is NOT a valid field on Meta advideos. Only 'status' and 'thumbnails'.
  const res = await fetch(
    `${FB_GRAPH_URL}/${videoId}?fields=status,thumbnails&access_token=${accessToken}`
  );
  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    throw new Error(`FB video status check failed: ${rawText.substring(0, 300)}`);
  }
  const data = await res.json();
  // Meta returns status as an object: { video_status: "ready" | "processing" | "error" | ... }
  // Normalize to a simple string.
  const videoStatus = data.status?.video_status || data.status || 'unknown';
  return {
    status: typeof videoStatus === 'string' ? videoStatus : 'unknown',
    processing_progress: 0, // Not available from Meta; kept for interface compat
    thumbnailUrl: data.thumbnails?.data?.[0]?.uri || undefined,
  };
}

// ═══════════════════════════════════════════════
// META ADS CREATION (Campaign → Ad Set → Ad)
// ═══════════════════════════════════════════════

async function fbPost(path: string, accessToken: string, body: Record<string, any>): Promise<any> {
  // Log the full payload (with token redacted) so we can see exactly what was sent
  const debugBody = { ...body };
  console.log(`[FB-POST] ${path}`, JSON.stringify(debugBody).substring(0, 1500));

  let res: Response;
  try {
    res = await fetch(`${FB_GRAPH_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, access_token: accessToken }),
    });
  } catch (netErr: any) {
    const err = new Error(`FB network error: ${netErr.message}`) as any;
    err.code = 'NETWORK';
    err.status = 0;
    throw err;
  }

  // Safe JSON parse — handles HTML/non-JSON error responses
  let data: any;
  const rawText = await res.text();
  try {
    data = JSON.parse(rawText);
  } catch {
    const err = new Error(`FB returned non-JSON response (HTTP ${res.status}): ${rawText.substring(0, 200)}`) as any;
    err.status = res.status;
    err.code = 'NON_JSON';
    throw err;
  }

  if (data.error || !res.ok) {
    const fbError = data.error || {};

    // Build the most informative message possible from Meta's error response
    const parts: string[] = [];

    // Top-level message
    if (fbError.message) parts.push(fbError.message);

    // User-facing message (often more specific than message)
    if (fbError.error_user_msg && fbError.error_user_msg !== fbError.message) {
      parts.push(`(${fbError.error_user_msg})`);
    }

    // Field-specific blame (most useful for "Invalid parameter")
    if (fbError.error_data?.blame_field_specs) {
      const fields = JSON.stringify(fbError.error_data.blame_field_specs);
      parts.push(`Field: ${fields}`);
    }

    // Subcode for further classification
    if (fbError.error_subcode) {
      parts.push(`subcode=${fbError.error_subcode}`);
    }

    // Code
    if (fbError.code) {
      parts.push(`code=${fbError.code}`);
    }

    // Type
    if (fbError.type && fbError.type !== 'OAuthException') {
      parts.push(`type=${fbError.type}`);
    }

    const fullMessage = parts.filter(Boolean).join(' | ') || 'Facebook API error';

    // Log full error response for debugging
    console.error(`[FB-POST ERROR] ${path}:`, JSON.stringify(fbError, null, 2).substring(0, 2000));

    const err = new Error(fullMessage) as any;
    err.fbError = fbError;
    err.status = res.status;
    err.code = fbError.code;
    err.subcode = fbError.error_subcode;
    err.blameFields = fbError.error_data?.blame_field_specs;
    throw err;
  }

  console.log(`[FB-POST OK] ${path} → ${data.id || JSON.stringify(data).substring(0, 200)}`);
  return data;
}

// Rate-limit-aware POST wrapper
async function fbPostWithRetry(path: string, accessToken: string, body: Record<string, any>): Promise<any> {
  return withRetry(() => fbPost(path, accessToken, body), 3, path);
}

/**
 * Upload image to ad account for use in ad creatives.
 * Returns the image hash needed for creating ad creatives.
 */
/**
 * Upload image to Facebook ad account.
 * Accepts either:
 * - A public URL (will be downloaded)
 * - A base64-encoded string (already downloaded)
 */
export async function uploadAdImage(
  adAccountId: string,
  accessToken: string,
  imageUrlOrBase64: string,
): Promise<{ hash: string; url: string }> {
  let b64: string;

  // Check if it's already base64 (no protocol prefix, long string)
  if (!imageUrlOrBase64.startsWith('http') && !imageUrlOrBase64.startsWith('/') && imageUrlOrBase64.length > 500) {
    b64 = imageUrlOrBase64;
  } else {
    // Download from URL
    const imgRes = await fetch(imageUrlOrBase64);
    if (!imgRes.ok) throw new Error(`Failed to download image for FB upload: ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    b64 = buf.toString('base64');
  }

  const data = await fbPost(`${adAccountId}/adimages`, accessToken, {
    bytes: b64,
  });

  const imgData = data.images?.bytes;
  if (!imgData?.hash) throw new Error('Facebook image upload returned no hash');
  return { hash: imgData.hash, url: imgData.url || '' };
}

/**
 * Create an ABO campaign (no campaign budget optimization).
 * Tries OUTCOME_SALES first, falls back to OUTCOME_TRAFFIC if account doesn't support it.
 */
export async function createCampaign(
  adAccountId: string,
  accessToken: string,
  options: {
    name: string;
    objective?: string;
    status?: string;
    specialAdCategories?: string[];
  }
): Promise<{ id: string }> {
  const objective = options.objective || 'OUTCOME_SALES';
  const payload = {
    name: options.name,
    objective,
    buying_type: 'AUCTION',
    status: options.status || 'PAUSED',
    special_ad_categories: options.specialAdCategories || [],
    // Required by Meta API v24+ when not using campaign budget optimization (CBO).
    // false = each ad set has its own budget (true ABO), no sharing.
    is_adset_budget_sharing_enabled: false,
  };

  try {
    return await fbPostWithRetry(`${adAccountId}/campaigns`, accessToken, payload);
  } catch (err: any) {
    // If the failure is about objective compatibility, try OUTCOME_TRAFFIC as fallback
    const errMsg = (err.message || '').toLowerCase();
    const isObjectiveError = errMsg.includes('objective') || err.subcode === 1487090 || err.code === 100;

    if (isObjectiveError && objective === 'OUTCOME_SALES') {
      console.log('[CAMPAIGN] OUTCOME_SALES failed, trying OUTCOME_TRAFFIC');
      try {
        return await fbPostWithRetry(`${adAccountId}/campaigns`, accessToken, {
          ...payload,
          objective: 'OUTCOME_TRAFFIC',
        });
      } catch (err2: any) {
        // Re-throw with combined context
        const combined = new Error(`Campaign creation failed. Tried OUTCOME_SALES and OUTCOME_TRAFFIC. Last error: ${err2.message}`) as any;
        combined.fbError = err2.fbError;
        combined.status = err2.status;
        throw combined;
      }
    }
    throw err;
  }
}

/**
 * Create an ad set within a campaign.
 */
export async function createAdSet(
  adAccountId: string,
  accessToken: string,
  options: {
    name: string;
    campaignId: string;
    dailyBudget?: number;
    dailyBudgetCents?: number;
    optimizationGoal?: string;
    billingEvent?: string;
    status?: string;
    targeting?: Record<string, any>;
    pixelId?: string;
    startTime?: string;
    pageId?: string;
    [key: string]: any; // Allow additional fields from push-to-fb
  }
): Promise<{ id: string }> {
  const budget = options.dailyBudget || options.dailyBudgetCents || 3000;
  const body: Record<string, any> = {
    name: options.name,
    campaign_id: options.campaignId,
    daily_budget: budget,
    optimization_goal: options.optimizationGoal || 'OFFSITE_CONVERSIONS',
    billing_event: options.billingEvent || 'IMPRESSIONS',
    status: options.status || 'PAUSED',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: options.targeting || {
      geo_locations: { countries: ['US'] },
      age_min: 25,
      age_max: 65,
    },
  };

  // Add pixel for conversion tracking
  if (options.pixelId) {
    body.promoted_object = {
      pixel_id: options.pixelId,
      custom_event_type: 'PURCHASE',
    };
  }

  // Start time (must be in the future)
  if (options.startTime) {
    body.start_time = options.startTime;
  }

  return fbPostWithRetry(`${adAccountId}/adsets`, accessToken, body);
}

/**
 * Normalize a CTA value to a valid Meta call_to_action type.
 * Accepts: "Shop Now", "shop_now", "SHOP_NOW" → returns "SHOP_NOW"
 */
function normalizeCtaType(cta: string | undefined): string {
  if (!cta) return 'SHOP_NOW';
  const normalized = cta.trim().toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
  // Valid Meta CTA types — verified against API docs
  const validCtas = new Set([
    'SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'GET_OFFER', 'BOOK_TRAVEL', 'DOWNLOAD',
    'WATCH_MORE', 'CONTACT_US', 'APPLY_NOW', 'BUY_NOW', 'GET_QUOTE', 'SUBSCRIBE',
    'GET_SHOWTIMES', 'LISTEN_MUSIC', 'ORDER_NOW', 'GET_DIRECTIONS', 'OPEN_LINK',
    'CALL_NOW', 'INSTALL_APP', 'USE_APP', 'PLAY_GAME', 'INSTALL_MOBILE_APP',
    'USE_MOBILE_APP', 'MOBILE_DOWNLOAD', 'NO_BUTTON',
  ]);
  return validCtas.has(normalized) ? normalized : 'SHOP_NOW';
}

/**
 * Validate and normalize a landing page URL.
 * Returns a valid URL or throws.
 */
function validateLandingUrl(url: string): string {
  if (!url) throw new Error('Landing page URL is required');
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    // Auto-prepend https://
    return `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * Create an ad creative (image ad).
 */
export async function createAdCreative(
  adAccountId: string,
  accessToken: string,
  options: {
    name: string;
    pageId: string;
    // Image ad fields
    imageHash?: string;
    headline?: string;
    primaryText?: string;
    linkUrl?: string;
    callToAction?: string;
    description?: string;
    // Video ad fields (used by push-to-fb)
    videoId?: string;
    thumbnailUrl?: string;
    title?: string;
    message?: string;
    ctaType?: string;
    ctaLink?: string;
    [key: string]: any;
  }
): Promise<{ id: string }> {
  // Validate page ID
  if (!options.pageId) throw new Error('createAdCreative: pageId is required');

  // Video ad creative
  if (options.videoId) {
    const ctaLink = validateLandingUrl(options.ctaLink || options.linkUrl || '');
    const ctaType = normalizeCtaType(options.ctaType || options.callToAction);
    return fbPostWithRetry(`${adAccountId}/adcreatives`, accessToken, {
      name: options.name,
      object_story_spec: {
        page_id: options.pageId,
        video_data: {
          video_id: options.videoId,
          title: (options.title || options.headline || '').substring(0, 255),
          message: (options.message || options.primaryText || '').substring(0, 5000),
          image_url: options.thumbnailUrl || '',
          call_to_action: {
            type: ctaType,
            value: { link: ctaLink },
          },
        },
      },
    });
  }

  // Image ad creative
  if (!options.imageHash) throw new Error('createAdCreative: imageHash is required for image ads');
  const link = validateLandingUrl(options.linkUrl || options.ctaLink || '');
  const ctaType = normalizeCtaType(options.callToAction || options.ctaType);
  return fbPostWithRetry(`${adAccountId}/adcreatives`, accessToken, {
    name: options.name,
    object_story_spec: {
      page_id: options.pageId,
      link_data: {
        image_hash: options.imageHash,
        link,
        message: (options.primaryText || options.message || '').substring(0, 5000),
        name: (options.headline || options.title || '').substring(0, 255),
        description: (options.description || '').substring(0, 255),
        call_to_action: {
          type: ctaType,
          value: { link },
        },
      },
    },
  });
}

/**
 * Create an ad inside an ad set using a creative.
 */
export async function createAd(
  adAccountId: string,
  accessToken: string,
  options: {
    name: string;
    adSetId?: string;
    adsetId?: string; // alias used by push-to-fb
    creativeId: string;
    status?: string;
    [key: string]: any;
  }
): Promise<{ id: string }> {
  return fbPostWithRetry(`${adAccountId}/ads`, accessToken, {
    name: options.name,
    adset_id: options.adSetId || options.adsetId,
    creative: { creative_id: options.creativeId },
    status: options.status || 'PAUSED',
  });
}
