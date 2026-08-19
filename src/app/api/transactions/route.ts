import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  ensureTxnIntelTables, runTransactionScan,
  getLedger, getCardIntel, getPaymentsView, getSummary, getCardClarity, getTruth, getPayPlan, getSystemHealth,
} from '@/lib/transactions-intel';
import { brainCached, dropBrainCache } from '@/lib/brain-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  ensureTxnIntelTables(db);
  const sp = req.nextUrl.searchParams;
  const view = sp.get('view') || 'summary';
  const days = Number(sp.get('days')) || undefined;

  if (view === 'summary') {
    const stores = db.prepare('SELECT id, name FROM stores ORDER BY name').all();
    const accounts = db.prepare(`SELECT id, institution_name, account_name, account_type, last_four, COALESCE(company,'ymgv') AS company FROM bank_accounts WHERE status = 'active' ORDER BY account_type, institution_name`).all();
    return NextResponse.json({ ...getSummary(db), stores, accounts });
  }
  if (view === 'cards') return NextResponse.json({ cards: getCardIntel(db, days || 30), clarity: getCardClarity(db) });
  if (view === 'incoming') {
    const { getIncomingCash } = await import('@/lib/incoming-cash');
    return NextResponse.json(getIncomingCash(db));
  }
  if (view === 'adspend') {
    // Ad Spends tab — per store/platform: yesterday, 7d, 30d, plus each FB
    // profile's unbilled balance (what will hit the cards next)
    const spend: any[] = db.prepare(`
      SELECT s.name AS store, a.platform,
        SUM(CASE WHEN a.date = date('now', '-1 day') THEN a.spend_cents ELSE 0 END) AS y_cents,
        SUM(CASE WHEN a.date >= date('now', '-7 days') THEN a.spend_cents ELSE 0 END) AS d7_cents,
        SUM(a.spend_cents) AS d30_cents
      FROM ad_spend a JOIN stores s ON s.id = a.store_id
      WHERE a.date >= date('now', '-30 days')
      GROUP BY s.id, a.platform HAVING d30_cents > 0
      ORDER BY d7_cents DESC
    `).all();
    const fbUnbilled: any[] = db.prepare(`
      SELECT p.profile_name, s.name AS store, p.balance_cents,
             COALESCE(p.primary_card_last4, p.working_card_last4) AS card_last4,
             p.primary_card_declining AS declining, p.last_sync_at
      FROM fb_profiles p JOIN stores s ON s.id = p.store_id
      WHERE p.is_active = 1 AND p.balance_cents > 0
      ORDER BY p.balance_cents DESC
    `).all();
    // Campaign level: run-rate per campaign → estimated forward burn. A
    // campaign is "active" if it spent in the last 2 days; its est/day is
    // yesterday's spend, falling back to its 3-day average.
    const campaigns: any[] = db.prepare(`
      SELECT s.name AS store, a.platform, a.campaign_id, MAX(a.campaign_name) AS campaign_name,
        SUM(CASE WHEN a.date = date('now', '-1 day') THEN a.spend_cents ELSE 0 END) AS y_cents,
        SUM(CASE WHEN a.date >= date('now', '-3 days') THEN a.spend_cents ELSE 0 END) AS d3_cents,
        COUNT(DISTINCT CASE WHEN a.date >= date('now', '-3 days') AND a.spend_cents > 0 THEN a.date END) AS d3_days,
        SUM(CASE WHEN a.date >= date('now', '-7 days') THEN a.spend_cents ELSE 0 END) AS d7_cents,
        MAX(a.date) AS last_spend_date
      FROM ad_spend a JOIN stores s ON s.id = a.store_id
      WHERE a.date >= date('now', '-7 days') AND a.campaign_id IS NOT NULL
      GROUP BY s.id, a.platform, a.campaign_id
      HAVING d7_cents > 0 ORDER BY d7_cents DESC
    `).all().map((c: any) => {
      const active = c.last_spend_date >= new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
      const estDaily = c.y_cents > 0 ? c.y_cents : (c.d3_days > 0 ? Math.round(c.d3_cents / c.d3_days) : 0);
      return { ...c, active, est_daily_cents: active ? estDaily : 0 };
    });
    // Per-store forward estimate from its active campaigns
    const estByStore = new Map<string, { store: string; n: number; est_daily_cents: number }>();
    for (const c of campaigns) {
      if (!c.active || !c.est_daily_cents) continue;
      if (!estByStore.has(c.store)) estByStore.set(c.store, { store: c.store, n: 0, est_daily_cents: 0 });
      const e = estByStore.get(c.store)!;
      e.n++;
      e.est_daily_cents += c.est_daily_cents;
    }
    const estimates = [...estByStore.values()].sort((a, b) => b.est_daily_cents - a.est_daily_cents);
    return NextResponse.json({ spend, fbUnbilled, campaigns, estimates });
  }
  if (view === 'accounts') {
    // Bank Accounts / Credit Cards tabs — every active account with company,
    // store, balances, freshness and feed errors in one cheap query
    const rows: any[] = db.prepare(`
      SELECT a.id, a.institution_name, a.account_name, a.nickname, a.last_four, a.account_type,
             a.provider, COALESCE(a.company, 'ymgv') AS company, a.credit_limit_cents,
             COALESCE(a.balance_available_cents, a.balance_ledger_cents, 0) AS available_cents,
             COALESCE(a.balance_ledger_cents, 0) AS ledger_cents,
             a.bank_data_as_of, a.balance_updated_at, a.last_sync_error, s.name AS store_name
      FROM bank_accounts a LEFT JOIN stores s ON s.id = a.store_id
      WHERE a.status = 'active'
      ORDER BY a.account_type, a.institution_name, a.last_four
    `).all();
    return NextResponse.json({
      banks: rows.filter(r => r.account_type !== 'credit'),
      creditCards: rows.filter(r => r.account_type === 'credit'),
    });
  }
  if (view === 'truth') return NextResponse.json(brainCached(`truth:${days || 90}`, () => getTruth(db, days || 90)));
  if (view === 'payplan') return NextResponse.json(brainCached('payplan', () => getPayPlan(db)));
  if (view === 'health') return NextResponse.json(brainCached('health', () => getSystemHealth(db)));
  if (view === 'payments') return NextResponse.json({ payments: getPaymentsView(db, days || 60) });
  if (view === 'ledger') {
    return NextResponse.json(getLedger(db, {
      accountId: sp.get('accountId') || undefined,
      storeId: sp.get('storeId') || undefined,
      cls: sp.get('class') || undefined,
      q: sp.get('q') || undefined,
      unattributed: sp.get('unattributed') === '1',
      days,
      limit: Number(sp.get('limit')) || undefined,
      offset: Number(sp.get('offset')) || undefined,
    }));
  }
  return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
}

// Single-flight guard for bank syncs — page loads must not stack Teller pulls.
let bankSyncRunning = false;

export async function POST(req: NextRequest) {
  const db = getDb();
  const b = await req.json().catch(() => ({}));
  dropBrainCache(); // any write invalidates the speed layer — fast, never stale
  if (b.action === 'scan') {
    // A scan over stale bank data classifies the past — pull the banks
    // CURRENT first (no throttle), then classify what just arrived.
    let banks: any = null;
    if (!bankSyncRunning) {
      bankSyncRunning = true;
      try {
        const { syncBankAccounts } = await import('@/lib/bank-sync');
        const r = await syncBankAccounts();
        banks = { accounts: r.accounts_synced, transactions: r.transactions_imported, errors: r.errors.slice(0, 3) };
      } catch (e: any) {
        banks = { error: String(e?.message || e).slice(0, 120) };
      } finally {
        bankSyncRunning = false;
      }
    }
    const stats = runTransactionScan(db, { days: Number(b.days) || 365, force: !!b.force });
    return NextResponse.json({ success: true, stats, banks });
  }

  // Fresh balances on demand — fired by the Transactions page on load.
  // Throttled: if every account was synced within the last 5 minutes, skip
  // (the numbers are already real). Runs the incremental scan afterward so
  // new transactions are classified before the page shows them.
  if (b.action === 'sync-banks') {
    const fresh: any = db.prepare(`SELECT MAX(balance_updated_at) at FROM bank_accounts WHERE status = 'active'`).get();
    const ageMs = fresh?.at ? Date.now() - new Date(String(fresh.at).replace(' ', 'T') + 'Z').getTime() : Infinity;
    if (!b.force && ageMs < 5 * 60_000) {
      return NextResponse.json({ success: true, skipped: true, freshAt: fresh.at, ageSeconds: Math.round(ageMs / 1000) });
    }
    if (bankSyncRunning) return NextResponse.json({ success: true, alreadyRunning: true });
    bankSyncRunning = true;
    try {
      const { syncBankAccounts } = await import('@/lib/bank-sync');
      const r = await syncBankAccounts();
      const scan = runTransactionScan(db, { days: 45 });
      return NextResponse.json({
        success: true, accounts: r.accounts_synced, transactions: r.transactions_imported,
        classified: scan.classified, errors: r.errors.slice(0, 3),
      });
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
    } finally {
      bankSyncRunning = false;
    }
  }

  // Payroll: add an item {action:'payroll_add', label, amountCents, dueDate, storeId?, recurrence?}
  // Bill one-off transactions to a store's books: assigns the store (manual,
  // permanent) AND writes the cost into that store's daily_pnl other costs on
  // the transaction date — so CFO snapshots account for it and nothing leaks
  // into the reconciliation residual. Idempotent: a billed txn never bills twice.
  if (b.action === 'bill_to_store') {
    ensureTxnIntelTables(db);
    const ids: string[] = Array.isArray(b.txnIds) ? b.txnIds : [];
    if (!ids.length || !b.storeId) return NextResponse.json({ error: 'txnIds[] and storeId required' }, { status: 400 });
    const store: any = db.prepare('SELECT id, name FROM stores WHERE id = ?').get(b.storeId);
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    const crypto = await import('crypto');
    let billed = 0, skipped = 0, totalCents = 0;
    for (const txnId of ids) {
      const t: any = db.prepare(`
        SELECT t.id, t.date, t.description, t.amount_cents, l.billed_store_at, l.class
        FROM bank_transactions t LEFT JOIN txn_links l ON l.txn_id = t.id WHERE t.id = ?`).get(txnId);
      if (!t) { skipped++; continue; }
      if (t.billed_store_at) { skipped++; continue; } // already on someone's books
      const amt = Math.abs(t.amount_cents);
      db.prepare(`INSERT INTO txn_links (txn_id, class, store_id, store_source, confidence, billed_store_at, updated_at)
        VALUES (?, ?, ?, 'manual', 'manual', datetime('now'), datetime('now'))
        ON CONFLICT(txn_id) DO UPDATE SET store_id = excluded.store_id, store_source = 'manual',
          confidence = 'manual', billed_store_at = datetime('now'), updated_at = datetime('now')`)
        .run(txnId, t.class || 'other', b.storeId);
      const note = `${String(t.description || '').slice(0, 40)} $${(amt / 100).toFixed(2)}`;
      const row: any = db.prepare('SELECT * FROM daily_pnl WHERE store_id = ? AND date = ?').get(b.storeId, t.date);
      if (row) {
        const other = (row.other_costs_cents || 0) + amt;
        const totalCosts = (row.cogs_cents || 0) + (row.shipping_cost_cents || 0) + (row.pick_pack_cents || 0)
          + (row.packaging_cents || 0) + (row.ad_spend_cents || 0) + (row.shopify_fees_cents || 0)
          + other + (row.chargeback_cents || 0) + (row.app_costs_cents || 0);
        const net = (row.revenue_cents || 0) - totalCosts;
        db.prepare(`UPDATE daily_pnl SET other_costs_cents = ?, other_costs_note = ?,
          net_profit_cents = ?, margin_pct = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(other, [row.other_costs_note, note].filter(Boolean).join(' · ').slice(0, 500),
            net, row.revenue_cents > 0 ? (net / row.revenue_cents) * 100 : 0, row.id);
      } else {
        db.prepare(`INSERT INTO daily_pnl (id, store_id, date, revenue_cents, order_count, other_costs_cents, other_costs_note, net_profit_cents, margin_pct, source)
          VALUES (?, ?, ?, 0, 0, ?, ?, ?, 0, 'manual')`)
          .run(crypto.randomUUID(), b.storeId, t.date, amt, note, -amt);
      }
      billed++; totalCents += amt;
    }
    return NextResponse.json({ success: true, billed, skipped, totalCents, store: store.name });
  }

  if (b.action === 'payroll_add') {
    const { ensurePayrollTable } = await import('@/lib/transactions-intel');
    ensurePayrollTable(db);
    if (!b.label || !b.amountCents || !b.dueDate) return NextResponse.json({ error: 'label, amountCents, dueDate required' }, { status: 400 });
    const crypto = await import('crypto');
    db.prepare(`INSERT INTO payroll_items (id, label, amount_cents, due_date, store_id, recurrence) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), String(b.label).slice(0, 120), Math.round(Number(b.amountCents)), b.dueDate,
        b.storeId || null, ['once', 'weekly', 'biweekly', 'monthly'].includes(b.recurrence) ? b.recurrence : 'once');
    return NextResponse.json({ success: true });
  }

  // Payroll: mark paid (auto-creates the next occurrence for recurring) or delete
  if (b.action === 'payroll_update') {
    const { ensurePayrollTable } = await import('@/lib/transactions-intel');
    ensurePayrollTable(db);
    const item: any = db.prepare('SELECT * FROM payroll_items WHERE id = ?').get(b.id);
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    if (b.op === 'delete') {
      db.prepare('DELETE FROM payroll_items WHERE id = ?').run(b.id);
      return NextResponse.json({ success: true });
    }
    if (b.op === 'paid') {
      db.prepare(`UPDATE payroll_items SET paid_at = datetime('now') WHERE id = ?`).run(b.id);
      if (item.recurrence !== 'once') {
        const days = item.recurrence === 'weekly' ? 7 : item.recurrence === 'biweekly' ? 14 : 0;
        const next = days
          ? new Date(new Date(item.due_date + 'T12:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10)
          : (() => { const d = new Date(item.due_date + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
        const crypto = await import('crypto');
        db.prepare(`INSERT INTO payroll_items (id, label, amount_cents, due_date, store_id, recurrence) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(crypto.randomUUID(), item.label, item.amount_cents, next, item.store_id, item.recurrence);
      }
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Unknown op' }, { status: 400 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// Manual attribution: assign store and/or class to a transaction.
// Or statement entry: {action:'statement', accountId, statementBalanceCents, dueDate, statementDate?, minPaymentCents?}
export async function PATCH(req: NextRequest) {
  const db = getDb();
  ensureTxnIntelTables(db);
  const b = await req.json().catch(() => ({}));
  dropBrainCache();

  if (b.action === 'nickname') {
    if (!b.accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
    const nick = typeof b.nickname === 'string' ? b.nickname.trim().slice(0, 40) : '';
    const r = db.prepare("UPDATE bank_accounts SET nickname = ?, updated_at = datetime('now') WHERE id = ?")
      .run(nick || null, b.accountId);
    if (!r.changes) return NextResponse.json({ error: 'account not found' }, { status: 404 });
    return NextResponse.json({ success: true, nickname: nick || null });
  }

  if (b.action === 'statement') {
    const { ensureCardStatements } = await import('@/lib/transactions-intel');
    ensureCardStatements(db);
    if (!b.accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
    const acct = db.prepare("SELECT id FROM bank_accounts WHERE id = ? AND account_type = 'credit'").get(b.accountId);
    if (!acct) return NextResponse.json({ error: 'Credit card account not found' }, { status: 404 });
    db.prepare(`INSERT INTO card_statements (bank_account_id, statement_balance_cents, statement_date, due_date, min_payment_cents, source, updated_at)
      VALUES (?, ?, ?, ?, ?, 'manual', datetime('now'))
      ON CONFLICT(bank_account_id) DO UPDATE SET
        statement_balance_cents = excluded.statement_balance_cents,
        statement_date = excluded.statement_date,
        due_date = excluded.due_date,
        min_payment_cents = excluded.min_payment_cents,
        source = 'manual',
        updated_at = datetime('now')`)
      .run(b.accountId,
        b.statementBalanceCents != null ? Math.round(Number(b.statementBalanceCents)) : null,
        b.statementDate || null, b.dueDate || null,
        b.minPaymentCents != null ? Math.round(Number(b.minPaymentCents)) : null);
    return NextResponse.json({ success: true });
  }

  if (!b.txnId) return NextResponse.json({ error: 'txnId required' }, { status: 400 });
  const txn = db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(b.txnId);
  if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  const existing: any = db.prepare('SELECT class FROM txn_links WHERE txn_id = ?').get(b.txnId);
  db.prepare(`INSERT INTO txn_links (txn_id, class, store_id, store_source, confidence, updated_at)
    VALUES (?, ?, ?, 'manual', 'manual', datetime('now'))
    ON CONFLICT(txn_id) DO UPDATE SET
      store_id = excluded.store_id, store_source = 'manual',
      class = CASE WHEN ? IS NOT NULL THEN ? ELSE txn_links.class END,
      confidence = 'manual', updated_at = datetime('now')`)
    .run(b.txnId, b.class || existing?.class || 'other', b.storeId || null, b.class || null, b.class || null);
  return NextResponse.json({ success: true });
}
