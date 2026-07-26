// Core of the Picture Ads image generation — extracted from
// /api/static-ads/generate so the launch workflow can generate ads too.

import type Database from 'better-sqlite3';
import { generateImage } from '@/lib/openai-image';
import { buildImagePrompt } from '@/lib/static-ad-prompts';
import type { AudienceProfile, ImageTemplate, ProductContext } from '@/lib/static-ad-prompts';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const SIZE_MAP: Record<string, '1024x1024' | '1024x1536' | '1536x1024'> = {
  '1:1': '1024x1024',
  '4:5': '1024x1536',
  '9:16': '1024x1536',
  '16:9': '1536x1024',
};

export function loadAudience(db: Database.Database, audienceId: string): AudienceProfile | null {
  const audRow: any = db.prepare('SELECT * FROM ad_audiences WHERE id = ?').get(audienceId);
  if (!audRow) return null;
  return {
    ...audRow,
    pain_points: JSON.parse(audRow.pain_points || '[]'),
    desires: JSON.parse(audRow.desires || '[]'),
    objections: JSON.parse(audRow.objections || '[]'),
    failed_solutions: JSON.parse(audRow.failed_solutions || '[]'),
  };
}

/** Generate one static ad image and register it in the creatives table.
 *  Returns the creative id + serving URL. Throws with a clear message on failure. */
export async function generateStaticAd(db: Database.Database, opts: {
  storeId: string;
  productId: string;
  audienceId: string;
  templateId: string;
  customInstructions?: string;
  languageInstruction?: string;
  selectedImageUrl?: string;
}): Promise<{ id: string; imageUrl: string; template: string; audience: string }> {
  const productRow: any = db.prepare('SELECT * FROM products WHERE id = ?').get(opts.productId);
  if (!productRow) throw new Error('Product not found');

  let images: string[] = [];
  try { images = JSON.parse(productRow.images || '[]'); } catch {}

  const product: ProductContext = {
    id: productRow.id,
    title: productRow.title,
    description: productRow.description,
    price_cents: productRow.price_cents,
    image_url: productRow.image_url,
    images,
  };

  const audience = loadAudience(db, opts.audienceId);
  if (!audience) throw new Error('Audience not found');

  const tplRow: any = db.prepare('SELECT * FROM creative_templates WHERE id = ?').get(opts.templateId);
  if (!tplRow) throw new Error('Template not found');

  let tplData: any = {};
  try { tplData = JSON.parse(tplRow.template_data || '{}'); } catch {}

  const template: ImageTemplate = {
    id: tplRow.id,
    name: tplRow.name,
    description: tplRow.description,
    aspect_ratio: tplData.aspect_ratio || '1:1',
    style: tplData.style || '',
    zones: tplData.zones || [],
    reference_description: tplData.reference_description || '',
  };

  let prompt = buildImagePrompt({ product, audience, template, copy: {}, languageInstruction: opts.languageInstruction });
  if (opts.customInstructions) {
    prompt += `\n\nADDITIONAL INSTRUCTIONS: ${opts.customInstructions}`;
  }

  const size = SIZE_MAP[template.aspect_ratio] || '1024x1024';

  // Reference images: template layout FIRST, product photo SECOND
  const referenceImageUrls: string[] = [];
  const templatePreviewFile = tplData.preview_file;
  if (templatePreviewFile) {
    const templatePreviewPath = path.join(process.cwd(), 'static-ads', 'templates', templatePreviewFile);
    if (fs.existsSync(templatePreviewPath)) {
      referenceImageUrls.push(`/api/static-ads/templates/preview/${templatePreviewFile}`);
    }
  }
  const productPhoto = opts.selectedImageUrl || product.image_url;
  if (productPhoto) referenceImageUrls.push(productPhoto);

  const result = await generateImage(prompt, { size, quality: 'high', referenceImageUrls });
  if (!result.imagesBase64.length) throw new Error('No image generated');

  const creativeId = crypto.randomUUID();
  const imgBuffer = Buffer.from(result.imagesBase64[0], 'base64');

  const dir = path.join(process.cwd(), 'static-ads', opts.storeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${creativeId}.png`), imgBuffer);

  const headline = `${template.name} — ${audience.name}`;

  db.prepare(`
    INSERT INTO creatives (id, store_id, product_id, type, title, description, file_url, template_id, template_data, audience_id, status, created_at)
    VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, 'completed', datetime('now'))
  `).run(
    creativeId, opts.storeId, opts.productId,
    headline.slice(0, 100),
    prompt.slice(0, 500),
    `/api/static-ads/images/${creativeId}`,
    opts.templateId,
    JSON.stringify({ size, audienceId: opts.audienceId, templateName: template.name }),
    opts.audienceId
  );

  return { id: creativeId, imageUrl: `/api/static-ads/images/${creativeId}`, template: template.name, audience: audience.name };
}

/** Pick N template ids for a workflow run: proven templates first (most used
 *  in past generated ads for this store), then fill with any active ones. */
export function pickTemplates(db: Database.Database, storeId: string, count: number): string[] {
  const proven: any[] = db.prepare(`
    SELECT c.template_id AS id, COUNT(*) AS uses
    FROM creatives c
    WHERE c.store_id = ? AND c.template_id IS NOT NULL AND c.file_url LIKE '/api/static-ads/images/%'
    GROUP BY c.template_id ORDER BY uses DESC LIMIT ?
  `).all(storeId, count);

  const picked: string[] = [];
  const seen = new Set<string>();
  for (const t of proven) {
    // template must still exist and be active
    const ok: any = db.prepare("SELECT 1 FROM creative_templates WHERE id = ? AND type='image' AND is_active = 1").get(t.id);
    if (ok && !seen.has(t.id)) { picked.push(t.id); seen.add(t.id); }
  }
  if (picked.length < count) {
    const rest: any[] = db.prepare(
      "SELECT id FROM creative_templates WHERE type='image' AND is_active = 1 ORDER BY name LIMIT 200"
    ).all();
    for (const t of rest) {
      if (picked.length >= count) break;
      if (!seen.has(t.id)) { picked.push(t.id); seen.add(t.id); }
    }
  }
  return picked.slice(0, count);
}
