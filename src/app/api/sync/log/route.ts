import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const logs = db.prepare(
    'SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 50'
  ).all();
  return NextResponse.json({ logs });
}
