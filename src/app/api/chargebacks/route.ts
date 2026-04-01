import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function rollUpChargebacks(db: any, storeId: string) {
  // Sum lost chargebacks by date into daily_pnl
  const days: any[] = db.prepare(`
    SELECT chargeback_date as date, SUM(amount_cents) as total
    FROM chargebacks WHERE store_id = ? AND status = 'lost'
    GROUP BY chargeback_date
  `).all(storeId);

  // Reset all chargeback_cents first
  db.prepare('UPDATE daily_pnl SET chargeback_cents = 0 WHERE store_id = ?').run(storeId);

  for (const day of days) {
    const pnl: any = db.prepare(
      'SELECT id, revenue_cents, ad_spend_cents, shipping_cost_cents, shopify_fees_cents, pick_pack_cents, packaging_cents, other_costs_cents, app_costs_cents FROM daily_pnl WHERE store_id = ? AND date = ?'
    ).get(storeId, day.date);
    if (pnl) {
      const shopifyFee = Math.round((pnl.revenue_cents || 0) * 0.025);
      const totalCosts = (pnl.shipping_cost_cents || 0) + (pnl.pick_pack_cents || 0) +
        (pnl.packaging_cents || 0) + (pnl.ad_spend_cents || 0) +
        shopifyFee + (pnl.other_costs_cents || 0) + (pnl.app_costs_cents || 0) + day.total;
      const netProfit = (pnl.revenue_cents || 0) - totalCosts;
      const margin = pnl.revenue_cents > 0 ? (netProfit / pnl.revenue_cents) * 100 : 0;
      db.prepare(`
        UPDATE daily_pnl SET chargeback_cents = ?, shopify_fees_cents = ?, net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(day.total, shopifyFee, netProfit, margin, pnl.id);
    }
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();

  const chargebacks = db.prepare(
    'SELECT * FROM chargebacks WHERE store_id = ? ORDER BY chargeback_date DESC'
  ).all(storeId);

  const summary: any = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
      SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_count,
      SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_count,
      SUM(amount_cents) as total_cents,
      SUM(CASE WHEN status = 'lost' THEN amount_cents ELSE 0 END) as lost_cents,
      SUM(CASE WHEN status = 'won' THEN amount_cents ELSE 0 END) as won_cents,
      SUM(chargeflow_fee_cents) as total_fee_cents
    FROM chargebacks WHERE store_id = ?
  `).get(storeId);

  const winRate = (summary.won_count + summary.lost_count) > 0
    ? (summary.won_count / (summary.won_count + summary.lost_count)) * 100 : 0;

  return NextResponse.json({
    chargebacks,
    summary: { ...summary, win_rate: winRate },
  });
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
  const { id, status, notes, reason, amountCents } = await req.json();
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
