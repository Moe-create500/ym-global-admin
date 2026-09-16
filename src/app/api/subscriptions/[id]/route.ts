import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isApiAuthorized } from '@/lib/auth';
import { subscriptionDetail } from '@/lib/subscriptions/service';

export const dynamic = 'force-dynamic';

/** GET /api/subscriptions/<id> — the subscription plus every source
 *  transaction that made YM call it recurring, and its sibling plans. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isApiAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const d = subscriptionDetail(getDb(), decodeURIComponent(params.id));
  if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(d);
}
