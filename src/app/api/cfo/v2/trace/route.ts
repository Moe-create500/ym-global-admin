import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isApiAuthorized } from '@/lib/auth';
import { getSession, canAccessStore } from '@/lib/auth-tenant';
import { resolveScope } from '@/lib/cfo/scopes';
import { defaultPeriod } from '@/lib/cfo/report';
import { traceFigure } from '@/lib/cfo/trace';

export const dynamic = 'force-dynamic';

/** GET /api/cfo/v2/trace?key=revenue&scope=store:<id>&from=&to= — the records behind a number. */
export async function GET(req: NextRequest) {
  if (!isApiAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const scope = resolveScope(db, sp.get('scope'));
  if (!scope) return NextResponse.json({ error: 'unknown scope' }, { status: 400 });
  const session = getSession(req);
  const isAdmin = !session || ['admin', 'data_corrector', 'manager', ''].includes(session.role);
  if (!isAdmin && (scope.kind !== 'store' || !canAccessStore(session!.employeeId, session!.role, scope.storeIds[0]))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const dflt = defaultPeriod();
  const period = { from: sp.get('from') || dflt.from, to: sp.get('to') || dflt.to };
  const t = traceFigure(db, sp.get('key') || '', scope, period);
  if (!t) return NextResponse.json({ error: 'unknown figure' }, { status: 404 });
  return NextResponse.json(t);
}
