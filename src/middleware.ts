import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE = 'ym_auth';

// HMAC-SHA256 using Web Crypto API (Edge Runtime compatible)
async function hmacSha256(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyToken(token: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD || 'ym-global-secret';
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [employeeId, role, timestamp, signature] = parts;
  const payload = `${employeeId}.${role}.${timestamp}`;
  const expected = await hmacSha256(secret, payload);
  if (signature !== expected) return false;
  const age = Date.now() - parseInt(timestamp, 10);
  return age <= 30 * 24 * 60 * 60 * 1000;
}

async function isValidAuth(token: string): Promise<boolean> {
  // New session token
  if (await verifyToken(token)) return true;
  // Legacy shared password
  const storedHash = process.env.DASHBOARD_PASSWORD || '';
  return token === storedHash;
}

export async function middleware(req: NextRequest) {
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
    if (cookie && await isValidAuth(cookie)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Page routes: check cookie
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!cookie || !(await isValidAuth(cookie))) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
