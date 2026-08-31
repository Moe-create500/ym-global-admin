import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';
import { dropBrainCache } from '@/lib/brain-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  const cardLast4 = searchParams.get('cardLast4');
  const platform = searchParams.get('platform');

  const db = getDb();

  let where = "WHERE (cp.category = 'ad' OR cp.category IS NULL)";
  const params: any[] = [];
  if (storeId) { where += ' AND cp.store_id = ?'; params.push(storeId); }
  if (cardLast4) { where += ' AND cp.card_last4 = ?'; params.push(cardLast4); }
  if (platform) { where += ' AND cp.platform = ?'; params.push(platform); }

  const payments = db.prepare(`
    SELECT cp.*, s.name as store_name
    FROM card_payments_log cp
    JOIN stores s ON s.id = cp.store_id
    ${where}
    ORDER BY cp.date DESC
    LIMIT 200
  `).all(...params);

  // Summary per card
  const cardTotals = db.prepare(`
    SELECT cp.card_last4, SUM(cp.amount_cents) as total_paid_cents, COUNT(*) as payment_count
    FROM card_payments_log cp
    ${where}
    GROUP BY cp.card_last4
  `).all(...params);

  // Bank reconciliation: which account each logged payment actually left,
  // and whether the card issuer has taken it yet.
  let bankRecon: Record<string, any> = {};
  try {
    const { reconcileLoggedPayments } = await import('@/lib/transactions-intel');
    bankRecon = reconcileLoggedPayments(db);
  } catch { /* recon is best-effort — the log list must still render */ }

  return NextResponse.json({ payments, cardTotals, bankRecon });
}

export async function POST(req: NextRequest) {
  dropBrainCache(); // financial write — cached answers must not outlive it
  const body = await req.json();
  const { storeId, cardLast4, date, amountCents, method, notes, platform } = body;

  if (!storeId || !cardLast4 || !date || !amountCents) {
    return NextResponse.json({ error: 'storeId, cardLast4, date, and amountCents are required' }, { status: 400 });
  }

  const db = getDb();

  // No business-key uniqueness on this table — an accidental double-submit
  // would double-credit the card and break bank pairing. Same store + card +
  // date + amount = same payment unless the caller explicitly forces it.
  const dupe: any = db.prepare(
    `SELECT id FROM card_payments_log WHERE store_id = ? AND card_last4 = ? AND date = ? AND amount_cents = ?`
  ).get(storeId, cardLast4, date, amountCents);
  if (dupe && !body.force) {
    return NextResponse.json({
      error: `A payment of $${(amountCents / 100).toFixed(2)} on ··${cardLast4} for ${date} is already logged. Pass force:true if this is genuinely a second payment.`,
      duplicateOf: dupe.id,
    }, { status: 409 });
  }

  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO card_payments_log (id, store_id, card_last4, date, amount_cents, method, notes, category, platform)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ad', ?)
  `).run(id, storeId, cardLast4, date, amountCents, method || null, notes || null, platform || 'facebook');

  return NextResponse.json({ success: true, id });
}

export async function DELETE(req: NextRequest) {
  dropBrainCache(); // financial write — cached answers must not outlive it
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM card_payments_log WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
