import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { seedIdentityMap, identityMatrix, assignAlias } from '@/lib/identity';
import { getSourceHealth } from '@/lib/source-registry';
import { ensureFoundationSchema, getCashPosition, getBankBooksRecon, getInterCompanyLedger, setAccountCompany } from '@/lib/foundation';

export const dynamic = 'force-dynamic';

// The company brain's ground floor: cash truth per company, feed trust,
// bank↔books reconciliation, inter-company ledger, identity map.
export async function GET(req: NextRequest) {
  const db = getDb();
  ensureFoundationSchema(db);
  seedIdentityMap(db); // idempotent, never touches manual rows
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 30, 7), 120);

  return NextResponse.json({
    cash: getCashPosition(db),
    trust: getSourceHealth(db),
    recon: getBankBooksRecon(db, days),
    interco: getInterCompanyLedger(db),
    identity: identityMatrix(db),
  });
}

// POST {action:'assign_alias', namespace, externalId, storeId, note?}
//      {action:'set_company', accountId, company}
export async function POST(req: NextRequest) {
  const db = getDb();
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'assign_alias') {
      assignAlias(db, b.namespace, b.externalId, b.storeId, b.note);
      return NextResponse.json({ success: true });
    }
    if (b.action === 'set_company') {
      setAccountCompany(db, b.accountId, b.company);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 400 });
  }
}
