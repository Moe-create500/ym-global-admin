import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureWholesaleTable } from '@/lib/wholesale';
import { shopifyGet, shopifyMutate } from '@/lib/shopify-sync';

export const dynamic = 'force-dynamic';

const STORE_ID = '88491098-0BAC-4076-B226-DD97CDD2AD06';

// Wholesale unit price by total tubs (matches the portal pricing table)
function unitPriceCents(totalTubs: number): number {
  if (totalTubs >= 144) return 999;
  if (totalTubs >= 48) return 1249;
  return 1499;
}

// GET → all wholesale requests, newest first
export async function GET() {
  const db = getDb();
  ensureWholesaleTable(db);
  const rows: any[] = db.prepare('SELECT * FROM wholesale_requests ORDER BY created_at DESC LIMIT 100').all();
  return NextResponse.json({
    requests: rows.map(r => ({ ...r, items: JSON.parse(r.items_json || '[]') })),
  });
}

// POST {action:'set_status'|'set_shipping'|'create_draft_order', id, ...}
export async function POST(req: NextRequest) {
  const db = getDb();
  ensureWholesaleTable(db);
  const b = await req.json().catch(() => ({}));
  const r: any = b.id ? db.prepare('SELECT * FROM wholesale_requests WHERE id = ?').get(b.id) : null;
  if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  if (b.action === 'set_status') {
    if (!['new', 'quoted', 'invoiced', 'paid', 'fulfilled', 'cancelled'].includes(b.status)) {
      return NextResponse.json({ error: 'bad status' }, { status: 400 });
    }
    db.prepare("UPDATE wholesale_requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(b.status, b.id);
    return NextResponse.json({ success: true });
  }

  if (b.action === 'set_shipping') {
    // freight: the trucking quote; ups: label cost. Stored in cents.
    const cents = Math.max(Math.round(Number(b.shippingCents) || 0), 0);
    db.prepare("UPDATE wholesale_requests SET shipping_cents = ?, freight_quote_cents = ?, status = CASE WHEN status = 'new' THEN 'quoted' ELSE status END, updated_at = datetime('now') WHERE id = ?")
      .run(cents, r.delivery_method === 'freight' ? cents : r.freight_quote_cents, b.id);
    return NextResponse.json({ success: true });
  }

  if (b.action === 'create_draft_order') {
    if (r.draft_order_id) return NextResponse.json({ error: `Draft order already exists: ${r.draft_order_id}` }, { status: 400 });
    if (r.delivery_method !== 'pickup' && !(r.shipping_cents > 0)) {
      return NextResponse.json({ error: 'Set the shipping cost first (freight quote or UPS cost)' }, { status: 400 });
    }
    const items = JSON.parse(r.items_json || '[]');
    const unit = unitPriceCents(r.total_tubs);

    // resolve variant ids by product title match
    const now = Date.now();
    const products = (await shopifyGet(db, STORE_ID, 'products.json?limit=100&fields=id,title,variants&status=active', now))?.products || [];
    const lineItems: any[] = [];
    const missing: string[] = [];
    for (const it of items) {
      const p = products.find((x: any) => x.title.toLowerCase().includes(String(it.title).toLowerCase()));
      const variantId = p?.variants?.[0]?.id;
      if (!variantId) { missing.push(it.title); continue; }
      lineItems.push({
        variant_id: variantId, quantity: Number(it.qty),
        price: (unit / 100).toFixed(2), // wholesale unit price override
      });
    }
    if (!lineItems.length) return NextResponse.json({ error: `No products matched: ${missing.join(', ')}` }, { status: 400 });

    const shippingLine = r.delivery_method === 'pickup'
      ? { title: `Local Pickup — ${r.pickup_slot} (window 10AM–1PM)`, price: '0.00', custom: true }
      : r.delivery_method === 'freight'
        ? { title: 'LTL Freight (quoted)', price: (r.shipping_cents / 100).toFixed(2), custom: true }
        : { title: 'UPS Ground', price: (r.shipping_cents / 100).toFixed(2), custom: true };

    const draft = (await shopifyMutate(db, STORE_ID, 'POST', 'draft_orders.json', {
      draft_order: {
        email: r.email,
        line_items: lineItems,
        shipping_line: shippingLine,
        note: `WHOLESALE ${r.delivery_method.toUpperCase()}${r.pickup_slot ? ` · pickup ${r.pickup_slot}` : ''} · ${r.total_tubs} tubs @ $${(unit / 100).toFixed(2)} · req ${r.id}`,
        tags: 'wholesale',
        note_attributes: [
          { name: 'delivery_method', value: r.delivery_method },
          ...(r.pickup_slot ? [{ name: 'pickup_slot', value: r.pickup_slot }] : []),
          { name: 'business', value: r.business_name || '' },
        ],
        use_customer_default_address: false,
      },
    }, now))?.draft_order;
    if (!draft?.id) return NextResponse.json({ error: 'Draft order creation failed' }, { status: 502 });

    // send the invoice email
    await shopifyMutate(db, STORE_ID, 'POST', `draft_orders/${draft.id}/send_invoice.json`, { draft_order_invoice: { to: r.email } }, now).catch(() => {});
    db.prepare("UPDATE wholesale_requests SET draft_order_id = ?, status = 'invoiced', updated_at = datetime('now') WHERE id = ?").run(String(draft.id), r.id);
    return NextResponse.json({ success: true, draftOrderId: draft.id, missing });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
