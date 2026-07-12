// Amazon-style Shopify listing images for the New Product Launch workflow.
// 7 shots covering the standard high-converting listing set, generated from
// the user's reference photos with the chosen brand name on the packaging.

import type Database from 'better-sqlite3';
import { generateImage } from '@/lib/openai-image';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const LISTING_SHOTS = [
  'MAIN HERO SHOT: the product perfectly centered on a PURE WHITE background (Amazon main-image style), professional studio lighting, sharp focus, subtle natural shadow beneath. No text overlays, no badges — just the product looking premium.',
  'BENEFITS INFOGRAPHIC: the product on a clean light background with 4 short benefit callouts around it, each with a simple line icon and 2-4 words of text. Modern e-commerce infographic style, generous whitespace.',
  'LIFESTYLE IN USE: the product being used naturally by a person in a bright, aspirational real-life setting matching the product category. Warm authentic feel, product clearly visible.',
  'WHAT\'S INSIDE / KEY FEATURES: close-up macro shot highlighting the product\'s texture, ingredients or craftsmanship, with 2-3 small labeled callouts. Premium detail-shot style.',
  'SCALE SHOT: the product held in a hand or next to an everyday object so its true size is obvious. Clean neutral background.',
  'TRUST PANEL: the product with a row of 3-4 clean trust badges beneath it (e.g. quality guarantee, fast shipping, satisfaction promise) in a cohesive brand-colored layout.',
  'OFFER SHOT: the product shown as an attractive multi-unit bundle arrangement on a soft gradient background, suggesting value. Premium e-commerce style.',
];

export const LISTING_SHOT_COUNT = LISTING_SHOTS.length;

/** Generate listing image #idx (0-based). Saves the PNG under
 *  static-ads/{storeId}/listing/ and returns id + disk path. */
export async function generateListingImage(db: Database.Database, opts: {
  storeId: string;
  brandName: string;
  productName: string;
  brief: string;
  referenceImageUrls: string[];
  idx: number;
}): Promise<{ id: string; filePath: string; label: string }> {
  const shot = LISTING_SHOTS[opts.idx % LISTING_SHOTS.length];
  const prompt = `Professional e-commerce product listing photo.

PRODUCT: ${opts.productName}
BRAND: "${opts.brandName}" — the packaging/label must clearly read "${opts.brandName}".
ABOUT THE PRODUCT: ${opts.brief.slice(0, 600)}

SHOT TYPE — ${shot}

Requirements: photorealistic, square 1:1, retail-listing quality, consistent branding across the set, text (if any) must be spelled correctly.`;

  const result = await generateImage(prompt, {
    size: '1024x1024',
    quality: 'high',
    referenceImageUrls: opts.referenceImageUrls.slice(0, 3),
  });
  if (!result.imagesBase64.length) throw new Error('No image generated');

  const id = crypto.randomUUID();
  const dir = path.join(process.cwd(), 'static-ads', opts.storeId, 'listing');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.png`);
  fs.writeFileSync(filePath, Buffer.from(result.imagesBase64[0], 'base64'));

  return { id, filePath, label: shot.split(':')[0] };
}
