import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { reattachItemAccounts } from '@/lib/plaid';

export const dynamic = 'force-dynamic';

// After an update-mode Plaid relink succeeds: wake the item up AND re-attach
// its accounts — relinks can rotate Plaid account ids or restore accounts the
// bank had dropped, and without re-attachment our rows keep listening on dead
// ids forever ("reconnected and nothing happened", 2026-08-19).
// Self-limiting: if the item is still hollow, NO_ACCOUNTS re-deactivates it.
export async function POST(req: NextRequest) {
  const { accountId } = await req.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  const db = getDb();
  const acct: any = db.prepare('SELECT teller_enrollment_id FROM bank_accounts WHERE id = ?').get(accountId);
  if (!acct?.teller_enrollment_id) return NextResponse.json({ error: 'account has no plaid item' }, { status: 404 });
  db.prepare("UPDATE plaid_items SET status = 'active', updated_at = datetime('now') WHERE item_id = ?")
    .run(acct.teller_enrollment_id);
  try {
    const r = await reattachItemAccounts(db, acct.teller_enrollment_id);
    return NextResponse.json({ success: true, reattached: r.reattached, accountsOnItem: r.total });
  } catch (e: any) {
    return NextResponse.json({ success: true, reattached: 0, warning: String(e?.message || e).slice(0, 160) });
  }
}
