import { requireStoreAccess, getSession, getAccessibleStoreIds } from '@/lib/auth-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  // ═══ TENANT ACCESS CHECK ═══
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;

  const status = searchParams.get('status');

  const db = getDb();

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (storeId) {
    where += ' AND p.store_id = ?'; params.push(storeId);
  } else {
    // No storeId specified — filter to only accessible stores for non-admin users
    const session = getSession(req);
    if (session && session.role !== 'admin' && session.role !== 'data_corrector') {
      const accessibleIds = getAccessibleStoreIds(session.employeeId, session.role);
      if (accessibleIds.length > 0) {
        where += ` AND p.store_id IN (${accessibleIds.map(() => '?').join(',')})`;
        params.push(...accessibleIds);
      } else {
        return NextResponse.json({ products: [] });
      }
    }
  }
  if (status) { where += ' AND p.status = ?'; params.push(status); }

  // For non-admin users: on-brand filter — only return products whose title
  // contains the store name. This hides mass-imported junk products that
  // are assigned to every store but don't actually belong to the brand.
  const isAdmin = _auth.authorized && (_auth.role === 'admin' || _auth.role === 'data_corrector');
  if (!isAdmin && storeId) {
    const store: any = db.prepare('SELECT name FROM stores WHERE id = ?').get(storeId);
    if (store?.name) {
      const brandName = store.name.toLowerCase().replace(/[™®©]/g, '');
      where += ` AND LOWER(REPLACE(REPLACE(REPLACE(p.title, '™', ''), '®', ''), '©', '')) LIKE ?`;
      params.push(`%${brandName}%`);
    }
  }

  const products = db.prepare(`
    SELECT p.*, s.name as store_name,
      (SELECT COUNT(*) FROM creatives c WHERE c.product_id = p.id) as creative_count
    FROM products p
    JOIN stores s ON s.id = p.store_id
    ${where}
    ORDER BY p.title COLLATE NOCASE ASC
    LIMIT 2000
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

/**
 * PATCH /api/products — Add an image to an existing product.
 * Body: { productId, imageUrl } or multipart form with file upload.
 */
export async function PATCH(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';

  const db = getDb();

  // ═══ File upload (multipart/form-data) ═══
  if (contentType.includes('multipart/form-data')) {
    try {
      const formData = await req.formData();
      const productId = formData.get('productId') as string;
      const file = formData.get('file') as File | null;

      if (!productId || !file) {
        return NextResponse.json({ error: 'productId and file are required' }, { status: 400 });
      }

      // Save file to public/uploads
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const filename = `${crypto.randomUUID()}.${ext}`;
      const uploadDir = path.join(process.cwd(), 'public', 'uploads');
      await mkdir(uploadDir, { recursive: true });
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(uploadDir, filename), buf);

      const imageUrl = `/api/products/uploads?file=${filename}`;
      console.log(`[PRODUCTS] Uploaded ${filename} (${buf.length} bytes) for product ${productId}`);

      // Append to product's images array
      const product: any = db.prepare('SELECT images FROM products WHERE id = ?').get(productId);
      if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

      const existing: string[] = product.images ? JSON.parse(product.images) : [];
      existing.push(imageUrl);
      db.prepare('UPDATE products SET images = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(JSON.stringify(existing), productId);

      return NextResponse.json({ success: true, imageUrl, totalImages: existing.length });
    } catch (e: any) {
      return NextResponse.json({ error: `Upload failed: ${e.message}` }, { status: 500 });
    }
  }

  // ═══ URL-based add (JSON body) ═══
  try {
    const body = await req.json();
    const { productId, imageUrl } = body;

    if (!productId || !imageUrl) {
      return NextResponse.json({ error: 'productId and imageUrl are required' }, { status: 400 });
    }

    const product: any = db.prepare('SELECT images FROM products WHERE id = ?').get(productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const existing: string[] = product.images ? JSON.parse(product.images) : [];
    if (existing.includes(imageUrl)) {
      return NextResponse.json({ success: true, imageUrl, totalImages: existing.length, duplicate: true });
    }
    existing.push(imageUrl);
    db.prepare('UPDATE products SET images = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(JSON.stringify(existing), productId);

    console.log(`[PRODUCTS] Added image URL to product ${productId}: ${imageUrl.substring(0, 80)}`);
    return NextResponse.json({ success: true, imageUrl, totalImages: existing.length });
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to add image: ${e.message}` }, { status: 500 });
  }
}
