import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { cardName, lastFour, cardType, issuer, expiryMonth, expiryYear, notes } = await req.json();

  if (!cardName || !lastFour) {
    return NextResponse.json({ error: 'cardName and lastFour are required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO payment_cards (id, card_name, last_four, card_type, issuer, expiry_month, expiry_year, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, cardName, lastFour, cardType || 'visa', issuer || null, expiryMonth || null, expiryYear || null, notes || null);

  return NextResponse.json({ success: true, id });
}
