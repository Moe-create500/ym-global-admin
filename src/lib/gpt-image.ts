/**
 * OpenAI GPT Image 2 — flagship multimodal image generation
 *
 * Different from src/lib/dalle.ts (the existing 'dalle' engine):
 *   - Always uses model='gpt-image-2' (no DALL-E 3 fallback)
 *   - Always saves b64_json output to /public/uploads (matches the stitched
 *     mp4 pattern from scene-stitch.ts)
 *   - Different return shape: {url, model, width, height} — no revisedPrompt
 *
 * Two endpoints:
 *   - /v1/images/generations (text-to-image, no reference)
 *   - /v1/images/edits      (image-to-image with referenceImageUrl)
 *
 * Sizes: 1024x1024, 1024x1536, 1536x1024 (+ 'auto'). Default 1024x1024.
 * Quality: low | medium | high | auto. Default 'medium' (cost balance).
 *
 * Logging prefix: [GPT-IMAGE]
 */

import { safeProviderFetch, createProviderError } from './provider-fetch';

const BASE_URL = 'https://api.openai.com/v1';
const MODEL = 'gpt-image-2';
const API_KEY = () => process.env.OPENAI_API_KEY || '';

export type GptImageSize = '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
export type GptImageQuality = 'low' | 'medium' | 'high' | 'auto';

export interface GptImageResult {
  url: string;
  model: string;
  width: number;
  height: number;
}

export interface GenerateGptImageOptions {
  size?: GptImageSize;
  quality?: GptImageQuality;
  referenceImageUrl?: string;
}

function parseDimensions(size: GptImageSize): { width: number; height: number } {
  if (size === 'auto' || size === '1024x1024') return { width: 1024, height: 1024 };
  if (size === '1024x1536') return { width: 1024, height: 1536 };
  if (size === '1536x1024') return { width: 1536, height: 1024 };
  return { width: 1024, height: 1024 };
}

export async function generateGptImage(
  prompt: string,
  options: GenerateGptImageOptions = {},
): Promise<GptImageResult> {
  const key = API_KEY();
  if (!key) {
    throw createProviderError({
      provider: 'gpt-image',
      code: 'MISSING_KEY',
      message: 'OPENAI_API_KEY not set',
      retryable: false,
      failoverEligible: true,
    });
  }

  const size = options.size || '1024x1024';
  const quality = options.quality || 'medium';
  const dims = parseDimensions(size);

  console.log(
    `[GPT-IMAGE] model=${MODEL} size=${size} quality=${quality} ref=${!!options.referenceImageUrl} prompt=${prompt.substring(0, 80)}...`,
  );

  // Reference-image (image-to-image) path: /v1/images/edits with FormData
  if (options.referenceImageUrl) {
    return generateWithReference(prompt, options.referenceImageUrl, size, quality, key, dims);
  }

  // Text-only (text-to-image) path: /v1/images/generations with JSON
  const result = await safeProviderFetch(
    `${BASE_URL}/images/generations`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: prompt.substring(0, 4000),
        n: 1,
        size,
        quality,
      }),
    },
    'gpt-image',
  );

  if (!result.ok) throw result.error;

  return await saveOrReturnImage(result.data, dims);
}

async function generateWithReference(
  prompt: string,
  referenceImageUrl: string,
  size: GptImageSize,
  quality: GptImageQuality,
  key: string,
  dims: { width: number; height: number },
): Promise<GptImageResult> {
  // Download reference image and resize to 1024x1024 (gpt-image-2's preferred
  // input). Mirrors the dalle.ts:generateWithReference pattern.
  let imageBuffer: Buffer | null = null;
  try {
    const imgRes = await fetch(referenceImageUrl);
    if (imgRes.ok) {
      const sharp = (await import('sharp')).default;
      const rawBuf = Buffer.from(await imgRes.arrayBuffer());
      imageBuffer = await sharp(rawBuf)
        .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
    }
  } catch (err: any) {
    console.error('[GPT-IMAGE] Failed to download reference image:', err?.message || err);
  }

  if (!imageBuffer) {
    // Reference image unreachable — fall through to text-only generation
    // without the ref. Same recovery the user would get if they hadn't
    // attached a reference at all.
    console.warn('[GPT-IMAGE] Reference image unreachable; falling back to text-only generation');
    return generateGptImage(prompt, { size, quality });
  }

  const formData = new FormData();
  formData.append('model', MODEL);
  formData.append('prompt', prompt.substring(0, 4000));
  formData.append('n', '1');
  formData.append('size', size);
  formData.append('quality', quality);
  const imageBlob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });
  formData.append('image[]', imageBlob, 'reference.png');

  // Raw fetch — FormData sets its own multipart boundary content-type.
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/images/edits`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: formData,
    });
  } catch (err: any) {
    throw createProviderError({
      provider: 'gpt-image',
      code: 'NETWORK',
      message: `Network error: ${err.message}`,
      retryable: true,
      failoverEligible: true,
    });
  }

  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    let msg = `GPT Image edit error ${res.status}`;
    let code = res.status >= 500 ? `PROVIDER_${res.status}` : 'API_ERROR';
    // gpt-image-2 may 403 with a verification-required message — surface
    // clearly so operators know to verify the OpenAI org.
    if (res.status === 403 && rawText.toLowerCase().includes('verification')) {
      code = 'ORG_VERIFICATION_REQUIRED';
      msg = 'OpenAI org not verified for gpt-image-2 access';
    }
    try {
      const p = JSON.parse(rawText);
      msg = p.error?.message || msg;
    } catch {}
    throw createProviderError({
      provider: 'gpt-image',
      code,
      message: msg,
      status: res.status,
      retryable: res.status >= 500,
      failoverEligible: true,
    });
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw createProviderError({
      provider: 'gpt-image',
      code: 'MALFORMED_JSON',
      message: 'GPT Image returned non-JSON response',
      retryable: true,
      failoverEligible: true,
    });
  }

  return await saveOrReturnImage(data, dims);
}

async function saveOrReturnImage(
  data: any,
  dims: { width: number; height: number },
): Promise<GptImageResult> {
  const imgData = data?.data?.[0];
  if (!imgData) {
    throw createProviderError({
      provider: 'gpt-image',
      code: 'NO_IMAGE',
      message: 'gpt-image-2 returned no image data',
      retryable: true,
      failoverEligible: true,
    });
  }

  if (imgData.b64_json) {
    // Save base64 → /public/uploads as a relative URL (same pattern as
    // the stitched mp4s from scene-stitch.ts). The /api/products/uploads
    // route serves the file back to clients.
    const { writeFile, mkdir } = await import('fs/promises');
    const path = await import('path');
    const crypto = await import('crypto');
    const filename = `gpt-image-${crypto.randomUUID()}.png`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), Buffer.from(imgData.b64_json, 'base64'));
    console.log(`[GPT-IMAGE] Saved ${filename} (${dims.width}x${dims.height})`);
    return {
      url: `/api/products/uploads?file=${filename}`,
      model: MODEL,
      width: dims.width,
      height: dims.height,
    };
  }

  // Fallback if the provider returned a hosted URL instead of b64_json.
  if (imgData.url) {
    console.log(`[GPT-IMAGE] Provider returned hosted URL (${dims.width}x${dims.height})`);
    return {
      url: imgData.url,
      model: MODEL,
      width: dims.width,
      height: dims.height,
    };
  }

  throw createProviderError({
    provider: 'gpt-image',
    code: 'NO_IMAGE',
    message: 'gpt-image-2 returned no usable image data (neither b64_json nor url)',
    retryable: true,
    failoverEligible: true,
  });
}
