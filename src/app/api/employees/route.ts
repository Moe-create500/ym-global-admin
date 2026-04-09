import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();

  const employees = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM employee_store_access esa WHERE esa.employee_id = e.id) as store_count
    FROM employees e
    WHERE e.is_active = 1
    ORDER BY e.name
  `).all();

  return NextResponse.json({ employees });
}

export async function POST(req: NextRequest) {
  const { name, email, password, role, storeIds } = await req.json();

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email are required' }, { status: 400 });
  }

  if (!password || password.length < 4) {
    return NextResponse.json({ error: 'Password is required (minimum 4 characters)' }, { status: 400 });
  }

  const db = getDb();

  // Check for duplicate email
  const existing = db.prepare('SELECT id FROM employees WHERE email = ? COLLATE NOCASE AND is_active = 1').get(email);
  if (existing) {
    return NextResponse.json({ error: 'An employee with this email already exists' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);

  db.prepare(`
    INSERT INTO employees (id, name, email, role, password_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, email, role || 'viewer', passwordHash);

  // Data correctors and admins get access to all stores automatically
  const effectiveRole = role || 'viewer';
  let assignStoreIds = storeIds && Array.isArray(storeIds) ? storeIds : [];

  if (effectiveRole === 'data_corrector' || effectiveRole === 'admin') {
    const allStores: any[] = db.prepare('SELECT id FROM stores WHERE is_active = 1').all();
    assignStoreIds = allStores.map((s: any) => s.id);
  }

  if (assignStoreIds.length > 0) {
    const stmt = db.prepare(
      'INSERT INTO employee_store_access (id, employee_id, store_id, role) VALUES (?, ?, ?, ?)'
    );
    for (const storeId of assignStoreIds) {
      stmt.run(crypto.randomUUID(), id, storeId, effectiveRole);
    }
  }

  return NextResponse.json({ success: true, id });
}
