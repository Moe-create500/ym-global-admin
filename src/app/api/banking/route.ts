import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccounts, getAccountBalance, getAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';
import { dropBrainCache } from '@/lib/brain-cache';

export const dynamic = 'force-dynamic';

// GET: List all bank accounts + balances
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const db = getDb();

  let where = "WHERE status = ? AND account_type != 'credit'";
  const params: any[] = ['active'];
  if (storeId) { where += ' AND store_id = ? AND (is_global IS NULL OR is_global = 0)'; params.push(storeId); }
  // When no storeId filter, show everything including global accounts

  const accounts = db.prepare(`SELECT * FROM bank_accounts ${where} ORDER BY institution_name, account_name`).all(...params);

  // Summary
  const totalAvailable = (accounts as any[]).reduce((s, a) => s + (a.balance_available_cents || 0), 0);
  const totalLedger = (accounts as any[]).reduce((s, a) => s + (a.balance_ledger_cents || 0), 0);

  // Accounts parked until their store is known (bulk Shopify Balance
  // enrollments) — shown in their own section, counted nowhere
  const unassigned = db.prepare("SELECT * FROM bank_accounts WHERE status = 'unassigned' ORDER BY last_four").all();

  return NextResponse.json({
    accounts,
    unassigned,
    summary: { total_available_cents: totalAvailable, total_ledger_cents: totalLedger, account_count: accounts.length },
  });
}

// POST: Enroll a bank account (called after Teller Connect)
export async function POST(req: NextRequest) {
  dropBrainCache(); // financial write — cached answers must not outlive it
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
      // Match by teller_account_id first; fall back to institution + last_four
      // + type — account ids are application-scoped in Teller, so re-enrolling
      // under a NEW Teller app must still land on the existing rows (history!)
      const existing: any = db.prepare('SELECT id FROM bank_accounts WHERE teller_account_id = ?').get(account.id)
        || db.prepare(`SELECT id FROM bank_accounts WHERE last_four = ? AND account_type = ? AND institution_name = ? ORDER BY updated_at DESC LIMIT 1`)
          .get(account.last_four, account.type, account.institution?.name || 'Unknown');
      if (existing) {
        // Reconnect: refresh token + enrollment + account id on the existing row
        db.prepare(`
          UPDATE bank_accounts SET access_token = ?, teller_enrollment_id = ?, teller_account_id = ?, status = 'active', updated_at = datetime('now')
          WHERE id = ?
        `).run(accessToken, enrollmentId || account.enrollment_id, account.id, existing.id);
        imported++;
        continue;
      }

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
// PATCH { accountId, storeId } → reassign an account to another store
export async function PATCH(req: NextRequest) {
  dropBrainCache(); // financial write — cached answers must not outlive it
  const { accountId, storeId } = await req.json().catch(() => ({}));
  if (!accountId || !storeId) return NextResponse.json({ error: 'accountId and storeId required' }, { status: 400 });
  const db = getDb();
  const store: any = db.prepare('SELECT name FROM stores WHERE id = ?').get(storeId);
  if (!store) return NextResponse.json({ error: 'store not found' }, { status: 404 });
  const acct: any = db.prepare('SELECT institution_name, account_name FROM bank_accounts WHERE id = ?').get(accountId);
  if (!acct) return NextResponse.json({ error: 'account not found' }, { status: 404 });
  // Rename generically-named Shopify Balance rows on assignment — the custom
  // name also marks them as manually assigned (auto-matcher skips them)
  const newName = /shopify/i.test(acct.institution_name || '') && acct.account_name === 'Shopify Balance'
    ? `${String(store.name).toUpperCase()} Shopify Balance`
    : acct.account_name;
  // Manual assignment also activates parked (unassigned) accounts
  db.prepare("UPDATE bank_accounts SET store_id = ?, account_name = ?, status = 'active', updated_at = datetime('now') WHERE id = ?")
    .run(storeId, newName, accountId);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  dropBrainCache(); // financial write — cached answers must not outlive it
  const accountId = req.nextUrl.searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });

  const db = getDb();
  db.prepare("UPDATE bank_accounts SET status = 'disconnected', updated_at = datetime('now') WHERE id = ?").run(accountId);
  return NextResponse.json({ success: true });
}
