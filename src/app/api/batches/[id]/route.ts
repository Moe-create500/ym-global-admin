import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const batch: any = db.prepare(`
    SELECT cb.*, p.title as product_title, p.image_url as product_image
    FROM creative_batches cb
    LEFT JOIN products p ON p.id = cb.product_id
    WHERE cb.id = ?
  `).get(id);

  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  const creatives = db.prepare(`
    SELECT * FROM creatives WHERE batch_id = ? ORDER BY type, batch_index
  `).all(id);

  return NextResponse.json({ batch, creatives });
}
