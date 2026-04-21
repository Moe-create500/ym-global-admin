import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const includeGaps = req.nextUrl.searchParams.get('gaps') === '1';
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  const rules = db.prepare(
    'SELECT * FROM sku_pricing WHERE store_id = ? ORDER BY sku, effective_from DESC'
  ).all(storeId);

  let gaps: { sku: string; product_name: string; min_date: string; max_date: string; order_count: number }[] = [];

  if (includeGaps) {
    // Get all distinct SKUs and their date ranges from orders
    const orders: any[] = db.prepare(
      "SELECT order_date, line_items FROM orders WHERE store_id = ? AND line_items IS NOT NULL AND financial_status != 'voided'"
    ).all(storeId);

    // Build a map of SKU -> set of order dates + product name
    const skuDates: Record<string, Set<string>> = {};
    const skuNames: Record<string, string> = {};
    for (const order of orders) {
      try {
        const items = JSON.parse(order.line_items);
        for (const item of items) {
          const key = item.sku || item.name;
          if (!key) continue;
          if (!skuDates[key]) skuDates[key] = new Set();
          skuDates[key].add(order.order_date);
          // Store the product name (prefer item.name over sku)
          if (item.name && !skuNames[key]) skuNames[key] = item.name;
        }
      } catch {}
    }

    // For each SKU, find dates NOT covered by any pricing rule
    const typedRules = rules as any[];
    for (const [sku, dates] of Object.entries(skuDates)) {
      const uncoveredDates: string[] = [];
      for (const date of dates) {
        const covered = typedRules.some((r: any) => {
          const skuMatch = r.sku === sku || r.sku.toLowerCase() === sku.toLowerCase() ||
            sku.toLowerCase().includes(r.sku.toLowerCase()) || r.sku.toLowerCase().includes(sku.toLowerCase());
          if (!skuMatch) return false;
          if (date < r.effective_from) return false;
          if (r.effective_to && date > r.effective_to) return false;
          return true;
        });
        if (!covered) uncoveredDates.push(date);
      }
      if (uncoveredDates.length > 0) {
        uncoveredDates.sort();
        gaps.push({
          sku,
          product_name: skuNames[sku] || '',
          min_date: uncoveredDates[0],
          max_date: uncoveredDates[uncoveredDates.length - 1],
          order_count: uncoveredDates.length,
        });
      }
    }
    // Sort by order count descending
    gaps.sort((a, b) => b.order_count - a.order_count);
  }

  return NextResponse.json({ rules, ...(includeGaps ? { gaps } : {}) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, id, sku, label, baseChargeCents, extraUnitChargeCents, extraUnitAfter, effectiveFrom, effectiveTo, channel } = body;

  if (!storeId || !sku || !effectiveFrom) {
    return NextResponse.json({ error: 'storeId, sku, effectiveFrom required' }, { status: 400 });
  }

  const db = getDb();

  if (id) {
    db.prepare(`
      UPDATE sku_pricing SET sku = ?, label = ?, base_charge_cents = ?, extra_unit_charge_cents = ?,
        extra_unit_after = ?, effective_from = ?, effective_to = ?, channel = ?, updated_at = datetime('now')
      WHERE id = ? AND store_id = ?
    `).run(sku, label || '', baseChargeCents || 0, extraUnitChargeCents || 0,
      extraUnitAfter || 1, effectiveFrom, effectiveTo || null, channel || 'us', id, storeId);
    return NextResponse.json({ success: true, id });
  }

  const newId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO sku_pricing (id, store_id, sku, label, base_charge_cents, extra_unit_charge_cents,
      extra_unit_after, effective_from, effective_to, channel)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId, storeId, sku, label || '', baseChargeCents || 0, extraUnitChargeCents || 0,
    extraUnitAfter || 1, effectiveFrom, effectiveTo || null, channel || 'us');

  return NextResponse.json({ success: true, id: newId });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM sku_pricing WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
