import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createLinkToken, ensurePlaidSchema } from '@/lib/plaid';

export const dynamic = 'force-dynamic';

// POST { accountId? } → { link_token }
// With accountId: opens Plaid Link in UPDATE mode for that account's item
// (re-authenticate a broken connection in place, no re-picking accounts).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    let accessToken: string | undefined;
    if (body.accountId) {
      const db = getDb();
      ensurePlaidSchema(db);
      const row: any = db.prepare("SELECT access_token, provider FROM bank_accounts WHERE id = ?").get(body.accountId);
      if (row?.provider === 'plaid' && row.access_token) accessToken = row.access_token;
      // Non-plaid rows fall through to a fresh connect — the exchange
      // re-attaches them by institution + last_four
    }
    const link_token = await createLinkToken({ accessToken });
    return NextResponse.json({ link_token, mode: accessToken ? 'update' : 'new' });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 250) }, { status: 500 });
  }
}
