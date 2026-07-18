import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runChargebackAutoResponder } from '@/lib/chargeback-auto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
