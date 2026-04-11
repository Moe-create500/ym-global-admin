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

  const totalAvailable = cards.reduce((s: number, c: any) => s + (c.balance_available_cents || 0), 0);
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
    "SELECT * FROM bank_accounts WHERE account_type = 'credit' AND status = 'active'"
  ).all();

  if (accounts.length === 0) {
    return NextResponse.json({ error: 'No active credit card accounts' }, { status: 404 });
  }

  let totalTxns = 0;
  const errors: string[] = [];

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  for (let ai = 0; ai < accounts.length; ai++) {
    const account = accounts[ai];
    if (ai > 0) await sleep(3000); // pace between accounts
    try {
      // Sync balance
      try {
        const balance = await getAccountBalance(account.access_token, account.teller_account_id);
        const available = Math.round(parseFloat(balance.available || '0') * 100);
        const ledger = Math.round(parseFloat(balance.ledger || '0') * 100);
        db.prepare(`
          UPDATE bank_accounts SET balance_available_cents = ?, balance_ledger_cents = ?,
            balance_updated_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(available, ledger, account.id);
      } catch (balErr: any) {
        errors.push(`${account.account_name}: balance error - ${balErr.message}`);
      }

      await sleep(1000); // pace between balance and transactions
      // Sync ALL transactions (paginated)
      try {
        const txns = await getAllAccountTransactions(account.access_token, account.teller_account_id);

        for (const txn of txns) {
          const existing = db.prepare('SELECT id FROM bank_transactions WHERE teller_transaction_id = ?').get(txn.id);
          if (existing) continue;

          const amountCents = Math.round(parseFloat(txn.amount || '0') * 100);
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

  return NextResponse.json({
    success: true,
    accounts_synced: accounts.length,
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

      const existing = db.prepare('SELECT id FROM bank_accounts WHERE teller_account_id = ?').get(account.id);
      if (existing) continue;

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
