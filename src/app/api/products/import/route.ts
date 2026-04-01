import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, csvText } = body;

  if (!storeId || !csvText) {
    return NextResponse.json({ error: 'storeId and csvText required' }, { status: 400 });
  }

  const db = getDb();
  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
  }

  // Group by Handle — Shopify uses multiple rows per product for variants/images
  const productMap: Record<string, {
    handle: string;
    title: string;
    sku: string;
    variantTitle: string;
    priceCents: number;
    weightGrams: number;
    imageUrl: string;
    category: string;
    status: string;
    images: string[];
  }> = {};

  // Valid Shopify handle: lowercase alphanumeric, hyphens, underscores, no HTML
  function isValidHandle(h: string): boolean {
    if (!h || h.length > 200) return false;
    if (h.includes('<') || h.includes('>') || h.includes('data-')) return false;
    return /^[a-zA-Z0-9™\-_.:]+$/.test(h);
  }

  for (const row of rows) {
    const handle = row['Handle'] || '';
    if (!handle || !isValidHandle(handle)) continue;

    if (!productMap[handle]) {
      const price = parseFloat(row['Variant Price'] || '0');
      const weight = parseFloat(row['Variant Grams'] || '0');
      productMap[handle] = {
        handle,
        title: row['Title'] || handle,
        sku: row['Variant SKU'] || '',
        variantTitle: row['Option1 Value'] || '',
        priceCents: Math.round(price * 100),
        weightGrams: Math.round(weight),
        imageUrl: row['Image Src'] || '',
        category: row['Type'] || '',
        status: (row['Status'] || 'active').toLowerCase(),
        images: [],
      };
    }

    // Collect additional images
    const imgSrc = row['Image Src'] || '';
    if (imgSrc && !productMap[handle].images.includes(imgSrc)) {
      productMap[handle].images.push(imgSrc);
    }

    // Use first image as primary if not set
    if (!productMap[handle].imageUrl && imgSrc) {
      productMap[handle].imageUrl = imgSrc;
    }

    // Use first non-empty SKU
    if (!productMap[handle].sku && row['Variant SKU']) {
      productMap[handle].sku = row['Variant SKU'];
    }

    // Use first non-empty title
    if (productMap[handle].title === handle && row['Title']) {
      productMap[handle].title = row['Title'];
    }
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  const insertStmt = db.prepare(`
    INSERT INTO products (id, store_id, shopify_product_id, title, sku, variant_title,
      image_url, images, price_cents, weight_grams, category, status, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const updateStmt = db.prepare(`
    UPDATE products SET title = ?, sku = COALESCE(?, sku), variant_title = COALESCE(?, variant_title),
      image_url = COALESCE(?, image_url), images = COALESCE(?, images), price_cents = ?, weight_grams = ?,
      category = COALESCE(?, category), status = ?, synced_at = datetime('now'),
      updated_at = datetime('now')
    WHERE shopify_product_id = ? AND store_id = ?
  `);

  for (const [handle, product] of Object.entries(productMap)) {
    if (!product.title) { skipped++; continue; }

    const imagesJson = product.images.length > 0 ? JSON.stringify(product.images) : null;

    // Check if exists by handle (shopify_product_id)
    const existing: any = db.prepare(
      'SELECT id FROM products WHERE shopify_product_id = ? AND store_id = ?'
    ).get(handle, storeId);

    if (existing) {
      updateStmt.run(
        product.title, product.sku || null, product.variantTitle || null,
        product.imageUrl || null, imagesJson, product.priceCents, product.weightGrams,
        product.category || null, product.status === 'active' ? 'active' : 'archived',
        handle, storeId
      );
      updated++;
    } else {
      insertStmt.run(
        crypto.randomUUID(), storeId, handle,
        product.title, product.sku || null, product.variantTitle || null,
        product.imageUrl || null, imagesJson, product.priceCents, product.weightGrams,
        product.category || null, product.status === 'active' ? 'active' : 'draft'
      );
      imported++;
    }
  }

  // Update product count on store
  const count: any = db.prepare(
    'SELECT COUNT(*) as cnt FROM products WHERE store_id = ? AND status = ?'
  ).get(storeId, 'active');
  db.prepare('UPDATE stores SET product_count = ? WHERE id = ?').run(count?.cnt || 0, storeId);

  return NextResponse.json({
    success: true,
    imported,
    updated,
    skipped,
    total: Object.keys(productMap).length,
  });
}
