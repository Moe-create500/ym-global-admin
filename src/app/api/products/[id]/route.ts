import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const product = db.prepare(`
    SELECT p.*, s.name as store_name
    FROM products p
    JOIN stores s ON s.id = p.store_id
    WHERE p.id = ?
  `).get(params.id);
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const creatives = db.prepare(
    'SELECT * FROM creatives WHERE product_id = ? ORDER BY created_at DESC'
  ).all(params.id);

  return NextResponse.json({ product, creatives });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const db = getDb();

  const fields: string[] = [];
  const values: any[] = [];

  const allowed = ['title', 'sku', 'variant_title', 'image_url', 'images', 'price_cents', 'cost_cents',
    'us_cost_cents', 'china_cost_cents', 'weight_grams', 'category', 'status',
    'fb_catalog_id', 'fb_product_set_id', 'description'];
  const mapping: Record<string, string> = {
    variantTitle: 'variant_title', imageUrl: 'image_url', priceCents: 'price_cents',
    costCents: 'cost_cents', usCostCents: 'us_cost_cents', chinaCostCents: 'china_cost_cents',
    weightGrams: 'weight_grams', fbCatalogId: 'fb_catalog_id', fbProductSetId: 'fb_product_set_id',
  };

  for (const [key, val] of Object.entries(body)) {
    const col = mapping[key] || key;
    if (allowed.includes(col)) {
      fields.push(`"${col}" = ?`);
      values.push(val);
    }
  }

  if (fields.length > 0) {
    fields.push('"updated_at" = datetime(\'now\')');
    values.push(params.id);
    db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare('UPDATE products SET status = \'archived\', updated_at = datetime(\'now\') WHERE id = ?').run(params.id);
  return NextResponse.json({ success: true });
}
