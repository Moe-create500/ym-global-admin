import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rollUpChargebacks } from '@/lib/chargeback-rollup';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const SUMMARY_SQL = `
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
    SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_count,
    SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_count,
    SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) as refunded_count,
    SUM(amount_cents) as total_cents,
    SUM(CASE WHEN status = 'open' THEN amount_cents ELSE 0 END) as open_cents,
    SUM(CASE WHEN status = 'lost' THEN amount_cents ELSE 0 END) as lost_cents,
    SUM(CASE WHEN status = 'won' THEN amount_cents ELSE 0 END) as won_cents,
    SUM(chargeflow_fee_cents) as total_fee_cents
  FROM chargebacks`;

function withWinRate(s: any) {
  const winRate = (s.won_count + s.lost_count) > 0
    ? (s.won_count / (s.won_count + s.lost_count)) * 100 : 0;
  return { ...s, win_rate: winRate };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  const db = getDb();

  if (storeId) {
    const chargebacks = db.prepare(
      'SELECT * FROM chargebacks WHERE store_id = ? ORDER BY chargeback_date DESC'
    ).all(storeId);
    const summary: any = db.prepare(`${SUMMARY_SQL} WHERE store_id = ?`).get(storeId);
    return NextResponse.json({ chargebacks, summary: withWinRate(summary) });
  }

  // All-stores mode (Chargebacks tab): rows joined with store name + shop domain
  // for Shopify-admin deep links, plus global and per-store summaries.
  const chargebacks = db.prepare(`
    SELECT c.*, s.name as store_name, sc.shop_domain
    FROM chargebacks c
    JOIN stores s ON s.id = c.store_id
    LEFT JOIN shopify_credentials sc ON sc.store_id = c.store_id
    ORDER BY c.chargeback_date DESC
  `).all();
  const summary: any = db.prepare(SUMMARY_SQL).get();
  const perStore: any[] = db.prepare(`
    SELECT store_id,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
      SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_count,
      SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_count,
      SUM(CASE WHEN status = 'open' THEN amount_cents ELSE 0 END) as open_cents,
      SUM(CASE WHEN status = 'lost' THEN amount_cents ELSE 0 END) as lost_cents
    FROM chargebacks GROUP BY store_id
  `).all().map(withWinRate);
  const storeNames = new Map(
    (db.prepare('SELECT id, name FROM stores').all() as any[]).map((s: any) => [s.id, s.name])
  );
  for (const p of perStore) (p as any).store_name = storeNames.get((p as any).store_id) || (p as any).store_id;

  return NextResponse.json({ chargebacks, summary: withWinRate(summary), perStore });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, orderNumber, chargebackDate, amountCents, reason, status, chargeflowFeeCents, notes, source } = body;

  if (!storeId || !chargebackDate || !amountCents) {
    return NextResponse.json({ error: 'storeId, chargebackDate, amountCents required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO chargebacks (id, store_id, order_number, chargeback_date, amount_cents, reason, status, chargeflow_fee_cents, notes, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, storeId, orderNumber || null, chargebackDate, amountCents,
    reason || null, status || 'open', chargeflowFeeCents || 0, notes || null, source || 'manual');

  rollUpChargebacks(db, storeId);

  return NextResponse.json({ success: true, id });
}

export async function PATCH(req: NextRequest) {
  const { id, status, notes, reason, amountCents, workflowStatus, responseNotes, evidenceDueBy, responseWorkflowId } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const existing: any = db.prepare('SELECT store_id FROM chargebacks WHERE id = ?').get(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sets: string[] = ['"updated_at" = datetime(\'now\')'];
  const vals: any[] = [];
  if (status !== undefined) { sets.push('"status" = ?'); vals.push(status); }
  if (notes !== undefined) { sets.push('"notes" = ?'); vals.push(notes); }
  if (reason !== undefined) { sets.push('"reason" = ?'); vals.push(reason); }
  if (amountCents !== undefined) { sets.push('"amount_cents" = ?'); vals.push(amountCents); }
  if (workflowStatus !== undefined) {
    sets.push('"workflow_status" = ?'); vals.push(workflowStatus);
    // First touch of the workflow stamps handled_at — "every chargeback handled instantly"
    if (workflowStatus !== 'new') sets.push('"handled_at" = COALESCE(handled_at, datetime(\'now\'))');
  }
  if (responseNotes !== undefined) { sets.push('"response_notes" = ?'); vals.push(responseNotes); }
  if (evidenceDueBy !== undefined) { sets.push('"evidence_due_by" = ?'); vals.push(evidenceDueBy); }
  if (responseWorkflowId !== undefined) {
    sets.push('"response_workflow_id" = ?'); vals.push(responseWorkflowId || null);
    // Tagging a response playbook counts as starting the response
    sets.push('"handled_at" = COALESCE(handled_at, datetime(\'now\'))');
  }

  vals.push(id);
  db.prepare(`UPDATE chargebacks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  rollUpChargebacks(db, existing.store_id);

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const existing: any = db.prepare('SELECT store_id FROM chargebacks WHERE id = ?').get(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  db.prepare('DELETE FROM chargebacks WHERE id = ?').run(id);
  rollUpChargebacks(db, existing.store_id);

  return NextResponse.json({ success: true });
}
