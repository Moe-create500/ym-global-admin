/**
 * OpenAI Sora — AI Video Generation API
 * https://developers.openai.com/api/docs/guides/video-generation/
 *
 * Uses the OpenAI Videos API (POST /v1/videos).
 * Models: sora-2 (fast), sora-2-pro (higher quality, supports 1080p).
 */

const BASE_URL = 'https://api.openai.com/v1';
const API_KEY = () => process.env.OPENAI_API_KEY || '';

type SoraModel = 'sora-2' | 'sora-2-pro';

interface SoraOptions {
  model?: SoraModel;
  size?: '1280x720' | '720x1280' | '1920x1080' | '1080x1920';
  seconds?: '8' | '16' | '20';
  /** Product/reference image URL — Sora uses this as the first frame */
  imageUrl?: string;
  /** Pre-resized image buffer (must match output dimensions exactly) */
  imageBuffer?: Buffer;
  imageMimeType?: string;
}

export interface SoraVideoResult {
  videoId: string;
  status: string;
  model: string;
  seconds: string;
  size: string;
}

export interface SoraVideoStatus {
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  videoId: string;
}

async function soraFetch(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any) {
  const key = API_KEY();
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Sora API error ${res.status}: ${text}`);
  }

  // For download endpoint, return the response directly
  if (endpoint.includes('/content')) {
    return res;
  }

  return res.json();
}

export async function createVideo(
  prompt: string,
  options: SoraOptions = {}
): Promise<SoraVideoResult> {
  const key = API_KEY();
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const model = options.model || 'sora-2';
  const size = options.size || '720x1280';
  const seconds = options.seconds || '8';

  let data: any;

  if (options.imageBuffer) {
    // Use multipart form-data to send the pre-resized image as input_reference
    const formData = new FormData();
    formData.append('model', model);
    formData.append('prompt', prompt);
    formData.append('size', size);
    formData.append('seconds', seconds);
    const imgBlob = new Blob([options.imageBuffer as unknown as BlobPart], { type: options.imageMimeType || 'image/png' });
    formData.append('input_reference', imgBlob, 'product.png');

    const res = await fetch(`${BASE_URL}/videos`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Sora API error ${res.status}: ${text}`);
    }
    data = await res.json();
  } else {
    // JSON request (with optional image URL)
    const body: any = { model, prompt, size, seconds };
    if (options.imageUrl) {
      body.input_reference = { image_url: options.imageUrl };
    }
    data = await soraFetch('/videos', 'POST', body);
  }

  return {
    videoId: data.id,
    status: data.status,
    model: data.model,
    seconds: data.seconds,
    size: data.size,
  };
}

export async function getVideoStatus(videoId: string): Promise<SoraVideoStatus> {
  const data = await soraFetch(`/videos/${videoId}`);
  return {
    status: data.status,
    progress: data.progress || 0,
    videoId: data.id,
  };
}

export async function getVideoDownloadUrl(videoId: string): Promise<string> {
  // The content endpoint returns the video file directly
  // We construct the URL with auth — caller can use it as-is
  return `${BASE_URL}/videos/${videoId}/content?variant=video`;
}

export async function getThumbnailUrl(videoId: string): Promise<string> {
  return `${BASE_URL}/videos/${videoId}/content?variant=thumbnail`;
}
