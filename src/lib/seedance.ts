/**
 * Seedance 2.0 — ByteDance AI Video Generation via fal.ai
 *
 * Uses the same FAL_KEY as Nano Banana.
 * Supports: text-to-video, image-to-video, 4-15s duration,
 * 2K resolution, native audio generation, multi-aspect ratio.
 *
 * Key advantage: native audio sync — generates voiceover/sound
 * IN the video, no separate TTS step needed.
 */

const FAL_KEY = () => process.env.FAL_KEY || '';

export interface SeedanceVideoResult {
  videoUrl: string;
  model: string;
  seed?: number;
}

export interface SeedanceVideoStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  videoUrl: string | null;
  error: string | null;
}

/**
 * Create a video from text prompt (text-to-video).
 */
export async function createTextToVideo(
  prompt: string,
  options: {
    duration?: number;  // 4-15 seconds
    aspectRatio?: string;
    resolution?: '480p' | '720p' | '1080p';
    generateAudio?: boolean;
    seed?: number;
  } = {}
): Promise<{ requestId: string; model: string }> {
  const key = FAL_KEY();
  if (!key) {
    const err = new Error('FAL_KEY not set — needed for Seedance 2.0') as any;
    err.code = 'MISSING_KEY';
    err.isQuota = false;
    throw err;
  }

  const arMap: Record<string, string> = {
    '1:1': '1:1', '4:5': '3:4', '9:16': '9:16', '16:9': '16:9',
    '3:4': '3:4', '4:3': '4:3', 'portrait': '9:16', 'landscape': '16:9',
  };

  const duration = Math.max(4, Math.min(15, options.duration || 8));

  console.log(`[SEEDANCE] Text-to-video: dur=${duration}s, res=${options.resolution || '720p'}, aspect=${options.aspectRatio || '9:16'}, prompt=${prompt.substring(0, 80)}...`);

  let res: Response;
  try {
    res = await fetch('https://queue.fal.run/bytedance/seedance-2.0/text-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt.substring(0, 5000),
        duration: String(duration),
        aspect_ratio: arMap[options.aspectRatio || '9:16'] || '9:16',
        resolution: options.resolution || '720p',
        generate_audio: true,
        ...(options.seed ? { seed: options.seed } : {}),
      }),
    });
  } catch (netErr: any) {
    console.error(`[SEEDANCE] Network error:`, netErr.message);
    throw new Error(`Seedance network error: ${netErr.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    console.error(`[SEEDANCE] API error ${res.status}: ${text.substring(0, 300)}`);
    const err = new Error(`Seedance API error ${res.status}: ${text.substring(0, 300)}`) as any;
    err.status = res.status;
    err.isQuota = res.status === 429 || res.status === 402;
    throw err;
  }

  const data = await res.json();
  console.log(`[SEEDANCE] T2V queued: ${data.request_id}`);
  return { requestId: data.request_id, model: 'seedance-2.0' };
}

/**
 * Create a video from an image + prompt (image-to-video).
 * The image becomes the starting frame.
 */
export async function createImageToVideo(
  prompt: string,
  imageUrl: string,
  options: {
    duration?: number;
    aspectRatio?: string;
    resolution?: '480p' | '720p' | '1080p';
    generateAudio?: boolean;
    endImageUrl?: string;  // optional end frame
    seed?: number;
  } = {}
): Promise<{ requestId: string; model: string }> {
  const key = FAL_KEY();
  if (!key) {
    const err = new Error('FAL_KEY not set') as any;
    err.code = 'MISSING_KEY';
    err.isQuota = false;
    throw err;
  }

  const arMap: Record<string, string> = {
    '1:1': '1:1', '4:5': '3:4', '9:16': '9:16', '16:9': '16:9',
    '3:4': '3:4', '4:3': '4:3',
  };

  const duration = Math.max(4, Math.min(15, options.duration || 8));

  console.log(`[SEEDANCE] Image-to-video: dur=${duration}s, res=${options.resolution || '720p'}, image=${imageUrl.substring(0, 60)}..., prompt=${prompt.substring(0, 80)}...`);

  let res: Response;
  try {
    res = await fetch('https://queue.fal.run/bytedance/seedance-2.0/image-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt.substring(0, 5000),
        image_url: imageUrl,
        duration: String(duration),
        aspect_ratio: arMap[options.aspectRatio || '9:16'] || '9:16',
        resolution: options.resolution || '720p',
        generate_audio: true,
        ...(options.endImageUrl ? { end_image_url: options.endImageUrl } : {}),
        ...(options.seed ? { seed: options.seed } : {}),
      }),
    });
  } catch (netErr: any) {
    console.error(`[SEEDANCE] Network error:`, netErr.message);
    throw new Error(`Seedance network error: ${netErr.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    console.error(`[SEEDANCE] I2V API error ${res.status}: ${text.substring(0, 300)}`);
    const err = new Error(`Seedance API error ${res.status}: ${text.substring(0, 300)}`) as any;
    err.status = res.status;
    err.isQuota = res.status === 429 || res.status === 402;
    throw err;
  }

  let data: any;
  try { data = await res.json(); } catch { throw new Error('Seedance returned non-JSON response'); }
  console.log(`[SEEDANCE] I2V queued: ${data.request_id}`);
  return { requestId: data.request_id, model: 'seedance-2.0' };
}

/**
 * Create a video using reference images + audio (reference-to-video).
 * This is the KEY endpoint for UGC ads:
 *   - Pass product image as @Image1 (character/product reference)
 *   - Pass TTS audio as @Audio1 (lip-sync voiceover)
 *   - Seedance generates video with character speaking YOUR audio
 *
 * Prompt uses @Image1, @Audio1 tags to reference inputs.
 */
export async function createReferenceToVideo(
  prompt: string,
  options: {
    imageUrls?: string[];   // up to 9 reference images
    audioUrls?: string[];   // up to 3 audio clips (MP3/WAV)
    videoUrls?: string[];   // up to 3 reference videos
    duration?: number;
    aspectRatio?: string;
    resolution?: '480p' | '720p';
    seed?: number;
  } = {}
): Promise<{ requestId: string; model: string }> {
  const key = FAL_KEY();
  if (!key) {
    const err = new Error('FAL_KEY not set — needed for Seedance 2.0') as any;
    err.code = 'MISSING_KEY';
    throw err;
  }

  const duration = Math.max(4, Math.min(15, options.duration || 10));
  const arMap: Record<string, string> = {
    '1:1': '1:1', '4:5': '3:4', '9:16': '9:16', '16:9': '16:9',
    '3:4': '3:4', '4:3': '4:3', 'portrait': '9:16', 'landscape': '16:9',
  };

  const body: Record<string, any> = {
    prompt: prompt.substring(0, 5000),
    duration: String(duration),
    aspect_ratio: arMap[options.aspectRatio || '9:16'] || '9:16',
    resolution: options.resolution || '480p',
    generate_audio: true,
  };

  if (options.imageUrls?.length) body.image_urls = options.imageUrls;
  if (options.audioUrls?.length) body.audio_urls = options.audioUrls;
  if (options.videoUrls?.length) body.video_urls = options.videoUrls;
  if (options.seed) body.seed = options.seed;

  console.log(`[SEEDANCE] Reference-to-video: dur=${duration}s, images=${options.imageUrls?.length || 0}, audio=${options.audioUrls?.length || 0}, prompt=${prompt.substring(0, 80)}...`);

  const res = await fetch('https://queue.fal.run/bytedance/seedance-2.0/reference-to-video', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    console.error(`[SEEDANCE] R2V API error ${res.status}: ${text.substring(0, 300)}`);
    const err = new Error(`Seedance R2V error ${res.status}: ${text.substring(0, 300)}`) as any;
    err.status = res.status;
    err.isQuota = res.status === 429 || res.status === 402;
    throw err;
  }

  const data = await res.json();
  console.log(`[SEEDANCE] R2V queued: ${data.request_id}`);
  return { requestId: data.request_id, model: 'seedance-2.0-r2v' };
}

/**
 * Poll the status of a Seedance generation.
 */
export async function getVideoStatus(
  requestId: string,
  _endpoint?: string, // ignored — status URL doesn't include sub-path
): Promise<SeedanceVideoStatus> {
  const key = FAL_KEY();
  if (!key) throw new Error('FAL_KEY not set');

  // Status endpoint is always bytedance/seedance-2.0 (no /text-to-video or /image-to-video)
  const baseModel = 'bytedance/seedance-2.0';
  const statusRes = await fetch(`https://queue.fal.run/${baseModel}/requests/${requestId}/status`, {
    headers: { 'Authorization': `Key ${key}` },
  });

  if (!statusRes.ok) {
    return { status: 'FAILED', videoUrl: null, error: `Status check failed: ${statusRes.status}` };
  }

  const status = await statusRes.json();

  if (status.status === 'COMPLETED') {
    // Fetch actual result
    const resultRes = await fetch(`https://queue.fal.run/${baseModel}/requests/${requestId}`, {
      headers: { 'Authorization': `Key ${key}` },
    });
    if (!resultRes.ok) {
      return { status: 'FAILED', videoUrl: null, error: 'Failed to fetch result' };
    }
    const result = await resultRes.json();
    const videoUrl = result.video?.url || null;
    return { status: 'COMPLETED', videoUrl, error: null };
  }

  if (status.status === 'FAILED') {
    return { status: 'FAILED', videoUrl: null, error: status.error || 'Generation failed' };
  }

  return { status: status.status, videoUrl: null, error: null };
}

/**
 * Helper: wait for a Seedance video to complete.
 */
export async function waitForVideo(
  requestId: string,
  _endpoint?: string,
  timeoutMs: number = 300000,
  pollIntervalMs: number = 5000,
): Promise<{ videoUrl: string }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const status = await getVideoStatus(requestId);

    if (status.status === 'COMPLETED' && status.videoUrl) {
      return { videoUrl: status.videoUrl };
    }

    if (status.status === 'FAILED') {
      throw new Error(status.error || 'Seedance generation failed');
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error('Seedance generation timed out');
}
