import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildCashflowProjection } from '@/lib/cashflow';

export const dynamic = 'force-dynamic';

// GET /api/cashflow?storeId=...&horizon=14 → date-by-date landing projection + card obligations
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId') || undefined;
  const horizon = Math.min(30, Math.max(7, parseInt(req.nextUrl.searchParams.get('horizon') || '14', 10) || 14));
  try {
    const db = getDb();
    const projection = buildCashflowProjection(db, storeId, horizon);
    return NextResponse.json({ projection }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'CDN-Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    console.error('[cashflow]', err?.message || err);
    return NextResponse.json({ error: err?.message || 'projection failed' }, { status: 500 });
  }
}
