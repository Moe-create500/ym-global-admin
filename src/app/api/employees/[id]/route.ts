import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();

  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(params.id);
  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const storeAccess = db.prepare(`
    SELECT esa.*, s.name as store_name
    FROM employee_store_access esa
    JOIN stores s ON s.id = esa.store_id
    WHERE esa.employee_id = ?
  `).all(params.id);

  return NextResponse.json({ employee, storeAccess });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const db = getDb();

  const fields: string[] = [];
  const values: any[] = [];

  const allowed = ['name', 'email', 'role', 'is_active', 'permissions'];
  for (const [key, val] of Object.entries(body)) {
    if (allowed.includes(key)) {
      fields.push(`"${key}" = ?`);
      values.push(typeof val === 'object' ? JSON.stringify(val) : val);
    }
  }

  if (fields.length > 0) {
    fields.push('"updated_at" = datetime(\'now\')');
    values.push(params.id);
    db.prepare(`UPDATE employees SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  // Update store access if provided
  if (body.storeIds && Array.isArray(body.storeIds)) {
    db.prepare('DELETE FROM employee_store_access WHERE employee_id = ?').run(params.id);
    const stmt = db.prepare(
      'INSERT INTO employee_store_access (id, employee_id, store_id, role) VALUES (?, ?, ?, ?)'
    );
    for (const storeId of body.storeIds) {
      stmt.run(crypto.randomUUID(), params.id, storeId, body.role || 'viewer');
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare('UPDATE employees SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(params.id);
  return NextResponse.json({ success: true });
}
