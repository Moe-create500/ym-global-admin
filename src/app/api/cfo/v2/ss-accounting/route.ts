import { NextRequest, NextResponse } from 'next/server';
import { isApiAuthorized } from '@/lib/auth';
import { getSsAccounting, type SSAccountingFeed } from '@/lib/shipsourced';
export const dynamic = 'force-dynamic';
const FEEDS: SSAccountingFeed[] = ['receivables', 'payments', 'payables', 'subscriptions', 'inventory-value', 'chargebacks', 'write-offs'];
/** GET /api/cfo/v2/ss-accounting?feed=receivables[&from&to&window&clientId&items] — proxies one ShipSourced accounting feed with the server-side key; the browser never sees it. */
export async function GET(req: NextRequest) {
  if (!isApiAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams; const feed = sp.get('feed') as SSAccountingFeed;
  if (!FEEDS.includes(feed)) return NextResponse.json({ error: `feed must be one of ${FEEDS.join(', ')}` }, { status: 400 });
  const query: Record<string, string> = {};
  for (const k of ['from', 'to', 'window', 'clientId', 'items']) { const v = sp.get(k); if (v) query[k] = v; }
  try { return NextResponse.json(await getSsAccounting(feed, query)); }
  catch (e: any) { return NextResponse.json({ error: `ShipSourced feed unavailable: ${e?.message || e}` }, { status: 502 }); }
}
