import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getMonthlyStoreReport } from '@/lib/cfo-monthly';

export const dynamic = 'force-dynamic';

// Month-first CFO report: store expenses, card allocation, P&L cross-check.
// Read-only over existing financial truth.
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  try {
    return NextResponse.json(getMonthlyStoreReport(getDb(), month));
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
