import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccountBalance, getAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// GET: List all credit card accounts (global — not filtered by store)
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId');
  const db = getDb();

  // If accountId provided, return transactions for that card
  if (accountId) {
    const transactions: any[] = db.prepare(`
      SELECT bt.*, bt.custom_category, bt.custom_note
      FROM bank_transactions bt
      WHERE bt.bank_account_id = ?
      ORDER BY bt.date DESC, bt.id DESC
      LIMIT 500
    `).all(accountId);

    const inflow = transactions.filter(t => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
    const outflow = transactions.filter(t => t.amount_cents < 0).reduce((s, t) => s + t.amount_cents, 0);

    // Category breakdown
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

  // Otherwise return all credit card accounts
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

// POST: Sync balances + transactions for all credit card accounts
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

  for (const account of accounts) {
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

      // Sync transactions
      try {
        const txns = await getAccountTransactions(account.access_token, account.teller_account_id, 200);

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

// PATCH: Update transaction category
export async function PATCH(req: NextRequest) {
  const { transactionId, category } = await req.json();
  if (!transactionId) return NextResponse.json({ error: 'transactionId required' }, { status: 400 });

  const db = getDb();
  db.prepare('UPDATE bank_transactions SET custom_category = ? WHERE id = ?').run(category || null, transactionId);
  return NextResponse.json({ success: true });
}
