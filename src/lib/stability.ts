/**
 * Stability AI Image Generation (SDXL)
 * Uses STABILITY_API_KEY env var
 *
 * Best for: product-focused clean ad renders with strong prompt adherence.
 * Supports: text-to-image, image-to-image (with reference/init image).
 */

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const BASE_URL = 'https://api.stability.ai/v2beta';
const API_KEY = () => process.env.STABILITY_API_KEY || '';

export interface StabilityImageResult {
  imageUrl: string;
  model: string;
  seed?: number;
}

/**
 * Generate image with Stability AI.
 * If referenceImageUrl is provided, uses image-to-image mode.
 */
export async function generateImage(
  prompt: string,
  options: {
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5' | '5:4' | '3:2' | '2:3';
    negativePrompt?: string;
    referenceImageUrl?: string;
    strength?: number; // 0-1, how much to deviate from reference (0.35 = keep product, change scene)
  } = {}
): Promise<StabilityImageResult> {
  const key = API_KEY();
  if (!key) throw new Error('STABILITY_API_KEY not set');

  // If reference image: use image-to-image
  if (options.referenceImageUrl) {
    return generateWithReference(prompt, options.referenceImageUrl, options, key);
  }

  // Text-to-image
  const formData = new FormData();
  formData.append('prompt', prompt.substring(0, 10000));
  formData.append('output_format', 'png');
  formData.append('aspect_ratio', options.aspectRatio || '1:1');
  if (options.negativePrompt) {
    formData.append('negative_prompt', options.negativePrompt);
  }

  const res = await fetch(`${BASE_URL}/stable-image/generate/sd3`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Accept': 'image/*',
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    let msg = `Stability error ${res.status}`;
    try { const p = JSON.parse(text); msg = p.message || p.errors?.join(', ') || msg; } catch {}
    const err = new Error(msg) as any;
    err.status = res.status;
    err.isQuota = res.status === 402 || res.status === 429;
    throw err;
  }

  // Response is raw image bytes
  const imageBytes = Buffer.from(await res.arrayBuffer());
  const filename = `stability_${crypto.randomUUID()}.png`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), imageBytes);

  return {
    imageUrl: `/api/products/uploads?file=${filename}`,
    model: 'sd3',
  };
}

/**
 * Image-to-image: use product reference as init image.
 * Low strength (0.3-0.5) preserves product, changes background/context.
 */
async function generateWithReference(
  prompt: string,
  referenceImageUrl: string,
  options: any,
  key: string,
): Promise<StabilityImageResult> {
  // Download reference image
  let imageBuffer: Buffer;
  try {
    const imgRes = await fetch(referenceImageUrl);
    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
    const sharp = (await import('sharp')).default;
    const rawBuf = Buffer.from(await imgRes.arrayBuffer());
    imageBuffer = await sharp(rawBuf)
      .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();
  } catch (err) {
    console.error('[STABILITY] Failed to download reference image, falling back to text-to-image:', err);
    return generateImage(prompt, { ...options, referenceImageUrl: undefined });
  }

  const formData = new FormData();
  formData.append('prompt', prompt.substring(0, 10000));
  formData.append('output_format', 'png');
  formData.append('strength', String(options.strength || 0.45));
  formData.append('mode', 'image-to-image');
  if (options.negativePrompt) {
    formData.append('negative_prompt', options.negativePrompt);
  }

  const imageBlob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });
  formData.append('image', imageBlob, 'product.png');

  const res = await fetch(`${BASE_URL}/stable-image/generate/sd3`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Accept': 'image/*',
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    let msg = `Stability img2img error ${res.status}`;
    try { const p = JSON.parse(text); msg = p.message || p.errors?.join(', ') || msg; } catch {}
    if (res.status === 402 || res.status === 400) {
      console.log('[STABILITY] img2img failed, falling back to text-to-image');
      return generateImage(prompt, { ...options, referenceImageUrl: undefined });
    }
    const err = new Error(msg) as any;
    err.status = res.status;
    err.isQuota = res.status === 402 || res.status === 429;
    throw err;
  }

  const imageBytes = Buffer.from(await res.arrayBuffer());
  const filename = `stability_${crypto.randomUUID()}.png`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), imageBytes);

  return {
    imageUrl: `/api/products/uploads?file=${filename}`,
    model: 'sd3-img2img',
  };
}
