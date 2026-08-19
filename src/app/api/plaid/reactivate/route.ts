import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// After an update-mode Plaid relink succeeds, the item may still be marked
// inactive from its husk days — wake it up so the next sync probes it again.
// Self-limiting: if the item is still hollow, NO_ACCOUNTS re-deactivates it.
export async function POST(req: NextRequest) {
  const { accountId } = await req.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  const db = getDb();
  const acct: any = db.prepare('SELECT teller_enrollment_id FROM bank_accounts WHERE id = ?').get(accountId);
  if (!acct?.teller_enrollment_id) return NextResponse.json({ error: 'account has no plaid item' }, { status: 404 });
  const r = db.prepare("UPDATE plaid_items SET status = 'active', updated_at = datetime('now') WHERE item_id = ?")
    .run(acct.teller_enrollment_id);
  return NextResponse.json({ success: true, reactivated: r.changes > 0 });
}
