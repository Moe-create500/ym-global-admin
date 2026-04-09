import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { verifyPassword, createSessionToken, getPassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!password) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  // Employee login: email + password
  if (email) {
    const db = getDb();
    const employee = db.prepare(
      'SELECT id, name, email, role, password_hash, is_active FROM employees WHERE email = ? COLLATE NOCASE'
    ).get(email) as any;

    if (!employee || !employee.is_active) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    if (!employee.password_hash) {
      return NextResponse.json({ error: 'No password set for this account. Contact admin.' }, { status: 401 });
    }

    if (!verifyPassword(password, employee.password_hash)) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Update last login
    db.prepare('UPDATE employees SET last_login_at = datetime(\'now\') WHERE id = ?').run(employee.id);

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

  // Fallback: old shared password login
  const storedHash = getPassword();
  const inputHash = crypto.createHash('sha256').update(password).digest('hex');
  if (inputHash !== storedHash) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set('ym_auth', inputHash, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
