/**
 * Google Gemini Image Generation
 * Uses safe response parsing — never crashes on non-JSON responses.
 */

import { safeProviderFetch, createProviderError } from './provider-fetch';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const API_KEY = () => process.env.GEMINI_API_KEY || '';

export interface GeminiImageResult {
  imageUrl: string;
  model: string;
}

export async function generateImage(
  prompt: string,
  options: { model?: string; referenceImageUrl?: string } = {}
): Promise<GeminiImageResult> {
  const key = API_KEY();
  if (!key) throw createProviderError({ provider: 'gemini-image', code: 'MISSING_KEY', message: 'GEMINI_API_KEY not set', retryable: false, failoverEligible: true });

  const model = options.model || 'gemini-2.5-flash-image';
  const parts: any[] = [];

  // Optional reference image
  if (options.referenceImageUrl) {
    try {
      const imgRes = await fetch(options.referenceImageUrl);
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const sharp = (await import('sharp')).default;
        const pngBuf = await sharp(buf).resize(768, 768, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer();
        parts.push({ inlineData: { mimeType: 'image/png', data: pngBuf.toString('base64') } });
      }
    } catch (err) {
      console.error('[GEMINI-IMAGE] Failed to download reference image:', err);
    }
  }

  parts.push({ text: prompt.substring(0, 4000) });

  const result = await safeProviderFetch(
    `${BASE_URL}/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    },
    'gemini-image'
  );

  if (!result.ok) throw result.error;

  const responseParts = result.data?.candidates?.[0]?.content?.parts || [];
  const imagePart = responseParts.find((p: any) => p.inlineData);
  if (!imagePart) {
    throw createProviderError({ provider: 'gemini-image', code: 'NO_IMAGE', message: 'Gemini did not return an image. Try a different prompt.', retryable: true, failoverEligible: true });
  }

  const imgData = imagePart.inlineData;
  const ext = imgData.mimeType?.includes('png') ? 'png' : 'jpg';
  const filename = `gemini_${crypto.randomUUID()}.${ext}`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), Buffer.from(imgData.data, 'base64'));

  return { imageUrl: `/api/products/uploads?file=${filename}`, model };
}
