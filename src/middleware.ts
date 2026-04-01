import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE = 'ym_auth';

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

  const storedHash = process.env.DASHBOARD_PASSWORD || '';

  // API routes: check header or cookie
  if (pathname.startsWith('/api/')) {
    const cookie = req.cookies.get(AUTH_COOKIE)?.value;
    if (cookie === storedHash) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Page routes: check cookie
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie !== storedHash) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
