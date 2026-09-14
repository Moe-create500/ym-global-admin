import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
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

  // Statement data = the BANK's own numbers via Plaid liabilities (or manual
  // entry where consent is missing) — balance, due date, minimum payment.
  const stmts = new Map<string, any>(
    (db.prepare('SELECT * FROM card_statements').all() as any[]).map((s: any) => [s.bank_account_id, s])
  );
  const today = new Date().toISOString().slice(0, 10);

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
    const st = stmts.get(a.id);
    const daysToDue = st?.due_date
      ? Math.round((Date.parse(st.due_date) - Date.parse(today)) / 86_400_000)
      : null;
    // Plaid's statement balance is frozen AT CLOSE — it never shrinks when you
    // pay. Remaining-on-statement is derived from the card's own bank feed:
    // credits (payments/refunds) posted since the close date pay it down.
    // Capped by the card's current total owed (can't owe more on the statement
    // than on the whole card).
    let statement: any = null;
    if (st) {
      let paymentsSinceClose = 0;
      if (st.statement_date && (st.statement_balance_cents || 0) > 0) {
        const r: any = db.prepare(
          'SELECT COALESCE(SUM(amount_cents),0) s FROM bank_transactions WHERE bank_account_id = ? AND amount_cents > 0 AND date > ?'
        ).get(a.id, st.statement_date);
        paymentsSinceClose = r.s || 0;
      }
      const ledgerKnown = a.balance_ledger_cents != null;
      const owedNow = Math.abs(a.balance_ledger_cents || 0);
      let remaining = Math.max((st.statement_balance_cents || 0) - paymentsSinceClose, 0);
      if (ledgerKnown) remaining = Math.min(remaining, owedNow);
      statement = {
        balance_cents: st.statement_balance_cents,
        payments_since_close_cents: paymentsSinceClose,
        remaining_cents: remaining,
        paid: (st.statement_balance_cents || 0) > 0 && remaining === 0,
        statement_date: st.statement_date,
        due_date: st.due_date,
        days_to_due: daysToDue,
        min_payment_cents: st.min_payment_cents,
        min_satisfied: paymentsSinceClose >= (st.min_payment_cents || 0),
        source: st.source || 'manual',
        updated_at: st.updated_at,
      };
    }
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
      statement,
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

// POST: Sync balances + ALL transactions for credit card accounts.
// Plaid only — Teller retired 2026-09-14.
export async function POST() {
  const db = getDb();
  let totalTxns = 0;
  const errors: string[] = [];
  const accounts: any[] = [];

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

// PATCH: Update transaction category
export async function PATCH(req: NextRequest) {
  const { transactionId, category } = await req.json();
  if (!transactionId) return NextResponse.json({ error: 'transactionId required' }, { status: 400 });

  const db = getDb();
  db.prepare('UPDATE bank_transactions SET custom_category = ? WHERE id = ?').run(category || null, transactionId);
  return NextResponse.json({ success: true });
}
