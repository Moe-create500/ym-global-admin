import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, productId, name, offer, winningAngles, sourceAdIds } = body;

  if (!storeId || !name) {
    return NextResponse.json({ error: 'storeId and name required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  // Auto-increment batch number
  const last: any = db.prepare(
    'SELECT MAX(batch_number) as max_num FROM creative_batches WHERE store_id = ?'
  ).get(storeId);
  const batchNumber = (last?.max_num || 0) + 1;

  // Pull product context if productId provided
  let productContext: string | null = null;
  if (productId) {
    const product: any = db.prepare('SELECT title, image_url, price_cents FROM products WHERE id = ?').get(productId);
    if (product) {
      productContext = JSON.stringify({
        title: product.title,
        imageUrl: product.image_url,
        priceCents: product.price_cents,
        offer: offer || null,
      });
    }
  }

  db.prepare(`
    INSERT INTO creative_batches (id, store_id, product_id, batch_number, name, status,
      product_context, offer, winning_angles, source_ad_ids)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    id, storeId, productId || null, batchNumber, name,
    productContext,
    offer || null,
    winningAngles ? JSON.stringify(winningAngles) : null,
    sourceAdIds ? JSON.stringify(sourceAdIds) : null
  );

  return NextResponse.json({
    success: true,
    batch: { id, batchNumber, name, status: 'pending' },
  });
}

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  const db = getDb();
  const batches = db.prepare(`
    SELECT cb.*,
      p.title as product_title, p.image_url as product_image
    FROM creative_batches cb
    LEFT JOIN products p ON p.id = cb.product_id
    WHERE cb.store_id = ?
    ORDER BY cb.created_at DESC
  `).all(storeId);

  return NextResponse.json({ batches });
}
