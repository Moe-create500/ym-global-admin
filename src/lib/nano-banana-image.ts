/**
 * Nano Banana 2 — AI Image Generation via fal.ai
 *
 * Powered by Google's Gemini 3.1 Flash Image.
 * Best for: text-heavy ad statics, product scenes with readable text,
 * marketing creatives with in-image typography.
 *
 * Two modes:
 * 1. Text-to-image: generate from prompt only (fal-ai/nano-banana-2)
 * 2. Image editing: generate with product reference images (fal-ai/nano-banana-pro/edit)
 *
 * Supports: 4K resolution, text rendering, multiple aspect ratios,
 * subject consistency, reference image editing.
 */

const FAL_KEY = () => process.env.FAL_KEY || '';

export interface NanoBananaImageResult {
  imageUrl: string;
  model: string;
  width?: number;
  height?: number;
}

/**
 * Generate an image from a text prompt.
 * No reference images — pure text-to-image.
 */
export async function generateImage(
  prompt: string,
  options: {
    aspectRatio?: string;
    resolution?: '0.5K' | '1K' | '2K' | '4K';
    numImages?: number;
  } = {}
): Promise<NanoBananaImageResult> {
  const key = FAL_KEY();
  if (!key) {
    const err = new Error('FAL_KEY not set — needed for Nano Banana 2') as any;
    err.code = 'MISSING_KEY';
    err.failoverEligible = true;
    throw err;
  }

  // Map common aspect ratios
  const arMap: Record<string, string> = {
    '1:1': '1:1', '4:5': '4:5', '9:16': '9:16', '16:9': '16:9',
    '3:4': '3:4', '4:3': '4:3', '3:2': '3:2', '2:3': '2:3',
    'square': '1:1', 'portrait': '4:5', 'vertical': '9:16', 'landscape': '16:9',
  };
  const aspectRatio = arMap[options.aspectRatio || '4:5'] || '4:5';

  console.log(`[NANO-BANANA] Generating: aspect=${aspectRatio}, res=${options.resolution || '1K'}, prompt=${prompt.substring(0, 80)}...`);

  const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-2', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: prompt.substring(0, 10000),
      num_images: 1,
      aspect_ratio: aspectRatio,
      resolution: options.resolution || '1K',
      output_format: 'png',
      safety_tolerance: 4,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    const err = new Error(`Nano Banana API error ${res.status}: ${text.substring(0, 300)}`) as any;
    err.status = res.status;
    err.failoverEligible = true;
    err.isQuota = res.status === 429 || res.status === 402;
    throw err;
  }

  const data = await res.json();

  // fal.ai queue returns a request_id — need to poll for result
  if (data.request_id && !data.images) {
    return await pollForResult(data.request_id, key);
  }

  const img = data.images?.[0];
  if (!img?.url) {
    const err = new Error('Nano Banana returned no image') as any;
    err.code = 'NO_IMAGE';
    err.failoverEligible = true;
    throw err;
  }

  return { imageUrl: img.url, model: 'nano-banana-2', width: img.width, height: img.height };
}

/**
 * Edit/transform an image using reference images + prompt.
 * Uses Nano Banana Pro edit endpoint.
 * Ideal for: placing products in scenes, changing backgrounds, style transfer.
 */
export async function editImage(
  prompt: string,
  imageUrls: string[],
  options: {
    aspectRatio?: string;
    resolution?: '1K' | '2K' | '4K';
  } = {}
): Promise<NanoBananaImageResult> {
  const key = FAL_KEY();
  if (!key) {
    const err = new Error('FAL_KEY not set') as any;
    err.code = 'MISSING_KEY';
    err.failoverEligible = true;
    throw err;
  }

  const arMap: Record<string, string> = {
    '1:1': '1:1', '4:5': '4:5', '9:16': '9:16', '16:9': '16:9',
    '3:4': '3:4', '4:3': '4:3',
  };

  console.log(`[NANO-BANANA] Editing with ${imageUrls.length} reference image(s): prompt=${prompt.substring(0, 80)}...`);

  const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-pro/edit', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: prompt.substring(0, 10000),
      image_urls: imageUrls,
      num_images: 1,
      aspect_ratio: arMap[options.aspectRatio || '4:5'] || '4:5',
      resolution: options.resolution || '1K',
      output_format: 'png',
      safety_tolerance: 4,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    const err = new Error(`Nano Banana Edit API error ${res.status}: ${text.substring(0, 300)}`) as any;
    err.status = res.status;
    err.failoverEligible = true;
    err.isQuota = res.status === 429 || res.status === 402;
    throw err;
  }

  const data = await res.json();

  if (data.request_id && !data.images) {
    return await pollForResult(data.request_id, key, 'fal-ai/nano-banana-pro/edit');
  }

  const img = data.images?.[0];
  if (!img?.url) {
    const err = new Error('Nano Banana Edit returned no image') as any;
    err.code = 'NO_IMAGE';
    err.failoverEligible = true;
    throw err;
  }

  return { imageUrl: img.url, model: 'nano-banana-pro-edit', width: img.width, height: img.height };
}

/**
 * Poll fal.ai queue for result.
 */
async function pollForResult(
  requestId: string,
  key: string,
  model: string = 'fal-ai/nano-banana-2',
): Promise<NanoBananaImageResult> {
  const maxPolls = 30;
  const pollInterval = 3000;

  // Strip sub-endpoints (/edit, /generate, etc.) from the model path for status polling.
  // fal.ai status URL is always the BASE model, not the sub-endpoint.
  // e.g. 'fal-ai/nano-banana-pro/edit' → 'fal-ai/nano-banana-pro'
  const baseModel = model.replace(/\/(edit|generate|text-to-image|image-to-video|text-to-video)$/i, '');

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, pollInterval));

    const res = await fetch(`https://queue.fal.run/${baseModel}/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${key}` },
    });

    if (!res.ok) {
      if (i === 0) console.log(`[NANO-BANANA] Poll ${i + 1}: HTTP ${res.status} (model=${baseModel})`);
      continue;
    }
    const status = await res.json();

    if (status.status === 'COMPLETED') {
      // Fetch the actual result
      const resultRes = await fetch(`https://queue.fal.run/${baseModel}/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${key}` },
      });
      if (!resultRes.ok) throw new Error('Failed to fetch completed result');
      const result = await resultRes.json();
      const img = result.images?.[0];
      if (!img?.url) throw new Error('No image in completed result');
      return { imageUrl: img.url, model: model.includes('pro') ? 'nano-banana-pro' : 'nano-banana-2', width: img.width, height: img.height };
    }

    if (status.status === 'FAILED') {
      throw new Error(`Nano Banana generation failed: ${status.error || 'Unknown'}`);
    }
  }

  throw new Error('Nano Banana generation timed out');
}
