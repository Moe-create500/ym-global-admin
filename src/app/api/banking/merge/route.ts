import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scanDuplicateAccounts, mergeAccounts } from '@/lib/account-identity';

export const dynamic = 'force-dynamic';

// GET: scan for duplicate account rows — dry-run report, no writes.
export async function GET() {
  const db = getDb();
  const { proposals, ambiguous } = scanDuplicateAccounts(db);
  const detailed = proposals.map(p => ({
    ...p,
    preview: mergeAccounts(db, p.keepId, p.dupId, { dryRun: true }),
  }));
  return NextResponse.json({ proposals: detailed, ambiguous });
}

// POST { merges: [{keepId, dupId}] } — apply reviewed merges.
// Every merge is validated (identity match, direction) and audited.
export async function POST(req: NextRequest) {
  const { merges } = await req.json().catch(() => ({}));
  if (!Array.isArray(merges) || merges.length === 0) {
    return NextResponse.json({ error: 'merges[] required' }, { status: 400 });
  }
  const db = getDb();
  const results = [];
  for (const m of merges) {
    try {
      results.push({ ...m, ...mergeAccounts(db, m.keepId, m.dupId, { actor: 'admin' }) });
    } catch (e: any) {
      results.push({ ...m, merged: false, error: String(e?.message || e) });
    }
  }
  return NextResponse.json({ results });
}
