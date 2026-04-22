import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { storeId, rows } = await req.json();
  if (!storeId || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'storeId and rows[] required' }, { status: 400 });
  }

  const db = getDb();
  const updateStmt = db.prepare(
    'UPDATE orders SET tracking_number = ?, carrier = ? WHERE store_id = ? AND order_number = ?'
  );

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const rawOrderNum = String(row.order_number || '').replace(/^#/, '').trim();
    const trackingNumber = String(row.tracking_number || '').trim();
    const carrier = String(row.carrier || '').trim();

    if (!rawOrderNum || !trackingNumber) { skipped++; continue; }

    const result = updateStmt.run(trackingNumber, carrier || null, storeId, rawOrderNum);
    if (result.changes > 0) {
      updated++;
    } else {
      skipped++;
      if (errors.length < 10) errors.push(`#${rawOrderNum} not found`);
    }
  }

  return NextResponse.json({ success: true, updated, skipped, total: rows.length, errors });
}
