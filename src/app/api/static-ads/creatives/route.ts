import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/static-ads/creatives?storeId=...
// Returns generated static-ad creatives grouped into batches: ads for the
// same product + audience generated on the same day belong to one batch.
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  const rows: any[] = db.prepare(`
    SELECT c.id, c.title, c.file_url, c.created_at, c.template_data,
           c.product_id, c.audience_id,
           p.title AS product_title, a.name AS audience_name
    FROM creatives c
    LEFT JOIN products p ON p.id = c.product_id
    LEFT JOIN ad_audiences a ON a.id = c.audience_id
    WHERE c.store_id = ? AND c.file_url LIKE '/api/static-ads/images/%'
    ORDER BY c.created_at DESC
    LIMIT 500
  `).all(storeId);

  const batchMap = new Map<string, any>();
  for (const r of rows) {
    let templateName = '';
    try { templateName = JSON.parse(r.template_data || '{}').templateName || ''; } catch {}

    const day = String(r.created_at || '').slice(0, 10);
    const key = `${day}|${r.product_id || '?'}|${r.audience_id || '?'}`;

    if (!batchMap.has(key)) {
      batchMap.set(key, {
        key,
        date: day,
        productTitle: r.product_title || 'Unknown product',
        audienceName: r.audience_name || 'Unknown audience',
        creatives: [],
      });
    }
    batchMap.get(key).creatives.push({
      id: r.id,
      title: r.title,
      imageUrl: r.file_url,
      createdAt: r.created_at,
      templateName,
    });
  }

  // Map preserves insertion order; rows are newest-first so batches are too.
  const batches = Array.from(batchMap.values());
  const total = rows.length;

  return NextResponse.json({ batches, total });
}
