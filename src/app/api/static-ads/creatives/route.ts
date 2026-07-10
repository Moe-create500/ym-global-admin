import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/static-ads/creatives?storeId=...  → generated static-ad creatives, newest first
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  const rows: any[] = db.prepare(`
    SELECT c.id, c.title, c.file_url, c.created_at, c.template_data,
           p.title AS product_title, a.name AS audience_name
    FROM creatives c
    LEFT JOIN products p ON p.id = c.product_id
    LEFT JOIN ad_audiences a ON a.id = c.audience_id
    WHERE c.store_id = ? AND c.file_url LIKE '/api/static-ads/images/%'
    ORDER BY c.created_at DESC
    LIMIT 200
  `).all(storeId);

  const creatives = rows.map((r) => {
    let templateName = '';
    try { templateName = JSON.parse(r.template_data || '{}').templateName || ''; } catch {}
    return {
      id: r.id,
      title: r.title,
      imageUrl: r.file_url,
      createdAt: r.created_at,
      productTitle: r.product_title,
      audienceName: r.audience_name,
      templateName,
    };
  });

  return NextResponse.json({ creatives });
}
