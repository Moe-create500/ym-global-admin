import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const AUTH_COOKIE = 'ym_auth';

export function getPassword(): string {
  return process.env.DASHBOARD_PASSWORD || 'admin';
}

export function isAuthenticated(): boolean {
  const cookieStore = cookies();
  return cookieStore.get(AUTH_COOKIE)?.value === getPassword();
}

export function isApiAuthorized(req: NextRequest): boolean {
  // Check cookie
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie === getPassword()) return true;

  // Check Authorization header
  const header = req.headers.get('authorization');
  if (header) {
    const token = header.replace('Bearer ', '');
    if (token === getPassword()) return true;
  }

  return false;
}
