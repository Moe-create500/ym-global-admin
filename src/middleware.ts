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

async function verifyToken(token: string): Promise<{ valid: boolean; role: string }> {
  const secret = process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD || 'ym-global-secret';
  const parts = token.split('.');
  if (parts.length !== 4) return { valid: false, role: '' };
  const [employeeId, role, timestamp, signature] = parts;
  const payload = `${employeeId}.${role}.${timestamp}`;
  const expected = await hmacSha256(secret, payload);
  if (signature !== expected) return { valid: false, role: '' };
  const age = Date.now() - parseInt(timestamp, 10);
  if (age > 30 * 24 * 60 * 60 * 1000) return { valid: false, role: '' };
  return { valid: true, role };
}

function isLegacyPassword(token: string): boolean {
  return token.split('.').length !== 4;
}

async function resolveAuth(token: string): Promise<{ valid: boolean; role: string }> {
  // Try session token first
  const session = await verifyToken(token);
  if (session.valid) return session;
  // Legacy shared password → admin
  if (isLegacyPassword(token)) {
    const storedHash = process.env.DASHBOARD_PASSWORD || '';
    if (token === storedHash) return { valid: true, role: 'admin' };
  }
  return { valid: false, role: '' };
}

// Pages client users (viewer/manager) are allowed to access
const CLIENT_ALLOWED_PAGES = [
  '/dashboard',
  '/dashboard/ads',
  '/dashboard/creatives',
];

// API routes client users are allowed to call
const CLIENT_ALLOWED_APIS = [
  '/api/stores',
  '/api/pnl',
  '/api/creatives',
  '/api/products',
  '/api/auth',
  '/api/billing',
  '/api/ads/performance',
  '/api/batches',
];

function isClientAllowedPage(pathname: string): boolean {
  return CLIENT_ALLOWED_PAGES.some(p => pathname === p || pathname === p + '/');
}

function isClientAllowedApi(pathname: string): boolean {
  return CLIENT_ALLOWED_APIS.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
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

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!cookie) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const auth = await resolveAuth(cookie);
  if (!auth.valid) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // ═══ CLIENT LOCKDOWN ═══
  // Non-admin users (viewer, manager) can only access whitelisted pages and APIs
  const isAdmin = auth.role === 'admin' || auth.role === 'data_corrector' || auth.role === '';
  if (!isAdmin) {
    if (pathname.startsWith('/api/')) {
      if (!isClientAllowedApi(pathname)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (pathname.startsWith('/dashboard')) {
      if (!isClientAllowedPage(pathname)) {
        return NextResponse.redirect(new URL('/dashboard', req.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
