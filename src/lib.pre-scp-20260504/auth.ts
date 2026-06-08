import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

const AUTH_COOKIE = 'ym_auth';
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD || 'ym-global-secret';

// Hash a password with SHA256 + salt
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(password + salt).digest('hex');
  return `${salt}:${hash}`;
}

// Verify password against stored hash
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const inputHash = crypto.createHash('sha256').update(password + salt).digest('hex');
  return inputHash === hash;
}

// Create a signed session token: employeeId.timestamp.signature
export function createSessionToken(employeeId: string, role: string): string {
  const timestamp = Date.now().toString();
  const payload = `${employeeId}.${role}.${timestamp}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

// Verify and decode a session token, returns { employeeId, role } or null
export function verifySessionToken(token: string): { employeeId: string; role: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [employeeId, role, timestamp, signature] = parts;
  const payload = `${employeeId}.${role}.${timestamp}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (signature !== expected) return null;
  // Token expires after 30 days
  const age = Date.now() - parseInt(timestamp, 10);
  if (age > 30 * 24 * 60 * 60 * 1000) return null;
  return { employeeId, role };
}

// Legacy: get old shared password
export function getPassword(): string {
  return process.env.DASHBOARD_PASSWORD || 'admin';
}

export function isAuthenticated(): boolean {
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) return false;
  // Check new session token
  if (verifySessionToken(token)) return true;
  // Fallback: old shared password
  return token === getPassword();
}

export function getSessionEmployee(): { employeeId: string; role: string } | null {
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function isApiAuthorized(req: NextRequest): boolean {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie) {
    if (verifySessionToken(cookie)) return true;
    if (cookie === getPassword()) return true;
  }
  const header = req.headers.get('authorization');
  if (header) {
    const token = header.replace('Bearer ', '');
    if (verifySessionToken(token)) return true;
    if (token === getPassword()) return true;
  }
  return false;
}
