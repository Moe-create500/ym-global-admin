import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { chatCompletion } from '@/lib/openai-chat';
import { buildCopyPrompt, DEFAULT_TEXT_RULES } from '@/lib/static-ad-prompts';
import type { AudienceProfile, ImageTemplate, ProductContext } from '@/lib/static-ad-prompts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { storeId, productId, audienceId, templateId, textRules, count } = await req.json();

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

  // Build prompt and call GPT-4.5
  const rules = textRules || [...DEFAULT_TEXT_RULES];
  const messages = buildCopyPrompt({
    product,
    audience,
    template,
    textRules: rules,
    variationCount: count || 3,
  });

  try {
    const result = await chatCompletion(messages, { model: 'gpt-5.5', temperature: 1 });
    const parsed = JSON.parse(result.content);

    return NextResponse.json({
      success: true,
      variations: parsed.variations || [],
      usage: result.usage,
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Copy generation failed: ${err.message}` }, { status: 500 });
  }
}
