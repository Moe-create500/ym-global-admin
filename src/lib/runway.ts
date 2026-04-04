/**
 * Runway — AI Video Generation API
 * https://docs.dev.runwayml.com/
 *
 * Uses the Runway Gen-4 API for image-to-video generation.
 * Optimized for product-accurate branded video content.
 */

const BASE_URL = 'https://api.dev.runwayml.com/v1';
const API_KEY = () => process.env.RUNWAY_API_KEY || '';

export interface RunwayVideoResult {
  taskId: string;
  status: string;
}

export interface RunwayVideoStatus {
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  videoUrl: string | null;
  progress: number;
  error: string | null;
}

async function runwayFetch(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any) {
  const key = API_KEY();
  if (!key) {
    const err = new Error('RUNWAY_API_KEY not set') as any;
    err.isQuota = false;
    err.code = 'missing_key';
    throw err;
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      'X-Runway-Version': '2024-11-06',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    let errorCode = 'api_error';
    let errorMessage = `Runway API error ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      errorCode = parsed.error?.code || parsed.code || errorCode;
      errorMessage = parsed.error?.message || parsed.error || parsed.message || errorMessage;
      if (parsed.issues) errorMessage += ': ' + parsed.issues.map((i: any) => i.message).join(', ');
    } catch {
      errorMessage = text.substring(0, 200) || errorMessage;
    }
    const err = new Error(errorMessage) as any;
    err.code = errorCode;
    err.status = res.status;
    err.isQuota = res.status === 429 || errorCode === 'rate_limit_exceeded';
    throw err;
  }

  return res.json();
}

/**
 * Create a video from an image + prompt using Runway Gen-4 Turbo.
 *
 * @param prompt - Text description of what should happen in the video
 * @param imageUrl - URL of the product/reference image (used as first frame)
 * @param options - Duration (5 or 10 seconds), ratio
 */
export async function createVideo(
  prompt: string,
  imageUrl: string,
  options: {
    duration?: 5 | 10;
    ratio?: '1280:720' | '720:1280' | '1104:832' | '832:1104' | '960:960';
    model?: string;
  } = {}
): Promise<RunwayVideoResult> {
  const model = options.model || 'gen4_turbo';
  const duration = options.duration || 10;
  const ratio = options.ratio || '720:1280'; // vertical by default

  const data = await runwayFetch('/image_to_video', 'POST', {
    model,
    promptImage: imageUrl,
    promptText: prompt.substring(0, 1000),
    duration,
    ratio,
  });

  return {
    taskId: data.id,
    status: data.status || 'PENDING',
  };
}

/**
 * Poll the status of a Runway video generation task.
 */
export async function getVideoStatus(taskId: string): Promise<RunwayVideoStatus> {
  const data = await runwayFetch(`/tasks/${taskId}`);

  return {
    status: data.status,
    videoUrl: data.output?.[0] || null,
    progress: data.progress || 0,
    error: data.failure || null,
  };
}
