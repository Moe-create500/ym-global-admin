import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';
import { ensureWholesaleTable } from '@/lib/wholesale';

export const dynamic = 'force-dynamic';

// Public endpoint — the SupplyLaundry storefront wholesale form posts here.
// CORS-open for the storefront domains; honeypot field rejects naive bots.

const ALLOWED_ORIGINS = ['https://supplylaundry.com', 'https://www.supplylaundry.com', 'https://ib1s7g-ws.myshopify.com'];

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
  const headers = cors(req.headers.get('origin'));
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: 'JSON expected' }, { status: 400, headers });
  if (b.website) return NextResponse.json({ success: true }, { headers }); // honeypot

  const email = String(b.email || '').trim();
  const items = Array.isArray(b.items) ? b.items.filter((i: any) => i?.title && Number(i.qty) > 0).slice(0, 30) : [];
  const totalTubs = items.reduce((s: number, i: any) => s + Number(i.qty), 0);
  const method = ['ups', 'freight', 'pickup'].includes(b.deliveryMethod) ? b.deliveryMethod : null;

  if (!email.includes('@') || !items.length || !method) {
    return NextResponse.json({ error: 'email, items and delivery method are required' }, { status: 400, headers });
  }
  if (totalTubs < 12) return NextResponse.json({ error: 'Wholesale starts at 12 tubs' }, { status: 400, headers });
  // Size rules: pallet quantities can't ship parcel
  if (method === 'ups' && totalTubs >= 48) {
    return NextResponse.json({ error: 'Orders of 48+ tubs ship by freight or pickup — please choose one of those' }, { status: 400, headers });
  }
  // Pickup slots: business days, 10:00–13:00 only
  let pickupSlot: string | null = null;
  if (method === 'pickup') {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(String(b.pickupSlot || ''));
    if (!m) return NextResponse.json({ error: 'Pickup requires a date and time slot' }, { status: 400, headers });
    const hour = Number(m[2]);
    const day = new Date(`${m[1]}T12:00:00`).getDay();
    if (hour < 10 || hour >= 13) return NextResponse.json({ error: 'Pickup slots are 10:00 AM – 1:00 PM' }, { status: 400, headers });
    if (day === 0 || day === 6) return NextResponse.json({ error: 'Pickup is available on business days only' }, { status: 400, headers });
    pickupSlot = `${m[1]} ${m[2]}:${m[3]}`;
  }

  const db = getDb();
  ensureWholesaleTable(db);

  // basic rate limit: max 5 requests per email per day
  const recent: any = db.prepare(
    "SELECT COUNT(*) AS n FROM wholesale_requests WHERE email = ? AND created_at > datetime('now', '-1 day')"
  ).get(email);
  if (recent?.n >= 5) return NextResponse.json({ error: 'Too many requests — we already have your submissions' }, { status: 429, headers });

  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO wholesale_requests (id, store_id, business_name, contact_name, email, phone, items_json, total_tubs, delivery_method, pickup_slot, address, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, '88491098-0BAC-4076-B226-DD97CDD2AD06',
      String(b.businessName || '').slice(0, 120), String(b.contactName || '').slice(0, 120),
      email.slice(0, 200), String(b.phone || '').slice(0, 40),
      JSON.stringify(items), totalTubs, method, pickupSlot,
      String(b.address || '').slice(0, 400), String(b.notes || '').slice(0, 1000));

  console.log(`[wholesale] new request ${id}: ${totalTubs} tubs via ${method} from ${email}`);
  return NextResponse.json({
    success: true,
    message: method === 'freight'
      ? 'Request received — we will send your trucking quote and invoice within 24 hours.'
      : method === 'pickup'
        ? `Request received — we will confirm your pickup for ${pickupSlot} and send your invoice.`
        : 'Request received — we will send your invoice with UPS shipping within 24 hours.',
  }, { headers });
}
