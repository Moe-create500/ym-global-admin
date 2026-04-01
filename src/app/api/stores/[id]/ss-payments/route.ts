import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const payments = db.prepare(
    'SELECT * FROM ss_payments WHERE store_id = ? ORDER BY date DESC'
  ).all(params.id);
  const total = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) as total FROM ss_payments WHERE store_id = ?'
  ).get(params.id) as any;
  return NextResponse.json({ payments, total_paid_cents: total.total });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { amount, date, note } = await req.json();

  if (!amount || !date) {
    return NextResponse.json({ error: 'Amount and date are required' }, { status: 400 });
  }

  const amountCents = Math.round(parseFloat(amount) * 100);
  if (amountCents <= 0) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(
    'INSERT INTO ss_payments (id, store_id, amount_cents, date, note, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, params.id, amountCents, date, note || null, 'manual');

  // Update store total paid
  const totalPaid = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) as total FROM ss_payments WHERE store_id = ?'
  ).get(params.id) as any;

  db.prepare('UPDATE stores SET ss_total_paid_cents = ? WHERE id = ?')
    .run(totalPaid.total, params.id);

  return NextResponse.json({ success: true, id });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const paymentId = searchParams.get('paymentId');
  if (!paymentId) return NextResponse.json({ error: 'paymentId required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM ss_payments WHERE id = ? AND store_id = ?').run(paymentId, params.id);

  const totalPaid = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) as total FROM ss_payments WHERE store_id = ?'
  ).get(params.id) as any;
  db.prepare('UPDATE stores SET ss_total_paid_cents = ? WHERE id = ?')
    .run(totalPaid.total, params.id);

  return NextResponse.json({ success: true });
}
