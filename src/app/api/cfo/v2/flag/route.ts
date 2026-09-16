import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isApiAuthorized } from '@/lib/auth';
import { getSession } from '@/lib/auth-tenant';
import { isCfoV2Enabled, setCfoV2 } from '@/lib/cfo/flags';

export const dynamic = 'force-dynamic';

/** GET → { enabled } · POST { on: boolean } (admin) → switch the CFO v2 surface on/off without a deploy. */
export async function GET(req: NextRequest) {
  if (!isApiAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ enabled: isCfoV2Enabled(getDb(), req.nextUrl.searchParams.get('v2')) });
}

export async function POST(req: NextRequest) {
  if (!isApiAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const session = getSession(req);
  if (session && !['admin', 'data_corrector', ''].includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  setCfoV2(getDb(), !!body.on);
  return NextResponse.json({ enabled: !!body.on });
}
