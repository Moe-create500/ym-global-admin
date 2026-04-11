import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifySessionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get('ym_auth')?.value;
  if (!cookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = verifySessionToken(cookie);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  const employee: any = db.prepare(
    'SELECT id, name, email, role FROM employees WHERE id = ? AND is_active = 1'
  ).get(session.employeeId);
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  // Assigned stores
  const stores = db.prepare(`
    SELECT s.id, s.name
    FROM employee_store_access esa
    JOIN stores s ON s.id = esa.store_id
    WHERE esa.employee_id = ? AND s.is_active = 1
    ORDER BY s.name
  `).all(session.employeeId);

  // Recent uploads
  const recentUploads = db.prepare(`
    SELECT eu.*, s.name as store_name
    FROM employee_uploads eu
    JOIN stores s ON s.id = eu.store_id
    WHERE eu.employee_id = ?
    ORDER BY eu.created_at DESC
    LIMIT 50
  `).all(session.employeeId);

  return NextResponse.json({ employee, stores, recentUploads });
}
