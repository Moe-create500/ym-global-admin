import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();

  // Charges per card from invoices (exclude Chargeflow-via-Shopify since those are in Shopify bills)
  // Group by payment_method + card_last4 to get full card name like "Visa - 2976"
  const charges: any[] = db.prepare(`
    SELECT
      CASE WHEN card_last4 IS NOT NULL AND card_last4 != ''
        THEN payment_method || ' - ' || card_last4
        ELSE payment_method
      END as card,
      SUM(total_cents) as charged_cents, COUNT(*) as invoice_count
    FROM shopify_invoices
    WHERE store_id = ? AND payment_method IS NOT NULL AND payment_method != ''
      AND NOT (source = 'chargeflow' AND payment_method LIKE '%shopify%')
    GROUP BY card
    ORDER BY charged_cents DESC
  `).all(storeId);

  // Payments made to each card (app category only)
  const payments: any[] = db.prepare(`
    SELECT card_last4 as card, SUM(amount_cents) as paid_cents, COUNT(*) as payment_count
    FROM card_payments_log WHERE store_id = ? AND category = 'app'
    GROUP BY card_last4
    ORDER BY paid_cents DESC
  `).all(storeId);

  // Payment log (app category only)
  const log: any[] = db.prepare(`
    SELECT * FROM card_payments_log WHERE store_id = ? AND category = 'app' ORDER BY date DESC LIMIT 100
  `).all(storeId);

  // Build card summaries
  const cardMap = new Map<string, { charged: number; paid: number; invoices: number; payments: number }>();
  for (const c of charges) {
    cardMap.set(c.card, { charged: c.charged_cents, paid: 0, invoices: c.invoice_count, payments: 0 });
  }
  for (const p of payments) {
    // Match payment card_last4 to full card name (e.g. "2976" matches "Visa - 2976")
    let matched = false;
    const keys = Array.from(cardMap.keys());
    for (const key of keys) {
      if (key.endsWith(p.card)) {
        const data = cardMap.get(key)!;
        data.paid += p.paid_cents;
        data.payments += p.payment_count;
        matched = true;
        break;
      }
    }
    if (!matched) {
      cardMap.set(p.card, { charged: 0, paid: p.paid_cents, invoices: 0, payments: p.payment_count });
    }
  }

  const cards = Array.from(cardMap.entries()).map(([card, data]) => ({
    card,
    charged_cents: data.charged,
    paid_cents: data.paid,
    balance_cents: data.charged - data.paid,
    invoice_count: data.invoices,
    payment_count: data.payments,
  })).sort((a, b) => b.balance_cents - a.balance_cents);

  return NextResponse.json({ cards, log });
}

export async function POST(req: NextRequest) {
  const { storeId, card, date, amountCents, method, notes } = await req.json();
  if (!storeId || !card || !date || !amountCents) {
    return NextResponse.json({ error: 'storeId, card, date, amountCents required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO card_payments_log (id, store_id, card_last4, date, amount_cents, method, notes, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'app')
  `).run(id, storeId, card, date, amountCents, method || null, notes || null);

  return NextResponse.json({ success: true, id });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM card_payments_log WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
