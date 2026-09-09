import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAllDisputes } from '@/lib/chargeflow';
import { rollUpChargebacks } from '@/lib/chargeback-rollup';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function mapStatus(cfStatus: string): string {
  switch (cfStatus) {
    case 'won': return 'won';
    case 'lost': return 'lost';
    case 'under_review':
    case 'needs_response':
    default: return 'open';
  }
}

export async function POST(req: NextRequest) {
  const { storeId } = await req.json();
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  const store: any = db.prepare('SELECT id, chargeflow_api_key FROM stores WHERE id = ?').get(storeId);
  if (!store?.chargeflow_api_key) {
    return NextResponse.json({ error: 'No Chargeflow API key configured' }, { status: 400 });
  }

  const disputes = await getAllDisputes(store.chargeflow_api_key);

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const d of disputes) {
    const chargebackDate = d.created_at.substring(0, 10);
    const amountCents = Math.round(d.amount * 100);
    const status = mapStatus(d.status);

    const existing: any = db.prepare(
      'SELECT id, status FROM chargebacks WHERE store_id = ? AND dispute_id = ?'
    ).get(storeId, d.id);

    if (existing) {
      // Update status if changed
      if (existing.status !== status) {
        db.prepare(`
          UPDATE chargebacks SET status = ?, amount_cents = ?, reason = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(status, amountCents, d.reason || null, existing.id);
        updated++;
      } else {
        skipped++;
      }
    } else {
      db.prepare(`
        INSERT INTO chargebacks (id, store_id, dispute_id, order_number, chargeback_date, amount_cents, reason, status, source, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'chargeflow', ?)
      `).run(
        crypto.randomUUID(), storeId, d.id,
        d.order || null, chargebackDate, amountCents,
        d.reason || null, status, d.stage || null
      );
      imported++;
    }
  }

  // Recalc P&L with updated chargebacks
  rollUpChargebacks(db, storeId);

  return NextResponse.json({
    success: true,
    imported,
    updated,
    skipped,
    total: disputes.length,
  });
}
