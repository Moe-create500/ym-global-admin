import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const AUTH_COOKIE = 'ym_auth';

function verifyToken(token: string): boolean {
  const secret = process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD || 'ym-global-secret';
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [employeeId, role, timestamp, signature] = parts;
  const payload = `${employeeId}.${role}.${timestamp}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (signature !== expected) return false;
  const age = Date.now() - parseInt(timestamp, 10);
  return age <= 30 * 24 * 60 * 60 * 1000;
}

function isValidAuth(token: string): boolean {
  // New session token
  if (verifyToken(token)) return true;
  // Legacy shared password
  const storedHash = process.env.DASHBOARD_PASSWORD || '';
  return token === storedHash;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname === '/logo.png' ||
    pathname === '/api/banking/webhook' ||
    pathname.startsWith('/api/cron')
  ) {
    return NextResponse.next();
  }

  // API routes: check cookie
  if (pathname.startsWith('/api/')) {
    const cookie = req.cookies.get(AUTH_COOKIE)?.value;
    if (cookie && isValidAuth(cookie)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Page routes: check cookie
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!cookie || !isValidAuth(cookie)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
