import { requireStoreAccess, getSession, getAccessibleStoreIds } from '@/lib/auth-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  // ═══ TENANT ACCESS CHECK ═══
  const auth = requireStoreAccess(req, storeId);
  if (!auth.authorized) return auth.response;

  const type = searchParams.get('type');
  const status = searchParams.get('status');

  const db = getDb();

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (storeId) {
    where += ' AND c.store_id = ?'; params.push(storeId);
  } else {
    const session = getSession(req);
    if (session && session.role !== 'admin' && session.role !== 'data_corrector') {
      const accessibleIds = getAccessibleStoreIds(session.employeeId, session.role);
      if (accessibleIds.length > 0) {
        where += ` AND c.store_id IN (${accessibleIds.map(() => '?').join(',')})`;
        params.push(...accessibleIds);
      } else {
        return NextResponse.json({ creatives: [] });
      }
    }
  }
  if (type) { where += ' AND c.type = ?'; params.push(type); }
  if (status) { where += ' AND c.status = ?'; params.push(status); }

  const creatives = db.prepare(`
    SELECT c.*, s.name as store_name, p.title as product_title,
      e.name as creator_name
    FROM creatives c
    JOIN stores s ON s.id = c.store_id
    LEFT JOIN products p ON p.id = c.product_id
    LEFT JOIN employees e ON e.id = c.created_by
    ${where}
    ORDER BY c.created_at DESC
    LIMIT 200
  `).all(...params);

  return NextResponse.json({ creatives });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, productId, type, title, description, fileUrl, thumbnailUrl,
          durationSeconds, width, height, format, templateId, templateData, createdBy } = body;

  if (!storeId || !title) {
    return NextResponse.json({ error: 'storeId and title are required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO creatives (id, store_id, product_id, type, title, description, file_url,
      thumbnail_url, duration_seconds, width, height, format, template_id, template_data, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, storeId, productId || null, type || 'video', title,
    description || null, fileUrl || null, thumbnailUrl || null,
    durationSeconds || null, width || null, height || null,
    format || null, templateId || null, templateData ? JSON.stringify(templateData) : null,
    createdBy || null);

  return NextResponse.json({ success: true, id });
}
