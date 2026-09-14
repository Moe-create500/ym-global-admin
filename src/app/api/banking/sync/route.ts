import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { syncPlaidItems } from '@/lib/plaid';

export const dynamic = 'force-dynamic';

// POST: sync balances + transactions for every connected bank/card.
// Plaid syncs per connection (item), so ?accountId is accepted for
// compatibility but the whole item the account belongs to is refreshed.
// Teller retired 2026-09-14.
export async function POST(_req: NextRequest) {
  const db = getDb();
  const errors: string[] = [];
  let accounts = 0, txns = 0;
  try {
    const r = await syncPlaidItems(db);
    accounts = r.accounts_synced; txns = r.transactions_imported; errors.push(...r.errors);
  } catch (e: any) {
    errors.push(`plaid sync: ${String(e?.message || e).slice(0, 150)}`);
  }
  return NextResponse.json({
    success: true,
    accounts_synced: accounts,
    transactions_imported: txns,
    errors: errors.length > 0 ? errors : undefined,
  });
}
