import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccounts, getAccountBalance, getAllAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';

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

  const cards: any[] = db.prepare(`
    SELECT * FROM bank_accounts
    WHERE account_type = 'credit' AND status = 'active'
    ORDER BY institution_name, account_name
  `).all();

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
  const totalLedger = cards.reduce((s: number, c: any) => s + (c.balance_ledger_cents || 0), 0);

  return NextResponse.json({
    cards,
    summary: {
      total_available_cents: totalAvailable,
      total_ledger_cents: totalLedger,
      card_count: cards.length,
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

      // Match by teller_account_id, else institution + last_four + type — ids
      // are application-scoped, so a new Teller app must re-attach to the same rows
      const existing: any = db.prepare('SELECT id FROM bank_accounts WHERE teller_account_id = ?').get(account.id)
        || db.prepare(`SELECT id FROM bank_accounts WHERE last_four = ? AND account_type = ? AND institution_name = ? ORDER BY updated_at DESC LIMIT 1`)
          .get(account.last_four, account.type, account.institution?.name || 'Unknown');
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
