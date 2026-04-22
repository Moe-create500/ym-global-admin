/**
 * OpenAI Image Generation
 * Supports:
 * - gpt-image-1: reference image support via /images/edits (sends actual image data)
 * - dall-e-3: text-only fallback
 *
 * Uses safe response parsing — never crashes on 502/HTML responses.
 */

import { safeProviderFetch, createProviderError } from './provider-fetch';

const BASE_URL = 'https://api.openai.com/v1';
const API_KEY = () => process.env.OPENAI_API_KEY || '';

export interface DalleImageResult {
  imageUrl: string;
  model: string;
  revisedPrompt: string;
}

export async function generateImage(
  prompt: string,
  options: {
    size?: '1024x1024' | '1024x1792' | '1792x1024';
    quality?: 'standard' | 'hd' | 'low' | 'medium' | 'high' | 'auto';
    style?: 'natural' | 'vivid';
    referenceImageUrl?: string;
  } = {}
): Promise<DalleImageResult> {
  const key = API_KEY();
  if (!key) throw createProviderError({ provider: 'dalle', code: 'MISSING_KEY', message: 'OPENAI_API_KEY not set', retryable: false, failoverEligible: true });

  // If we have a reference image, try gpt-image-1 with actual image input
  if (options.referenceImageUrl) {
    return generateWithReference(prompt, options.referenceImageUrl, options, key);
  }

  // DALL-E 3 text-only
  const result = await safeProviderFetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt.substring(0, 4000),
      n: 1,
      size: options.size || '1024x1024',
      quality: options.quality || 'standard',
      style: options.style || 'natural',
      response_format: 'url',
    }),
  }, 'dalle');

  if (!result.ok) throw result.error;

  const imgUrl = result.data?.data?.[0]?.url;
  if (!imgUrl) throw createProviderError({ provider: 'dalle', code: 'NO_IMAGE', message: 'DALL-E returned no image URL', retryable: true, failoverEligible: true });

  return {
    imageUrl: imgUrl,
    model: 'dall-e-3',
    revisedPrompt: result.data.data[0].revised_prompt || '',
  };
}

async function generateWithReference(
  prompt: string,
  referenceImageUrl: string,
  options: any,
  key: string,
): Promise<DalleImageResult> {
  // Download and prepare reference image
  let imageBuffer: Buffer | null = null;
  try {
    const imgRes = await fetch(referenceImageUrl);
    if (imgRes.ok) {
      const sharp = (await import('sharp')).default;
      const rawBuf = Buffer.from(await imgRes.arrayBuffer());
      imageBuffer = await sharp(rawBuf)
        .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png().toBuffer();
    }
  } catch (err) {
    console.error('[DALLE] Failed to download reference image:', err);
  }

  // Try /images/edits with actual image data
  if (imageBuffer) {
    try {
      return await generateWithImageInput(prompt, imageBuffer, options, key);
    } catch (err: any) {
      console.log('[DALLE] Image edit failed, trying text-only gpt-image-1:', err.message?.substring(0, 100));
    }
  }

  // Fallback: gpt-image-1 text-only
  const enhancedPrompt = `${prompt}\n\nThe product must match the branding from the reference. Copy the exact bottle shape, label design, colors, and cap shape.`;

  const result = await safeProviderFetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: enhancedPrompt.substring(0, 4000),
      n: 1,
      size: options.size || '1024x1024',
    }),
  }, 'dalle');

  if (!result.ok) {
    // Don't retry with dall-e-3 — that doubles API cost. Just let failover handle it.
    throw result.error;
  }

  return saveImageResponse(result.data);
}

async function generateWithImageInput(
  prompt: string,
  imageBuffer: Buffer,
  options: any,
  key: string,
): Promise<DalleImageResult> {
  const formData = new FormData();
  formData.append('model', 'gpt-image-1');
  formData.append('prompt', prompt.substring(0, 4000));
  formData.append('n', '1');
  formData.append('size', options.size || '1024x1024');
  const imageBlob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });
  formData.append('image[]', imageBlob, 'product.png');

  // Use raw fetch here since FormData sets its own content-type
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/images/edits`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: formData,
    });
  } catch (err: any) {
    throw createProviderError({ provider: 'dalle', code: 'NETWORK', message: `Network error: ${err.message}`, retryable: true, failoverEligible: true });
  }

  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    let msg = `GPT Image edit error ${res.status}`;
    try { const p = JSON.parse(rawText); msg = p.error?.message || msg; } catch {}
    throw createProviderError({
      provider: 'dalle', code: res.status >= 500 ? `PROVIDER_${res.status}` : 'API_ERROR',
      message: msg, status: res.status,
      retryable: res.status >= 500, failoverEligible: true,
    });
  }

  // Safe JSON parse
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw createProviderError({ provider: 'dalle', code: 'MALFORMED_JSON', message: 'GPT Image returned non-JSON response', retryable: true, failoverEligible: true });
  }

  return saveImageResponse(data);
}

async function saveImageResponse(data: any): Promise<DalleImageResult> {
  const imgData = data?.data?.[0];
  if (!imgData) throw createProviderError({ provider: 'dalle', code: 'NO_IMAGE', message: 'Provider returned no image data', retryable: true, failoverEligible: true });

  if (imgData.b64_json) {
    const { writeFile, mkdir } = await import('fs/promises');
    const path = await import('path');
    const crypto = await import('crypto');
    const filename = `gptimg_${crypto.randomUUID()}.png`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), Buffer.from(imgData.b64_json, 'base64'));
    return { imageUrl: `/api/products/uploads?file=${filename}`, model: 'gpt-image-1', revisedPrompt: '' };
  }

  if (!imgData.url) throw createProviderError({ provider: 'dalle', code: 'NO_IMAGE', message: 'Provider returned no image URL', retryable: true, failoverEligible: true });

  return { imageUrl: imgData.url, model: 'gpt-image-1', revisedPrompt: '' };
}
