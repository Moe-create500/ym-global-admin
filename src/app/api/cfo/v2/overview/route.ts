import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isApiAuthorized } from '@/lib/auth';
import { getSession, canAccessStore } from '@/lib/auth-tenant';
import { resolveScope, listScopes } from '@/lib/cfo/scopes';
import { getOverview, defaultPeriod } from '@/lib/cfo/report';
import { collectIssues, countByUnit, issuesForScope } from '@/lib/cfo/issues';
import { isCfoV2Enabled } from '@/lib/cfo/flags';
import { getBillingFlags } from '@/lib/shipsourced';
import { getShipSourcedPnl } from '@/lib/cfo/ss-pnl';

export const dynamic = 'force-dynamic';

/** GET /api/cfo/v2/overview?scope=all|stores|store:<id>|ss|ss:ca|ss:cn&from=&to=
 *  Read-only. Every figure carries provenance; nothing here mutates data. */
export async function GET(req: NextRequest) {
  if (!isApiAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  // Off is a normal state, not an error: the page shows how to switch it on.
  if (!isCfoV2Enabled(db, sp.get('v2'))) return NextResponse.json({ enabled: false });

  const scope = resolveScope(db, sp.get('scope'));
  if (!scope) return NextResponse.json({ error: 'unknown scope' }, { status: 400 });
  const session = getSession(req);
  const isAdmin = !session || ['admin', 'data_corrector', 'manager', ''].includes(session.role);
  if (!isAdmin) {
    if (scope.kind !== 'store' || !canAccessStore(session!.employeeId, session!.role, scope.storeIds[0])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  const dflt = defaultPeriod();
  const from = sp.get('from') || dflt.from, to = sp.get('to') || dflt.to;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return NextResponse.json({ error: 'bad period' }, { status: 400 });
  const period = { from, to };

  const ssFlags = async () => {
    if (!process.env.SHIPSOURCED_API_TOKEN) return { available: false, reason: 'SHIPSOURCED_API_TOKEN not set' };
    try { const r = await getBillingFlags(); return { available: true, asOf: r.asOf, flags: r.flags }; }
    catch (e: any) { return { available: false, reason: /404/.test(String(e?.message)) ? 'ShipSourced has no billing-flags endpoint yet (PR pending)' : String(e?.message || e).slice(0, 120) }; }
  };
  const allIssues = await collectIssues(db, period, ssFlags);
  const scopes = listScopes(db);
  const ssPnl = await getShipSourcedPnl(db, period.from, period.to).catch(() => null);
  const overview = getOverview(db, scope, period, countByUnit(allIssues, scopes), Date.now(), { ssPnl });
  const issues = issuesForScope(allIssues, scope, scopes);
  return NextResponse.json({ enabled: true, ...overview, issues, scopes: scopes.map(s => ({ id: s.id, label: s.label, kind: s.kind, parentId: s.parentId, mapping: s.mapping.status })) });
}
