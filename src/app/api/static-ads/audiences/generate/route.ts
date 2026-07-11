import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { generateAudienceFromProduct } from '@/lib/claude-audience';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Fable 5 can take a couple of minutes

// POST /api/static-ads/audiences/generate  { storeId, productId }
// Reads the product and has Fable 5 build a full BOF audience profile:
// psychographics, usage moments, objections, and the claims they need to hear.
export async function POST(req: NextRequest) {
  const { storeId, productId } = await req.json();
  if (!storeId || !productId) {
    return NextResponse.json({ error: 'storeId and productId required' }, { status: 400 });
  }

  const db = getDb();
  const product: any = db.prepare('SELECT title, description, price_cents FROM products WHERE id = ?').get(productId);
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  try {
    const a = await generateAudienceFromProduct(product);

    const id = crypto.randomUUID();
    // usageMoments fold into creative_angles — the copy/image prompts read
    // angles, and a vivid moment is the strongest angle there is.
    const angles = [...a.usageMoments.map(m => `Moment: ${m}`), ...a.creativeAngles];

    db.prepare(`
      INSERT INTO ad_audiences (id, store_id, name, description, pain_points, desires, objections, mindset, failed_solutions, demographics, creative_angles, bof_reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, storeId, a.name, a.description,
      JSON.stringify(a.painPoints),
      JSON.stringify(a.desires),
      JSON.stringify(a.objections),
      a.mindset,
      JSON.stringify(a.failedSolutions),
      a.demographics,
      JSON.stringify(angles),
      a.bofReasoning
    );

    return NextResponse.json({ success: true, id, audience: a });
  } catch (err: any) {
    return NextResponse.json({ error: `Audience generation failed: ${err.message}` }, { status: 500 });
  }
}
