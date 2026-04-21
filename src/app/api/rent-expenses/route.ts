import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  const expenses = db.prepare(
    'SELECT * FROM rent_expenses WHERE store_id = ? ORDER BY due_date DESC'
  ).all(storeId);

  const summary: any = db.prepare(`
    SELECT
      SUM(amount_cents) as total_cents,
      SUM(CASE WHEN paid = 1 THEN amount_cents ELSE 0 END) as paid_cents,
      SUM(CASE WHEN paid = 0 THEN amount_cents ELSE 0 END) as unpaid_cents,
      COUNT(*) as total_count,
      SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END) as unpaid_count
    FROM rent_expenses WHERE store_id = ?
  `).get(storeId);

  return NextResponse.json({ expenses, summary });
}

export async function POST(req: NextRequest) {
  const { storeId, description, amount, dueDate, recurring, notes } = await req.json();
  if (!storeId || !description || !amount || !dueDate) {
    return NextResponse.json({ error: 'storeId, description, amount, dueDate required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const amountCents = Math.round(parseFloat(amount) * 100);

  db.prepare(`
    INSERT INTO rent_expenses (id, store_id, description, amount_cents, due_date, recurring, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, storeId, description, amountCents, dueDate, recurring ? 1 : 0, notes || null);

  return NextResponse.json({ success: true, id });
}

export async function PATCH(req: NextRequest) {
  const { id, paid, paidDate } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  db.prepare(`
    UPDATE rent_expenses SET paid = ?, paid_date = ?, updated_at = datetime('now') WHERE id = ?
  `).run(paid ? 1 : 0, paidDate || new Date().toISOString().slice(0, 10), id);

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM rent_expenses WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
