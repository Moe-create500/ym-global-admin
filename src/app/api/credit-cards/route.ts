import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();

  // Get all credit card accounts from Teller-connected bank accounts
  const cards: any[] = db.prepare(`
    SELECT id, store_id, institution_name, account_name, account_subtype,
      last_four, currency, balance_available_cents, balance_ledger_cents,
      balance_updated_at, status, teller_account_id
    FROM bank_accounts
    WHERE account_type = 'credit' AND status = 'active'
    ORDER BY institution_name, account_name
  `).all();

  // Get store names for any assigned cards
  const stores: any[] = db.prepare('SELECT id, name FROM stores').all();
  const storeMap: Record<string, string> = {};
  for (const s of stores) storeMap[s.id] = s.name;

  // Totals
  const totalAvailable = cards.reduce((s, c) => s + (c.balance_available_cents || 0), 0);
  const totalLedger = cards.reduce((s, c) => s + (c.balance_ledger_cents || 0), 0);

  const result = cards.map(c => ({
    ...c,
    store_name: storeMap[c.store_id] || null,
  }));

  return NextResponse.json({
    cards: result,
    summary: {
      total_available_cents: totalAvailable,
      total_ledger_cents: totalLedger,
      card_count: cards.length,
    },
  });
}
