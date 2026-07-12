import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { generateStaticAd } from '@/lib/static-ad-generate';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { storeId, productId, audienceId, templateId, customInstructions, selectedImageUrl } = await req.json();

  if (!storeId || !productId || !audienceId || !templateId) {
    return NextResponse.json({ error: 'storeId, productId, audienceId, templateId required' }, { status: 400 });
  }

  const db = getDb();

  try {
    const creative = await generateStaticAd(db, { storeId, productId, audienceId, templateId, customInstructions, selectedImageUrl });
    return NextResponse.json({
      success: true,
      creative: {
        id: creative.id,
        imageUrl: creative.imageUrl,
        copy: 'AI-generated',
        template: creative.template,
        audience: creative.audience,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Image generation failed: ${err.message}` }, { status: 500 });
  }
}
