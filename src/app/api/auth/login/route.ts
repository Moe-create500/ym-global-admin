import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const storedHash = process.env.DASHBOARD_PASSWORD || '';

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
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return res;
}
