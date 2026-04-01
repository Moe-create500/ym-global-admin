import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();

  const cards = db.prepare(`
    SELECT pc.*,
      (SELECT COUNT(*) FROM card_assignments ca WHERE ca.card_id = pc.id) as assignment_count,
      (SELECT SUM(ca.monthly_cost_cents) FROM card_assignments ca WHERE ca.card_id = pc.id) as total_monthly_cents
    FROM payment_cards pc
    ORDER BY pc.card_name
  `).all();

  const assignments = db.prepare(`
    SELECT ca.*, pc.card_name, pc.last_four, pc.card_type, s.name as store_name
    FROM card_assignments ca
    JOIN payment_cards pc ON pc.id = ca.card_id
    LEFT JOIN stores s ON s.id = ca.store_id
    ORDER BY pc.card_name, s.name
  `).all();

  return NextResponse.json({ cards, assignments });
}
