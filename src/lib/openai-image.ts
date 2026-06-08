/**
 * OpenAI Image Generation API wrapper (gpt-image-2)
 * Supports text-only generation and multi-image reference editing.
 */

import path from 'path';
import fs from 'fs';

const BASE_URL = 'https://api.openai.com/v1';
const API_KEY = () => process.env.OPENAI_API_KEY || '';

/**
 * Resolve an image URL to a Buffer.
 * - Local paths (/api/products/uploads, /api/static-ads/templates/preview) → read from disk
 * - Remote URLs (https://...) → fetch over network
 */
async function resolveImageToBuffer(url: string): Promise<Buffer> {
  // /api/products/uploads?file=filename.png → public/uploads/filename.png
  if (url.startsWith('/api/products/uploads')) {
    const fileParam = new URL(url, 'http://localhost').searchParams.get('file');
    if (!fileParam) throw new Error(`No file param in uploads URL: ${url}`);
    const filePath = path.join(process.cwd(), 'public', 'uploads', fileParam);
    if (!fs.existsSync(filePath)) throw new Error(`Upload file not found: ${fileParam}`);
    return fs.readFileSync(filePath);
  }

  // /api/static-ads/templates/preview/filename.png → static-ads/templates/filename.png
  if (url.startsWith('/api/static-ads/templates/preview/')) {
    const filename = url.split('/').pop() || '';
    const filePath = path.join(process.cwd(), 'static-ads', 'templates', filename);
    if (!fs.existsSync(filePath)) throw new Error(`Template preview not found: ${filename}`);
    return fs.readFileSync(filePath);
  }

  // /api/static-ads/images/id → static-ads/{storeId}/{id}.png (need DB lookup, skip for now)
  // Any other local path → try localhost fetch as fallback
  if (url.startsWith('/')) {
    const res = await fetch(`http://localhost:3001${url}`);
    if (!res.ok) throw new Error(`Failed to fetch local: ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Remote URL → fetch directly
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface ImageGenOptions {
  model?: 'gpt-image-2' | 'gpt-image-1' | 'dall-e-3';
  size?: '1024x1024' | '1024x1536' | '1536x1024';
  quality?: 'low' | 'medium' | 'high';
  n?: number;
  referenceImageUrls?: string[];  // template + product photos
}

export interface ImageGenResult {
  imagesBase64: string[];
  model: string;
}

export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  const key = API_KEY();
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const model = options.model || 'gpt-image-2';
  const hasRefImages = options.referenceImageUrls && options.referenceImageUrls.length > 0;
  const isGptImage = model.startsWith('gpt-image');

  if (hasRefImages && isGptImage) {
    return generateWithReference(prompt, options);
  }

  const body: Record<string, any> = {
    model,
    prompt,
    n: options.n || 1,
    size: options.size || '1024x1024',
  };

  if (isGptImage) {
    body.quality = options.quality || 'high';
  } else {
    body.quality = options.quality === 'high' ? 'hd' : 'standard';
    body.response_format = 'b64_json';
  }

  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI Image API error ${res.status}: ${text}`);
  }

  return parseImageResponse(await res.json(), model);
}

/**
 * Generate an image using reference images (template layout + product photo).
 * Downloads all reference images and sends via multipart /images/edits.
 */
async function generateWithReference(
  prompt: string,
  options: ImageGenOptions
): Promise<ImageGenResult> {
  const key = API_KEY();
  const model = options.model || 'gpt-image-2';

  // Resolve all reference images to buffers (local disk or remote fetch)
  const urls = options.referenceImageUrls || [];
  const downloadResults = await Promise.allSettled(
    urls.map(url => resolveImageToBuffer(url))
  );

  const imageBuffers: Buffer[] = [];
  for (const result of downloadResults) {
    if (result.status === 'fulfilled') imageBuffers.push(result.value);
  }

  if (imageBuffers.length === 0) {
    return generateImage(prompt, { ...options, referenceImageUrls: undefined });
  }

  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('n', String(options.n || 1));
  formData.append('size', options.size || '1024x1024');
  formData.append('quality', options.quality || 'high');

  for (let i = 0; i < imageBuffers.length; i++) {
    const blob = new Blob([new Uint8Array(imageBuffers[i])], { type: 'image/png' });
    formData.append('image[]', blob, `ref_${i}.png`);
  }

  const res = await fetch(`${BASE_URL}/images/edits`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI Image Edit API error ${res.status}: ${text}`);
  }

  return parseImageResponse(await res.json(), model);
}

function parseImageResponse(data: any, model: string): ImageGenResult {
  const images: string[] = [];
  for (const item of data.data || []) {
    if (item.b64_json) {
      images.push(item.b64_json);
    } else if (item.url) {
      images.push(item.url);
    }
  }
  return { imagesBase64: images, model };
}
