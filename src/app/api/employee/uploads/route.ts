import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100');
  const db = getDb();

  const uploads = db.prepare(`
    SELECT eu.*, e.name as employee_name, s.name as store_name
    FROM employee_uploads eu
    JOIN employees e ON e.id = eu.employee_id
    JOIN stores s ON s.id = eu.store_id
    ORDER BY eu.created_at DESC
    LIMIT ?
  `).all(Math.min(limit, 500));

  return NextResponse.json({ uploads });
}
