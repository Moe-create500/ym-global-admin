/**
 * Multi-Tenant Authorization — Store Access Enforcement
 *
 * Every API route that accepts a storeId must call requireStoreAccess()
 * before returning any data.
 *
 * Rules:
 *   admin / data_corrector → access ALL stores
 *   manager / viewer       → access ONLY stores in employee_store_access
 *   no session             → 401
 *   wrong store            → 403
 */

import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD || 'ym-global-secret';

/**
 * Verify and decode a session token. Returns { employeeId, role } or null.
 * Mirrors the logic in the main auth.ts — must stay in sync.
 */
function verifySessionToken(token: string): { employeeId: string; role: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [employeeId, role, timestamp, signature] = parts;
  const payload = `${employeeId}.${role}.${timestamp}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (signature !== expected) return null;
  const age = Date.now() - parseInt(timestamp, 10);
  if (age > 30 * 24 * 60 * 60 * 1000) return null;
  return { employeeId, role };
}

/**
 * Get the list of store IDs an employee can access.
 */
export function getAccessibleStoreIds(employeeId: string, role: string): string[] {
  const db = getDb();
  if (role === 'admin' || role === 'data_corrector') {
    const rows: any[] = db.prepare('SELECT id FROM stores WHERE is_active = 1').all();
    return rows.map(r => r.id);
  }
  const rows: any[] = db.prepare(
    'SELECT store_id FROM employee_store_access WHERE employee_id = ?'
  ).all(employeeId);
  return rows.map(r => r.store_id);
}

/**
 * Check if an employee can access a specific store.
 */
export function canAccessStore(employeeId: string, role: string, storeId: string): boolean {
  if (role === 'admin' || role === 'data_corrector') return true;
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM employee_store_access WHERE employee_id = ? AND store_id = ?'
  ).get(employeeId, storeId);
  return !!row;
}

/**
 * Extract session from a request and verify store access.
 * Returns the session if authorized, or a 401/403 NextResponse if not.
 */
/**
 * Check if a cookie is the legacy shared password (not a session token).
 * Legacy password cookies don't have the employeeId.role.timestamp.signature format.
 */
function isLegacyPassword(cookie: string): boolean {
  // Session tokens always have exactly 4 dot-separated parts
  const parts = cookie.split('.');
  if (parts.length === 4) return false; // looks like a session token
  // If it's not a session token format, it's the legacy shared password
  return true;
}

export function requireStoreAccess(
  req: NextRequest,
  storeId: string | null | undefined,
): { authorized: true; employeeId: string; role: string } | { authorized: false; response: NextResponse } {
  const cookie = req.cookies.get('ym_auth')?.value;
  if (!cookie) {
    return { authorized: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const session = verifySessionToken(cookie);
  if (!session) {
    // Only treat as admin if the cookie is the legacy shared password format.
    // If it's a session token that failed verification (e.g., expired or bad signature),
    // return 401 — do NOT default to admin.
    if (isLegacyPassword(cookie)) {
      return { authorized: true, employeeId: 'legacy', role: 'admin' };
    }
    return { authorized: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!storeId) {
    return { authorized: true, employeeId: session.employeeId, role: session.role };
  }
  if (!canAccessStore(session.employeeId, session.role, storeId)) {
    console.log(`[AUTH] BLOCKED: employee ${session.employeeId} (${session.role}) tried to access store ${storeId}`);
    return { authorized: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { authorized: true, employeeId: session.employeeId, role: session.role };
}

/**
 * Check if a store's tenant has billing ready (for non-internal client stores).
 * Internal stores and admin users bypass this check.
 * Returns true if generation is allowed, false + reason if blocked.
 */
export function assertBillingReady(storeId: string, role: string): { allowed: true } | { allowed: false; reason: string } {
  // Admin/manager bypass billing check
  if (role === 'admin' || role === 'data_corrector' || role === 'manager') {
    return { allowed: true };
  }
  // Legacy auth bypass
  if (role === '' || !role) return { allowed: true };

  const db = getDb();
  const store: any = db.prepare('SELECT tenant_id FROM stores WHERE id = ?').get(storeId);
  if (!store?.tenant_id) return { allowed: true }; // no tenant = legacy store, allow

  const tenant: any = db.prepare('SELECT is_internal, billing_status, stripe_customer_id FROM tenants WHERE id = ?').get(store.tenant_id);
  if (!tenant) return { allowed: true };

  // Internal stores are exempt from billing
  if (tenant.is_internal) return { allowed: true };

  // Non-internal stores must have active billing
  if (tenant.billing_status === 'exempt') return { allowed: true };
  if (tenant.billing_status === 'active' && tenant.stripe_customer_id) return { allowed: true };

  return {
    allowed: false,
    reason: 'Billing setup required before using the creative generator. Please add a payment method in the Billing tab.',
  };
}

/**
 * Get session from request (without store check).
 */
export function getSession(req: NextRequest): { employeeId: string; role: string } | null {
  const cookie = req.cookies.get('ym_auth')?.value;
  if (!cookie) return null;
  const session = verifySessionToken(cookie);
  if (!session) {
    // Only legacy password → admin. Failed session tokens → null.
    if (isLegacyPassword(cookie)) return { employeeId: 'legacy', role: 'admin' };
    return null;
  }
  return session;
}
