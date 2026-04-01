import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { cardId, storeId, service, monthlyCostCents, notes } = await req.json();

  if (!cardId || !service) {
    return NextResponse.json({ error: 'cardId and service are required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO card_assignments (id, card_id, store_id, service, monthly_cost_cents, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, cardId, storeId || null, service, monthlyCostCents || 0, notes || null);

  return NextResponse.json({ success: true, id });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM card_assignments WHERE id = ?').run(id);

  return NextResponse.json({ success: true });
}
