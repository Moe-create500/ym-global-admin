import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isApiAuthorized } from '@/lib/auth';
import { getShipSourcedPnl } from '@/lib/cfo/ss-pnl';
import { defaultPeriod } from '@/lib/cfo/report';

export const dynamic = 'force-dynamic';

/** GET /api/cfo/v2/ss-pnl?from=&to= — ShipSourced P&L by fulfilment centre
 *  (California / China / combined): revenue and direct costs from ShipSourced
 *  billing, operating costs from YM's classified ledger rows. */
export async function GET(req: NextRequest) {
  if (!isApiAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const d = defaultPeriod();
  const from = sp.get('from') || d.from, to = sp.get('to') || d.to;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return NextResponse.json({ error: 'bad period' }, { status: 400 });
  return NextResponse.json(await getShipSourcedPnl(getDb(), from, to));
}
