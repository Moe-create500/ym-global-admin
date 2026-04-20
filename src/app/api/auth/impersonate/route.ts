import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createSessionToken, verifySessionToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get('ym_auth')?.value;
  if (!cookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = verifySessionToken(cookie);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const employeeId = req.nextUrl.searchParams.get('id');
  if (!employeeId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const employee: any = db.prepare(
    'SELECT id, name, email, role, is_active FROM employees WHERE id = ?'
  ).get(employeeId);

  if (!employee || !employee.is_active) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }

  const token = createSessionToken(employee.id, employee.role);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Logging in as ${employee.name}...</title><meta http-equiv="refresh" content="0;url=/dashboard"></head><body></body></html>`;

  const res = new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
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
