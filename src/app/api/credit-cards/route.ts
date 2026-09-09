import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccounts, getAccountBalance, getAllAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';
import { deriveConnectionState, evidenceFromPlaidItem, ensureConnectionSchema } from '@/lib/connection-state';
import { findCanonicalMatch, ensureIdentitySchema } from '@/lib/account-identity';

export const dynamic = 'force-dynamic';

// GET: List all credit card accounts OR transactions for a specific card
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId');
  const db = getDb();

  if (accountId) {
    const transactions: any[] = db.prepare(`
      SELECT bt.*, bt.custom_category, bt.custom_note
      FROM bank_transactions bt
      WHERE bt.bank_account_id = ?
      ORDER BY bt.date DESC, bt.id DESC
    `).all(accountId);

    const inflow = transactions.filter(t => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
    const outflow = transactions.filter(t => t.amount_cents < 0).reduce((s, t) => s + t.amount_cents, 0);

    const catMap: Record<string, { inflow_cents: number; outflow_cents: number; count: number }> = {};
    for (const t of transactions) {
      const cat = t.custom_category || t.category || 'Uncategorized';
      if (!catMap[cat]) catMap[cat] = { inflow_cents: 0, outflow_cents: 0, count: 0 };
      if (t.amount_cents > 0) catMap[cat].inflow_cents += t.amount_cents;
      else catMap[cat].outflow_cents += Math.abs(t.amount_cents);
      catMap[cat].count++;
    }
    const categoryBreakdown = Object.entries(catMap).map(([category, data]) => ({ category, ...data }));

    return NextResponse.json({
      transactions,
      summary: { inflow_cents: inflow, outflow_cents: outflow, total_count: transactions.length },
      categoryBreakdown,
    });
  }

  ensureConnectionSchema(db);
  ensureIdentitySchema(db);
  const items = new Map<string, any>(
    (db.prepare('SELECT * FROM plaid_items').all() as any[]).map((i: any) => [i.item_id, i])
  );
  const FRESH_MS = 36 * 3_600_000;
  const rawCards: any[] = db.prepare(`
    SELECT * FROM bank_accounts
    WHERE account_type = 'credit' AND status = 'active'
    ORDER BY institution_name, account_name
  `).all();

  // Same evidence-derived connection model as Banking: status from provider
  // signals only, freshness descriptive, last-known balances preserved.
  const cards = rawCards.map((a: any) => {
    const item = a.provider === 'plaid' ? items.get(a.teller_enrollment_id) : null;
    const connection = item
      ? deriveConnectionState(evidenceFromPlaidItem(item))
      : deriveConnectionState({
          provider: a.provider || null,
          itemStatus: a.status === 'disconnected' ? 'disconnected' : 'active',
          lastSyncSuccessAt: a.balance_updated_at,
          lastSyncStatus: a.balance_updated_at ? 'success' : null,
        });
    const balTs = a.balance_updated_at ? Date.parse(a.balance_updated_at.replace(' ', 'T') + (a.balance_updated_at.includes('Z') ? '' : 'Z')) : NaN;
    const verified = !Number.isNaN(balTs) && Date.now() - balTs <= FRESH_MS
      && ['HEALTHY', 'SYNCING', 'DEGRADED', 'PENDING_DISCONNECT'].includes(connection.status);
    const { access_token: _t, ...safe } = a;
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
  });

  // REAL available: credit LINES only — a child card's "available" is its
  // allocation ceiling, spendable is capped by its parent line. Cards with no
  // parent line (standalone, e.g. Amex) count their own availability.
  const isLine = (c: any) => /^CORP Account/i.test(c.account_name || '');
  const fam = (c: any) => String(c.account_name || '').replace(/^CORP Account - /i, '').replace(/ LINE$/i, '').slice(0, 14).toLowerCase();
  const parents = cards.filter(isLine);
  const totalAvailable = cards.reduce((s: number, c: any) => {
    if (isLine(c)) return s + (c.balance_available_cents || 0);
    return parents.some((p: any) => fam(p) === fam(c)) ? s : s + (c.balance_available_cents || 0);
  }, 0);

  // Coverage-aware owed totals: verified debt vs last-known debt, never blended
  let verifiedOwed = 0, lastKnownOwed = 0, verifiedCount = 0;
  for (const c of cards) {
    if (c.balance_verified) { verifiedOwed += c.balance_ledger_cents || 0; verifiedCount++; }
    else lastKnownOwed += c.balance_ledger_cents || 0;
  }
  const attention = cards.filter((c: any) => c.connection.requiresUserAction);
  const groups: any[] = [];
  const seen = new Set<string>();
  for (const c of attention) {
    const key = c.item_id || c.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const affected = c.item_id ? cards.filter((x: any) => x.item_id === c.item_id) : [c];
    groups.push({
      item_id: c.item_id, institution_name: c.institution_name,
      connection: c.connection, affected_count: affected.length,
      accounts: affected.map((x: any) => ({ id: x.id, name: x.nickname || x.account_name, last_four: x.last_four })),
    });
  }

  return NextResponse.json({
    cards,
    repair_groups: groups,
    summary: {
      total_available_cents: totalAvailable,
      verified_owed_cents: verifiedOwed,
      last_known_owed_cents: lastKnownOwed,
      verified_cards: verifiedCount,
      card_count: cards.length,
      attention_count: attention.length,
    },
  });
}

// POST: Sync balances + ALL transactions for credit card accounts
export async function POST() {
  const db = getDb();

  const accounts: any[] = db.prepare(
    "SELECT * FROM bank_accounts WHERE account_type = 'credit' AND status = 'active' AND COALESCE(provider,'teller') = 'teller'"
  ).all();

  let totalTxns = 0;
  const errors: string[] = [];

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  for (let ai = 0; ai < accounts.length; ai++) {
    const account = accounts[ai];
    if (ai > 0) await sleep(3000); // pace between accounts
    try {
      // Sync balance — persist failures so a dead enrollment can't rot silently
      // (Amex enrollments require periodic re-auth; a lapsed one 404s on every account)
      try { db.exec('ALTER TABLE bank_accounts ADD COLUMN last_sync_error TEXT'); } catch { /* exists */ }
      try {
        const balance = await getAccountBalance(account.access_token, account.teller_account_id);
        const available = Math.round(parseFloat(balance.available || '0') * 100);
        const ledger = Math.round(parseFloat(balance.ledger || '0') * 100);
        db.prepare(`
          UPDATE bank_accounts SET balance_available_cents = ?, balance_ledger_cents = ?,
            balance_updated_at = datetime('now'), updated_at = datetime('now'), last_sync_error = NULL
          WHERE id = ?
        `).run(available, ledger, account.id);
      } catch (balErr: any) {
        const msg = String(balErr.message || balErr);
        const friendly = /not_found|404|410|unauthorized|401/i.test(msg)
          ? 'CONNECTION EXPIRED — reconnect this bank via Connect Card (Teller re-auth required)'
          : msg.slice(0, 180);
        db.prepare('UPDATE bank_accounts SET last_sync_error = ? WHERE id = ?').run(friendly, account.id);
        errors.push(`${account.account_name}: ${friendly}`);
      }

      await sleep(1000); // pace between balance and transactions
      // Sync ALL transactions (paginated)
      try {
        const txns = await getAllAccountTransactions(account.access_token, account.teller_account_id);

        for (const txn of txns) {
          const amountCents = Math.round(parseFloat(txn.amount || '0') * 100);
          // Dedup by teller id, THEN by content — ids are application-scoped,
          // so a new Teller app must not re-import history
          const existing = db.prepare('SELECT id FROM bank_transactions WHERE teller_transaction_id = ?').get(txn.id)
            || db.prepare('SELECT id FROM bank_transactions WHERE bank_account_id = ? AND date = ? AND amount_cents = ? AND description = ?')
              .get(account.id, txn.date, amountCents, txn.description);
          if (existing) continue;

          const runningBalance = txn.running_balance ? Math.round(parseFloat(txn.running_balance) * 100) : null;

          db.prepare(`
            INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, description,
              category, amount_cents, type, status, counterparty, running_balance_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(), account.id, txn.id, txn.date, txn.description,
            txn.details?.category || null, amountCents, txn.type, txn.status,
            txn.details?.counterparty?.name || null, runningBalance
          );
          totalTxns++;
        }
      } catch (txnErr: any) {
        errors.push(`${account.account_name}: transactions error - ${txnErr.message}`);
      }
    } catch (err: any) {
      errors.push(`${account.account_name}: ${err.message}`);
    }
  }

  // Plaid credit cards sync with everything else on the item
  let plaidSynced = 0;
  try {
    const { syncPlaidItems } = await import('@/lib/plaid');
    const plaid = await syncPlaidItems(db);
    plaidSynced = plaid.accounts_synced;
    totalTxns += plaid.transactions_imported;
    errors.push(...plaid.errors);
  } catch (e: any) {
    errors.push(`plaid sync: ${String(e?.message || e).slice(0, 150)}`);
  }

  return NextResponse.json({
    success: true,
    accounts_synced: accounts.length + plaidSynced,
    transactions_imported: totalTxns,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// PUT: Enroll a new credit card via Teller Connect
export async function PUT(req: NextRequest) {
  const { accessToken, enrollmentId } = await req.json();

  if (!accessToken) {
    return NextResponse.json({ error: 'accessToken required' }, { status: 400 });
  }

  const db = getDb();
  ensureIdentitySchema(db);

  // Use first store as placeholder (credit cards are global)
  const firstStore: any = db.prepare('SELECT id FROM stores ORDER BY name LIMIT 1').get();
  const storeId = firstStore?.id;
  if (!storeId) {
    return NextResponse.json({ error: 'No stores exist' }, { status: 400 });
  }

  let imported = 0;

  try {
    const accounts = await getAccounts(accessToken);

    for (const account of accounts) {
      // Only import credit card accounts
      if (account.type !== 'credit') continue;

      // Canonical identity guard — name-aware layered matching (twin masks
      // like Gold/Platinum ·1009 are never guessed; ambiguity parks for review)
      const { match: existing } = findCanonicalMatch(db, {
        institution: account.institution?.name || 'Unknown', mask: account.last_four,
        type: account.type, name: account.name, providerAccountId: account.id,
      });
      if (existing) {
        // Reconnect: refresh token + enrollment + account id on the existing row
        db.prepare(`UPDATE bank_accounts SET access_token = ?, teller_enrollment_id = ?, teller_account_id = ?, status = 'active', updated_at = datetime('now') WHERE id = ?`)
          .run(accessToken, enrollmentId || account.enrollment_id, account.id, existing.id);
        imported++;
        continue;
      }

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
    console.error('[credit-cards] Enrollment error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH: Update transaction category
export async function PATCH(req: NextRequest) {
  const { transactionId, category } = await req.json();
  if (!transactionId) return NextResponse.json({ error: 'transactionId required' }, { status: 400 });

  const db = getDb();
  db.prepare('UPDATE bank_transactions SET custom_category = ? WHERE id = ?').run(category || null, transactionId);
  return NextResponse.json({ success: true });
}
