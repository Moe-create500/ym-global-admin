import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('storeId');

  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  const notes: any[] = db.prepare(
    'SELECT id, note, category, created_at, updated_at FROM store_notes WHERE store_id = ? ORDER BY created_at DESC'
  ).all(storeId);

  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { storeId, note, category } = body;

  if (!storeId || !note) {
    return NextResponse.json({ error: 'storeId and note required' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO store_notes (id, store_id, note, category, created_at, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))'
  ).run(id, storeId, note, category || 'general');

  return NextResponse.json({ success: true, id });
}

export async function DELETE(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  db.prepare('DELETE FROM store_notes WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
