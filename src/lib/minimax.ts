/**
 * MiniMax (Hailuo) — AI Video & Image Generation API
 * https://platform.minimax.io/docs/guides/video-generation
 * https://platform.minimax.io/docs/guides/image-generation
 *
 * Video models: MiniMax-Hailuo-2.3, MiniMax-Hailuo-02, S2V-01
 * Image model: image-01
 */

const BASE_URL = 'https://api.minimax.io/v1';
const API_KEY = () => process.env.MINIMAX_API_KEY || '';

type VideoModel = 'MiniMax-Hailuo-2.3' | 'MiniMax-Hailuo-02' | 'S2V-01';

interface VideoOptions {
  model?: VideoModel;
  duration?: number;
  resolution?: string;
  firstFrameImage?: string;
}

interface ImageOptions {
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
}

export interface MinimaxVideoResult {
  taskId: string;
  model: string;
}

export interface MinimaxVideoStatus {
  status: 'processing' | 'completed' | 'failed';
  fileId: string | null;
  videoUrl: string | null;
  error: string | null;
}

export interface MinimaxImageResult {
  imageBase64: string;
  imageUrl: string;
  model: string;
}

async function minimaxFetch(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any) {
  const key = API_KEY();
  if (!key) throw new Error('MINIMAX_API_KEY not set');

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`MiniMax API error ${res.status}: ${text}`);
  }

  const json = await res.json();

  // MiniMax returns 200 with error in body
  if (json.base_resp?.status_code && json.base_resp.status_code !== 0) {
    throw new Error(`MiniMax error ${json.base_resp.status_code}: ${json.base_resp.status_msg || 'Unknown'}`);
  }

  return json;
}

// --- Video Generation ---

export async function createVideo(
  prompt: string,
  options: VideoOptions = {}
): Promise<MinimaxVideoResult> {
  const model = options.model || 'MiniMax-Hailuo-2.3';
  const payload: any = {
    model,
    prompt,
    duration: options.duration || 6,
    resolution: options.resolution || '1080P',
  };

  if (options.firstFrameImage) {
    payload.first_frame_image = options.firstFrameImage;
  }

  const data = await minimaxFetch('/video_generation', 'POST', payload);

  return {
    taskId: data.task_id,
    model,
  };
}

export async function getVideoStatus(taskId: string): Promise<MinimaxVideoStatus> {
  const data = await minimaxFetch(`/query/video_generation?task_id=${taskId}`);

  if (data.status === 'Success') {
    let videoUrl: string | null = null;
    if (data.file_id) {
      const fileData = await minimaxFetch(`/files/retrieve?file_id=${data.file_id}`);
      videoUrl = fileData.file?.download_url || null;
    }
    return { status: 'completed', fileId: data.file_id, videoUrl, error: null };
  }

  if (data.status === 'Fail') {
    return { status: 'failed', fileId: null, videoUrl: null, error: data.error_message || 'Generation failed' };
  }

  return { status: 'processing', fileId: null, videoUrl: null, error: null };
}

// --- Image Generation ---

export async function generateImage(
  prompt: string,
  options: ImageOptions = {}
): Promise<MinimaxImageResult> {
  const data = await minimaxFetch('/image_generation', 'POST', {
    model: 'image-01',
    prompt,
    aspect_ratio: options.aspectRatio || '16:9',
    response_format: 'url',
    n: 1,
  });

  // MiniMax response: { data: { image_url: ["https://..."] } } when response_format is 'url'
  // or { data: { image_base64: ["base64..."] } } when response_format is 'b64_json'
  const imageUrl = data.data?.image_url?.[0] || data.data?.image_base64?.[0] || '';

  if (!imageUrl) {
    const errMsg = data.base_resp?.status_msg || JSON.stringify(data).substring(0, 200);
    throw new Error(`MiniMax returned no image: ${errMsg}`);
  }

  return {
    imageBase64: imageUrl,
    imageUrl: imageUrl,
    model: 'image-01',
  };
}
