import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getFinancialHealth } from '@/lib/financial-integrity';

export const dynamic = 'force-dynamic';

// Financial health scan — every unresolved integrity issue, computed from
// evidence. The system tells you what's wrong before you find it manually.
export async function GET() {
  return NextResponse.json(getFinancialHealth(getDb()));
}
