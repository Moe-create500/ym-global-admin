import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccounts, getAccountBalance, getAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';
import { dropBrainCache } from '@/lib/brain-cache';
import { deriveConnectionState, evidenceFromPlaidItem, ensureConnectionSchema } from '@/lib/connection-state';
import { findCanonicalMatch, ensureIdentitySchema } from '@/lib/account-identity';

export const dynamic = 'force-dynamic';

// GET: accounts with evidence-derived connection state + coverage-aware totals.
// ?detail=<accountId> returns the drawer payload (evidence explain + sync history).
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const detailId = req.nextUrl.searchParams.get('detail');
  const db = getDb();
  ensureConnectionSchema(db);

  const items = new Map<string, any>(
    (db.prepare('SELECT * FROM plaid_items').all() as any[]).map((i: any) => [i.item_id, i])
  );

  const FRESH_MS = 36 * 3_600_000;
  const decorate = (a: any) => {
    const item = a.provider === 'plaid' ? items.get(a.teller_enrollment_id) : null;
    const connection = item
      ? deriveConnectionState(evidenceFromPlaidItem(item))
      : deriveConnectionState({
          provider: a.provider || null,
          itemStatus: a.status === 'disconnected' ? 'disconnected' : 'active',
          // Teller rows have no structured provider codes — balance heartbeat is
          // the only sync evidence we hold, so state honestly degrades to STALE.
          lastSyncSuccessAt: a.balance_updated_at,
          lastSyncStatus: a.balance_updated_at ? 'success' : null,
        });
    const balTs = a.balance_updated_at ? Date.parse(a.balance_updated_at.replace(' ', 'T') + (a.balance_updated_at.includes('Z') ? '' : 'Z')) : NaN;
    const balanceFresh = !Number.isNaN(balTs) && Date.now() - balTs <= FRESH_MS;
    const verified = balanceFresh && ['HEALTHY', 'SYNCING', 'DEGRADED', 'PENDING_DISCONNECT'].includes(connection.status);
    const { access_token: _t, ...safe } = a; // never ship tokens to the frontend
    return {
      ...safe,
      item_id: item?.item_id || null,
      connection,
      balance_verified: verified,
      freshness: {
        balance_verified_at: a.balance_updated_at || null,
        transactions_through: a.bank_data_as_of || null,
        transactions_checked_at: a.last_txn_success_at || null,
      },
    };
  };

  if (detailId) {
    const a: any = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(detailId);
    if (!a) return NextResponse.json({ error: 'account not found' }, { status: 404 });
    const item = a.provider === 'plaid' ? items.get(a.teller_enrollment_id) : null;
    const runs = item
      ? db.prepare('SELECT started_at, finished_at, status, balance_result, transaction_result, records_added, records_removed, error_code FROM sync_runs WHERE item_id = ? ORDER BY started_at DESC LIMIT 12').all(item.item_id)
      : [];
    const txnCount: any = db.prepare('SELECT COUNT(*) n, MIN(date) first, MAX(date) last FROM bank_transactions WHERE bank_account_id = ?').get(detailId);
    ensureIdentitySchema(db);
    const connections = db.prepare('SELECT provider, provider_item_id, provider_account_id, connected_at, disconnected_at, status, note FROM account_connections WHERE account_id = ? ORDER BY connected_at DESC').all(detailId);
    const siblings = item
      ? (db.prepare('SELECT id, account_name, nickname, last_four FROM bank_accounts WHERE teller_enrollment_id = ? AND id != ?').all(item.item_id, detailId) as any[])
      : [];
    return NextResponse.json({
      account: decorate(a),
      item: item ? {
        item_id: item.item_id, institution_name: item.institution_name, status: item.status,
        provider_error_code: item.provider_error_code, provider_error_message: item.provider_error_message,
        error_detected_at: item.error_detected_at, pending_disconnect_at: item.pending_disconnect_at,
        institution_health: item.institution_health || 'UNKNOWN',
        last_sync_attempt_at: item.last_sync_attempt_at, last_sync_success_at: item.last_sync_success_at,
        last_sync_status: item.last_sync_status,
      } : null,
      sync_runs: runs,
      transactions: txnCount,
      siblings,
      connections,
    });
  }

  let where = "WHERE status IN ('active','disconnected') AND account_type != 'credit' AND (archived IS NULL OR archived = 0)";
  const params: any[] = [];
  if (storeId) { where += ' AND store_id = ? AND (is_global IS NULL OR is_global = 0)'; params.push(storeId); }

  const accounts = (db.prepare(`SELECT * FROM bank_accounts ${where} ORDER BY institution_name, account_name`).all(...params) as any[]).map(decorate);

  // Coverage-aware totals: verified cash (fresh, provably-connected balances)
  // is reported SEPARATELY from last-known cash. Never blended into one number.
  let verifiedCents = 0, lastKnownCents = 0, verifiedCount = 0;
  for (const a of accounts) {
    if (a.balance_verified) { verifiedCents += a.balance_available_cents || 0; verifiedCount++; }
    else lastKnownCents += a.balance_available_cents || 0;
  }
  const attention = accounts.filter(a => a.connection.requiresUserAction);
  const unknown = accounts.filter(a => a.connection.status === 'UNKNOWN' || a.connection.status === 'STALE');

  // Group accounts needing user action by their provider item — one login
  // repair fixes every account underneath it, so we surface ONE issue per item.
  const itemGroups: any[] = [];
  const seen = new Set<string>();
  for (const a of attention) {
    const key = a.item_id || a.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const affected = a.item_id ? accounts.filter(x => x.item_id === a.item_id) : [a];
    itemGroups.push({
      item_id: a.item_id, institution_name: a.institution_name,
      connection: a.connection, affected_count: affected.length,
      accounts: affected.map(x => ({ id: x.id, name: x.nickname || x.account_name, last_four: x.last_four })),
    });
  }

  const unassigned = db.prepare("SELECT id, institution_name, account_name, last_four, balance_available_cents FROM bank_accounts WHERE status = 'unassigned' ORDER BY last_four").all();

  return NextResponse.json({
    accounts,
    unassigned,
    repair_groups: itemGroups,
    summary: {
      account_count: accounts.length,
      verified_cents: verifiedCents,
      last_known_cents: lastKnownCents,
      verified_accounts: verifiedCount,
      attention_count: attention.length,
      unknown_count: unknown.length,
      unassigned_count: (unassigned as any[]).length,
    },
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
      // Canonical identity guard — name-aware layered matching so re-enrolling
      // under a new provider app lands on the existing canonical row (history!)
      // and twin masks are never guessed.
      const { match: existing } = findCanonicalMatch(db, {
        institution: account.institution?.name || 'Unknown', mask: account.last_four,
        type: account.type, name: account.name, providerAccountId: account.id,
      });
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
