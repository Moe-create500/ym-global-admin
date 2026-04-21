import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAllClientProducts } from '@/lib/shipsourced';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { storeId } = await req.json();

  if (!storeId) {
    return NextResponse.json({ error: 'storeId is required' }, { status: 400 });
  }

  const db = getDb();
  const store: any = db.prepare(
    'SELECT * FROM stores WHERE id = ? AND is_active = 1'
  ).get(storeId);

  if (!store) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  }

  if (!store.shipsourced_client_id) {
    return NextResponse.json({ error: 'No ShipSourced client ID configured' }, { status: 400 });
  }

  try {
    const products = await getAllClientProducts(store.shipsourced_client_id);

    let created = 0;
    let updated = 0;

    for (const p of products) {
      // Parse images array — could be JSON string of URLs
      let allImages: string[] = [];
      if (p.images) {
        try {
          const imgs = JSON.parse(p.images);
          if (Array.isArray(imgs)) allImages = imgs.filter((u: string) => typeof u === 'string' && u.length > 0);
        } catch {}
      }
      if (p.imageUrl && !allImages.includes(p.imageUrl)) {
        allImages.unshift(p.imageUrl);
      }
      const primaryImage = allImages[0] || null;
      const imagesJson = allImages.length > 0 ? JSON.stringify(allImages) : null;

      // Parse variants to get the first SKU if product-level SKU is empty
      const sku = p.sku || null;
      const priceCents = Math.round((p.price || 0) * 100);
      // Convert weight from oz (ShipSourced) to grams (YM Global DB)
      const weightGrams = p.weightOz ? Math.round(p.weightOz * 28.3495) : 0;

      // Check if product already exists by shopify_product_id or by store_id + sku
      let existing: any = db.prepare(
        'SELECT id FROM products WHERE store_id = ? AND shopify_product_id = ?'
      ).get(store.id, p.externalProductId);

      if (!existing && sku) {
        existing = db.prepare(
          'SELECT id FROM products WHERE store_id = ? AND sku = ?'
        ).get(store.id, sku);
      }

      if (existing) {
        db.prepare(`
          UPDATE products SET
            title = ?, sku = ?, shopify_product_id = COALESCE(shopify_product_id, ?),
            image_url = ?, images = ?, price_cents = ?, weight_grams = ?,
            status = 'active', synced_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(p.name, sku, p.externalProductId, primaryImage, imagesJson, priceCents, weightGrams, existing.id);
        updated++;
      } else {
        db.prepare(`
          INSERT INTO products (id, store_id, shopify_product_id, title, sku, image_url, images, price_cents, weight_grams, status, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
        `).run(crypto.randomUUID(), store.id, p.externalProductId, p.name, sku, primaryImage, imagesJson, priceCents, weightGrams);
        created++;
      }
    }

    // Update product count on store
    const count: any = db.prepare('SELECT COUNT(*) as cnt FROM products WHERE store_id = ? AND status = ?').get(store.id, 'active');
    db.prepare('UPDATE stores SET product_count = ? WHERE id = ?').run(count.cnt, store.id);

    return NextResponse.json({ success: true, total: products.length, created, updated });
  } catch (err: any) {
    console.error('Product sync error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
