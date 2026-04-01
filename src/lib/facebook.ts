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
        allCharges.push({
          event_time: item.event_time,
          date: item.event_time.slice(0, 10),
          amount_cents: extra.new_value,
          currency: extra.currency || 'USD',
          transaction_id: extra.transaction_id,
        });
      } catch {
        continue;
      }
    }

    url = data.paging?.next || '';
  }

  return allCharges;
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
