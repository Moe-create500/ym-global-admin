/**
 * Higgsfield AI — Video Generation API
 * https://github.com/higgsfield-ai/higgsfield-js
 *
 * Uses the Higgsfield REST API directly (no SDK dependency).
 * Model: dop-turbo (image-to-video)
 * Auth: Key KEY_ID:KEY_SECRET
 */

const BASE_URL = 'https://platform.higgsfield.ai';
const STATUS_BASE = 'https://platform.higgsfield.ai';
const CREDENTIALS = () => process.env.HIGGSFIELD_API_KEY || '';

export interface HiggsFieldVideoResult {
  requestId: string;
  statusUrl: string;
}

export interface HiggsFieldVideoStatus {
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw';
  videoUrl: string | null;
  error: string | null;
}

async function higgsFetch(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any) {
  const creds = CREDENTIALS();
  if (!creds) {
    const err = new Error('HIGGSFIELD_API_KEY not set. Format: KEY_ID:KEY_SECRET') as any;
    err.code = 'missing_key';
    err.isQuota = false;
    throw err;
  }

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Key ${creds}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    let errorCode = 'api_error';
    let errorMessage = `Higgsfield API error ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      errorCode = parsed.error?.code || parsed.code || errorCode;
      errorMessage = parsed.error?.message || parsed.message || parsed.detail || errorMessage;
    } catch {
      errorMessage = text.substring(0, 200) || errorMessage;
    }
    const err = new Error(errorMessage) as any;
    err.code = errorCode;
    err.status = res.status;
    err.isQuota = res.status === 429 || res.status === 403 || errorCode === 'rate_limit_exceeded' || errorMessage.includes('Not enough credits');
    throw err;
  }

  return res.json();
}

/**
 * Create a video from an image + prompt using Higgsfield DOP Turbo.
 */
export async function createVideo(
  prompt: string,
  imageUrl: string,
): Promise<HiggsFieldVideoResult> {
  const data = await higgsFetch('/v1/image2video/dop', 'POST', {
    params: {
      model: 'dop-turbo',
      prompt: prompt.substring(0, 1000),
      input_images: [{
        type: 'image_url',
        image_url: imageUrl,
      }],
    },
  });

  return {
    requestId: data.request_id || data.id,
    statusUrl: data.status_url || `/requests/${data.request_id || data.id}/status`,
  };
}

/**
 * Poll the status of a Higgsfield generation task.
 */
export async function getVideoStatus(requestId: string): Promise<HiggsFieldVideoStatus> {
  const data = await higgsFetch(`/requests/${requestId}/status`);

  if (data.status === 'completed') {
    // Video URL can be in data.video.url or data.output[0]
    const videoUrl = data.video?.url || data.output?.[0] || null;
    return { status: 'completed', videoUrl, error: null };
  }

  if (data.status === 'failed' || data.status === 'nsfw') {
    return { status: data.status, videoUrl: null, error: data.failure || data.error || 'Generation failed' };
  }

  // queued or in_progress
  return { status: data.status, videoUrl: null, error: null };
}
