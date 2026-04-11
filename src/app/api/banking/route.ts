import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccounts, getAccountBalance, getAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// GET: List all bank accounts + balances
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const db = getDb();

  let where = "WHERE status = ? AND account_type != 'credit'";
  const params: any[] = ['active'];
  if (storeId) { where += ' AND store_id = ?'; params.push(storeId); }

  const accounts = db.prepare(`SELECT * FROM bank_accounts ${where} ORDER BY institution_name, account_name`).all(...params);

  // Summary
  const totalAvailable = (accounts as any[]).reduce((s, a) => s + (a.balance_available_cents || 0), 0);
  const totalLedger = (accounts as any[]).reduce((s, a) => s + (a.balance_ledger_cents || 0), 0);

  return NextResponse.json({
    accounts,
    summary: { total_available_cents: totalAvailable, total_ledger_cents: totalLedger, account_count: accounts.length },
  });
}

// POST: Enroll a bank account (called after Teller Connect)
export async function POST(req: NextRequest) {
  const { storeId, accessToken, enrollmentId } = await req.json();

  if (!storeId || !accessToken) {
    return NextResponse.json({ error: 'storeId and accessToken required' }, { status: 400 });
  }

  const db = getDb();
  let imported = 0;

  try {
    console.log('[banking] Fetching accounts with token:', accessToken.substring(0, 10) + '...');
    const accounts = await getAccounts(accessToken);
    console.log('[banking] Got accounts:', accounts.length);

    for (const account of accounts) {
      const existing = db.prepare('SELECT id FROM bank_accounts WHERE teller_account_id = ?').get(account.id);
      if (existing) continue;

      // Get balance
      let balanceAvailable = 0;
      let balanceLedger = 0;
      try {
        const balance = await getAccountBalance(accessToken, account.id);
        balanceAvailable = Math.round(parseFloat(balance.available || '0') * 100);
        balanceLedger = Math.round(parseFloat(balance.ledger || '0') * 100);
      } catch {}

      db.prepare(`
        INSERT INTO bank_accounts (id, store_id, teller_enrollment_id, teller_account_id, access_token,
          institution_name, account_name, account_type, account_subtype, last_four, currency,
          balance_available_cents, balance_ledger_cents, balance_updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        crypto.randomUUID(), storeId, enrollmentId || account.enrollment_id, account.id, accessToken,
        account.institution?.name || 'Unknown', account.name, account.type, account.subtype,
        account.last_four, account.currency || 'USD', balanceAvailable, balanceLedger
      );
      imported++;
    }

    return NextResponse.json({ success: true, imported });
  } catch (err: any) {
    console.error('[banking] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: Disconnect a bank account
export async function DELETE(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });

  const db = getDb();
  db.prepare("UPDATE bank_accounts SET status = 'disconnected', updated_at = datetime('now') WHERE id = ?").run(accountId);
  return NextResponse.json({ success: true });
}
