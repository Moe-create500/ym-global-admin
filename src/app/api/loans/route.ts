import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const db = getDb();

  let where = 'WHERE 1=1';
  const params: any[] = [];
  if (storeId) { where += ' AND l.store_id = ?'; params.push(storeId); }

  const loans = db.prepare(`
    SELECT l.*,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM loan_payments WHERE loan_id = l.id) as total_paid_cents
    FROM loans l ${where}
    ORDER BY l.loan_date DESC
  `).all(...params);

  const borrowed = (loans as any[]).filter(l => l.type !== 'lent');
  const lent = (loans as any[]).filter(l => l.type === 'lent');

  const summary = {
    total_borrowed_cents: borrowed.reduce((s: number, l: any) => s + l.amount_cents, 0),
    borrowed_remaining_cents: borrowed.reduce((s: number, l: any) => s + l.remaining_cents, 0),
    borrowed_paid_cents: borrowed.reduce((s: number, l: any) => s + (l.total_paid_cents || 0), 0),
    borrowed_active: borrowed.filter((l: any) => l.status === 'active').length,
    total_lent_cents: lent.reduce((s: number, l: any) => s + l.amount_cents, 0),
    lent_remaining_cents: lent.reduce((s: number, l: any) => s + l.remaining_cents, 0),
    lent_paid_cents: lent.reduce((s: number, l: any) => s + (l.total_paid_cents || 0), 0),
    lent_active: lent.filter((l: any) => l.status === 'active').length,
  };

  return NextResponse.json({ loans, summary });
}

export async function POST(req: NextRequest) {
  const { storeId, type, lender, description, amount, loanDate, dueDate, interestRate, bankTransactionId } = await req.json();

  if (!storeId || !amount || !loanDate) {
    return NextResponse.json({ error: 'storeId, amount, and loanDate required' }, { status: 400 });
  }

  const amountCents = Math.round(parseFloat(amount) * 100);
  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO loans (id, store_id, bank_transaction_id, lender, description, amount_cents, remaining_cents, interest_rate, loan_date, due_date, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, storeId, bankTransactionId || null, lender || null, description || null,
    amountCents, amountCents, parseFloat(interestRate || '0'), loanDate, dueDate || null, type || 'borrowed');

  return NextResponse.json({ success: true, id });
}

export async function PATCH(req: NextRequest) {
  const { loanId, paymentAmount, paymentDate, note, bankTransactionId } = await req.json();

  if (!loanId || !paymentAmount || !paymentDate) {
    return NextResponse.json({ error: 'loanId, paymentAmount, and paymentDate required' }, { status: 400 });
  }

  const amountCents = Math.round(parseFloat(paymentAmount) * 100);
  const db = getDb();

  // Add payment
  db.prepare(`
    INSERT INTO loan_payments (id, loan_id, amount_cents, date, bank_transaction_id, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), loanId, amountCents, paymentDate, bankTransactionId || null, note || null);

  // Update remaining
  const loan: any = db.prepare('SELECT amount_cents FROM loans WHERE id = ?').get(loanId);
  const totalPaid: any = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM loan_payments WHERE loan_id = ?').get(loanId);
  const remaining = Math.max(0, loan.amount_cents - totalPaid.total);
  const status = remaining <= 0 ? 'paid_off' : 'active';

  db.prepare("UPDATE loans SET remaining_cents = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(remaining, status, loanId);

  return NextResponse.json({ success: true, remaining_cents: remaining });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM loan_payments WHERE loan_id = ?').run(id);
  db.prepare('DELETE FROM loans WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
