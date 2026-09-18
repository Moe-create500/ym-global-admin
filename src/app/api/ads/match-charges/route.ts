import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { matchInvoicesToCharges } from '@/lib/charge-matching';

export const dynamic = 'force-dynamic';

/** Link invoices (Meta / Google ad payments, Shopify bills) to the card charges
 *  that paid them — the evidence behind each invoice's "✓ on ··1009" badge.
 *  GET previews, POST applies. Runs automatically after every cron sync;
 *  this endpoint is for re-running it on demand after a backfill.  */

function run(req: NextRequest, dryRun: boolean) {
  const days = Math.min(3650, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') || '60', 10) || 60));
  const db = getDb();
  const before: any = db.prepare(
    `SELECT COUNT(*) n FROM txn_links WHERE entity_id IS NOT NULL AND entity_type IN ('ad_payment','shopify_invoice')`
  ).get();
  const result = matchInvoicesToCharges(db, { days, dryRun });
  const after: any = dryRun ? before : db.prepare(
    `SELECT COUNT(*) n FROM txn_links WHERE entity_id IS NOT NULL AND entity_type IN ('ad_payment','shopify_invoice')`
  ).get();
  return NextResponse.json({ ok: true, dryRun, days, linksBefore: before.n, linksAfter: after.n, ...result });
}

export async function GET(req: NextRequest) { return run(req, true); }
export async function POST(req: NextRequest) { return run(req, false); }
