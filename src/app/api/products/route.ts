import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  const status = searchParams.get('status');

  const db = getDb();

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (storeId) { where += ' AND p.store_id = ?'; params.push(storeId); }
  if (status) { where += ' AND p.status = ?'; params.push(status); }

  const products = db.prepare(`
    SELECT p.*, s.name as store_name,
      (SELECT COUNT(*) FROM creatives c WHERE c.product_id = p.id) as creative_count
    FROM products p
    JOIN stores s ON s.id = p.store_id
    ${where}
    ORDER BY p.updated_at DESC
    LIMIT 500
  `).all(...params);

  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, title, sku, variantTitle, imageUrl, priceCents, costCents,
          usCostCents, chinaCostCents, weightGrams, category, description } = body;

  if (!storeId || !title) {
    return NextResponse.json({ error: 'storeId and title are required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  // Build images JSON — include imageUrl as first entry if not already in the list
  const imagesList: string[] = body.images || [];
  if (imageUrl && !imagesList.includes(imageUrl)) imagesList.unshift(imageUrl);
  const imagesJson = imagesList.length > 0 ? JSON.stringify(imagesList) : null;

  db.prepare(`
    INSERT INTO products (id, store_id, title, sku, variant_title, image_url, images,
      price_cents, cost_cents, us_cost_cents, china_cost_cents, weight_grams, category, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, storeId, title, sku || null, variantTitle || null, imageUrl || null, imagesJson,
    priceCents || 0, costCents || 0, usCostCents || 0, chinaCostCents || 0,
    weightGrams || 0, category || null, description || null);

  return NextResponse.json({ success: true, id });
}
