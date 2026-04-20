import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createSessionToken, verifySessionToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  // Verify caller is admin
  const cookie = req.cookies.get('ym_auth')?.value;
  if (!cookie) return NextResponse.redirect(new URL('/login', req.url));

  const session = verifySessionToken(cookie);
  if (!session || session.role !== 'admin') {
    return NextResponse.redirect(new URL('/dashboard/team', req.url));
  }

  const employeeId = req.nextUrl.searchParams.get('id');
  if (!employeeId) return NextResponse.redirect(new URL('/dashboard/team', req.url));

  const db = getDb();
  const employee: any = db.prepare(
    'SELECT id, name, email, role, is_active FROM employees WHERE id = ?'
  ).get(employeeId);

  if (!employee || !employee.is_active) {
    return NextResponse.redirect(new URL('/dashboard/team', req.url));
  }

  const token = createSessionToken(employee.id, employee.role);
  const res = NextResponse.redirect(new URL('/dashboard', req.url));
  res.cookies.set('ym_auth', token, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
