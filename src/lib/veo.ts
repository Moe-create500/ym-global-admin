/**
 * Google Veo — AI Video Generation via Gemini API
 * https://ai.google.dev/gemini-api/docs/video
 *
 * Models: veo-3.1-generate-preview, veo-3.1-fast-generate-preview, veo-2-generate-preview
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const API_KEY = () => process.env.GEMINI_API_KEY || '';

type VeoModel = 'veo-3.1-generate-preview' | 'veo-3.1-fast-generate-preview' | 'veo-2-generate-preview';

interface VeoOptions {
  model?: VeoModel;
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: '4' | '6' | '8';
  resolution?: '720p' | '1080p' | '4k';
  imageUrl?: string; // Reference image for image-to-video
}

export interface VeoVideoResult {
  operationName: string;
  status: string;
  model: string;
}

export interface VeoVideoStatus {
  status: 'processing' | 'completed' | 'failed';
  videoUrl: string | null;
  operationName: string;
}

async function veoFetch(url: string, method: 'GET' | 'POST' = 'GET', body?: any) {
  const key = API_KEY();
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const res = await fetch(url, {
    method,
    headers: {
      'x-goog-api-key': key,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Veo API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function createVideo(
  prompt: string,
  options: VeoOptions = {}
): Promise<VeoVideoResult> {
  const model = options.model || 'veo-3.1-fast-generate-preview';
  const url = `${BASE_URL}/models/${model}:predictLongRunning`;

  // Build instance with optional reference image
  const instance: any = { prompt };
  if (options.imageUrl) {
    const imgRes = await fetch(options.imageUrl);
    if (imgRes.ok) {
      const buf = await imgRes.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
      instance.image = { bytesBase64Encoded: base64, mimeType };
    }
  }

  const data = await veoFetch(url, 'POST', {
    instances: [instance],
    parameters: {
      aspectRatio: options.aspectRatio || '16:9',
      durationSeconds: options.durationSeconds || '8',
      resolution: options.resolution || '720p',
      personGeneration: 'allow_all',
      numberOfVideos: 1,
    },
  });

  return {
    operationName: data.name,
    status: data.done ? 'completed' : 'processing',
    model,
  };
}

export async function getVideoStatus(operationName: string): Promise<VeoVideoStatus> {
  const url = `${BASE_URL}/${operationName}`;
  const data = await veoFetch(url);

  if (data.done) {
    const samples = data.response?.generateVideoResponse?.generatedSamples;
    const videoUri = samples?.[0]?.video?.uri || null;

    if (data.error) {
      return { status: 'failed', videoUrl: null, operationName };
    }

    return {
      status: 'completed',
      videoUrl: videoUri,
      operationName,
    };
  }

  return { status: 'processing', videoUrl: null, operationName };
}
