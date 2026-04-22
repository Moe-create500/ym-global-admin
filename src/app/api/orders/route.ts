import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  const { orderId, printed } = await req.json();
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });
  const db = getDb();
  db.prepare('UPDATE orders SET printed = ? WHERE id = ?').run(printed ? 1 : 0, orderId);
  return NextResponse.json({ success: true });
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const source = searchParams.get('source') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const missingCharge = searchParams.get('missingCharge') || '';

  if (!storeId) {
    return NextResponse.json({ error: 'storeId is required' }, { status: 400 });
  }

  const db = getDb();

  let where = 'WHERE o.store_id = ?';
  const params: any[] = [storeId];

  if (search) {
    where += ' AND (o.order_number LIKE ? OR o.order_name LIKE ? OR o.customer_email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  if (status) {
    where += ' AND o.financial_status = ?';
    params.push(status);
  }

  if (source) {
    where += ' AND o.source = ?';
    params.push(source);
  }

  if (from) {
    where += ' AND o.order_date >= ?';
    params.push(from);
  }

  if (to) {
    where += ' AND o.order_date <= ?';
    params.push(to);
  }

  if (missingCharge === '1') {
    where += " AND (o.ss_charge_cents = 0 OR o.ss_charge_cents IS NULL) AND (o.source = 'csv_import' OR o.source IS NULL)";
  }

  // Count
  const countRow: any = db.prepare(`SELECT COUNT(*) as total FROM orders o ${where}`).get(...params);
  const total = countRow?.total || 0;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;

  // Orders
  const orders = db.prepare(`
    SELECT o.* FROM orders o ${where}
    ORDER BY o.order_date DESC, o.order_number DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Summary for current filter
  const summary: any = db.prepare(`
    SELECT
      SUM(o.total_cents) as total_revenue,
      COUNT(*) as total_orders,
      SUM(o.refunded_cents) as total_refunded,
      SUM(o.ss_charge_cents) as total_charges
    FROM orders o ${where}
  `).get(...params);

  return NextResponse.json({
    orders,
    total,
    page,
    totalPages,
    summary: {
      totalRevenue: summary?.total_revenue || 0,
      totalOrders: summary?.total_orders || 0,
      totalRefunded: summary?.total_refunded || 0,
      totalCharges: summary?.total_charges || 0,
    },
  });
}
