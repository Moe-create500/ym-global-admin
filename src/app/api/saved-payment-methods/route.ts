import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  const methods = db.prepare('SELECT * FROM saved_payment_methods WHERE store_id = ? ORDER BY label').all(storeId);
  return NextResponse.json({ methods });
}

export async function POST(req: NextRequest) {
  const { storeId, label, type, cardLast4 } = await req.json();
  if (!storeId || !label) return NextResponse.json({ error: 'storeId and label required' }, { status: 400 });

  const db = getDb();

  // Upsert — ignore if already exists
  const existing = db.prepare('SELECT id FROM saved_payment_methods WHERE store_id = ? AND label = ?').get(storeId, label);
  if (existing) return NextResponse.json({ success: true, id: (existing as any).id, existing: true });

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO saved_payment_methods (id, store_id, label, type, card_last4) VALUES (?, ?, ?, ?, ?)')
    .run(id, storeId, label, type || 'other', cardLast4 || null);

  return NextResponse.json({ success: true, id });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM saved_payment_methods WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
