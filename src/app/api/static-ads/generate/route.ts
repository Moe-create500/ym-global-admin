import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { generateImage } from '@/lib/openai-image';
import { buildImagePrompt } from '@/lib/static-ad-prompts';
import type { AudienceProfile, ImageTemplate, ProductContext } from '@/lib/static-ad-prompts';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const SIZE_MAP: Record<string, '1024x1024' | '1024x1536' | '1536x1024'> = {
  '1:1': '1024x1024',
  '4:5': '1024x1536',
  '9:16': '1024x1536',
  '16:9': '1536x1024',
};

export async function POST(req: NextRequest) {
  const { storeId, productId, audienceId, templateId, customInstructions, selectedImageUrl } = await req.json();

  if (!storeId || !productId || !audienceId || !templateId) {
    return NextResponse.json({ error: 'storeId, productId, audienceId, templateId required' }, { status: 400 });
  }

  const db = getDb();

  // Load product
  const productRow: any = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!productRow) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

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

  // Load audience
  const audRow: any = db.prepare('SELECT * FROM ad_audiences WHERE id = ?').get(audienceId);
  if (!audRow) return NextResponse.json({ error: 'Audience not found' }, { status: 404 });

  const audience: AudienceProfile = {
    ...audRow,
    pain_points: JSON.parse(audRow.pain_points || '[]'),
    desires: JSON.parse(audRow.desires || '[]'),
    objections: JSON.parse(audRow.objections || '[]'),
    failed_solutions: JSON.parse(audRow.failed_solutions || '[]'),
  };

  // Load template
  const tplRow: any = db.prepare('SELECT * FROM creative_templates WHERE id = ?').get(templateId);
  if (!tplRow) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

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

  // Build image prompt — AI generates copy inline
  let prompt = buildImagePrompt({ product, audience, template, copy: {} });
  if (customInstructions) {
    prompt += `\n\nADDITIONAL INSTRUCTIONS: ${customInstructions}`;
  }

  const size = SIZE_MAP[template.aspect_ratio] || '1024x1024';

  try {
    // Reference images: template layout FIRST, product photo SECOND
    const referenceImageUrls: string[] = [];

    // 1. Template preview image — the layout to follow
    const templatePreviewFile = tplData.preview_file;
    if (templatePreviewFile) {
      const templatePreviewPath = path.join(process.cwd(), 'static-ads', 'templates', templatePreviewFile);
      if (fs.existsSync(templatePreviewPath)) {
        referenceImageUrls.push(`/api/static-ads/templates/preview/${templatePreviewFile}`);
      }
    }

    // 2. Product photo (use selected image if provided, otherwise default)
    const productPhoto = selectedImageUrl || product.image_url;
    if (productPhoto) referenceImageUrls.push(productPhoto);

    const result = await generateImage(prompt, { size, quality: 'high', referenceImageUrls });

    if (!result.imagesBase64.length) {
      return NextResponse.json({ error: 'No image generated' }, { status: 500 });
    }

    const creativeId = crypto.randomUUID();
    const imgBuffer = Buffer.from(result.imagesBase64[0], 'base64');

    // Save to filesystem
    const dir = path.join(process.cwd(), 'static-ads', storeId);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${creativeId}.png`);
    fs.writeFileSync(filePath, imgBuffer);

    const headline = `${template.name} — ${audience.name}`;

    // Insert into creatives table
    db.prepare(`
      INSERT INTO creatives (id, store_id, product_id, type, title, description, file_url, template_id, template_data, audience_id, status, created_at)
      VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, 'completed', datetime('now'))
    `).run(
      creativeId, storeId, productId,
      headline.slice(0, 100),
      prompt.slice(0, 500),
      `/api/static-ads/images/${creativeId}`,
      templateId,
      JSON.stringify({ size, audienceId, templateName: template.name }),
      audienceId
    );

    return NextResponse.json({
      success: true,
      creative: {
        id: creativeId,
        imageUrl: `/api/static-ads/images/${creativeId}`,
        copy: 'AI-generated',
        template: template.name,
        audience: audience.name,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Image generation failed: ${err.message}` }, { status: 500 });
  }
}
