import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createSessionToken, verifySessionToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  // Verify caller is admin
  const cookie = req.cookies.get('ym_auth')?.value;
  if (!cookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = verifySessionToken(cookie);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { employeeId } = await req.json();
  if (!employeeId) return NextResponse.json({ error: 'employeeId required' }, { status: 400 });

  const db = getDb();
  const employee: any = db.prepare(
    'SELECT id, name, email, role, is_active FROM employees WHERE id = ?'
  ).get(employeeId);

  if (!employee || !employee.is_active) {
    return NextResponse.json({ error: 'Employee not found or inactive' }, { status: 404 });
  }

  const token = createSessionToken(employee.id, employee.role);
  const res = NextResponse.json({
    success: true,
    employee: { id: employee.id, name: employee.name, email: employee.email, role: employee.role },
  });
  res.cookies.set('ym_auth', token, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
