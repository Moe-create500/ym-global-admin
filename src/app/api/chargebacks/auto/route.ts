import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runChargebackAutoResponder, buildEvidenceForChargeback } from '@/lib/chargeback-auto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/chargebacks/auto?chargebackId= → build and return the full evidence
// pack for one dispute (for the dashboard's copy/paste Evidence view — the
// dispute_evidences API scope is not grantable to custom apps, so final entry
// into the Shopify dispute form is manual).
export async function GET(req: NextRequest) {
  const chargebackId = req.nextUrl.searchParams.get('chargebackId');
  if (!chargebackId) return NextResponse.json({ error: 'chargebackId required' }, { status: 400 });
  try {
    const built = await buildEvidenceForChargeback(getDb(), chargebackId);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
    return NextResponse.json(built);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}

// Single-flight — the hourly background tick and manual clicks must not stack.
let running = false;

// POST /api/chargebacks/auto { dryRun?, limit? } → run one auto-responder pass
// now and return the per-dispute decisions.
export async function POST(req: NextRequest) {
  if (running) return NextResponse.json({ error: 'Auto-responder already running' }, { status: 409 });
  running = true;
  try {
    const body = await req.json().catch(() => ({}));
    const result = await runChargebackAutoResponder(getDb(), {
      dryRun: !!body.dryRun, limit: body.limit,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  } finally {
    running = false;
  }
}
