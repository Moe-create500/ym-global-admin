// ============================================================================
// CFO MONTHLY — month-first store expense & credit-card allocation report.
//
// READ-ONLY analytical layer over existing truth: classification_results
// (evidence-based store attribution), bank_transactions (source), daily_pnl
// (existing P&L — never recomputed here). No new accounting is invented:
//  - expenses = attributed debit transactions EXCLUDING transfers and card
//    payments (those are liability settlements, P&L impact $0 — preserved)
//  - card allocation = per-card charges split by PROVEN store attribution;
//    unproven stays UNATTRIBUTED (never guessed)
//  - the P&L cross-check compares against daily_pnl as-is (one truth)
// ============================================================================

import type Database from 'better-sqlite3';

const NON_EXPENSE = "('Transfer Out','Transfer In','Credit Card Payment','Shopify Payout')";

export function getMonthlyStoreReport(db: Database.Database, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM');
  const like = `${month}-%`;

  // Store expenses: attributed, P&L-impacting debits (card + bank alike —
  // the charge is the expense; the later card payment is excluded above)
  const storeExpenses: any[] = db.prepare(`
    SELECT COALESCE(s.name, '⚠ Unattributed') store, r.store_id,
      COUNT(*) n, SUM(ABS(bt.amount_cents)) cents
    FROM bank_transactions bt
    JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.status != 'merged'
    LEFT JOIN classification_results r ON r.txn_id = bt.id
    LEFT JOIN stores s ON s.id = r.store_id
    WHERE bt.date LIKE ? AND bt.amount_cents < 0
      AND COALESCE(r.category, '') NOT IN ${NON_EXPENSE}
    GROUP BY r.store_id ORDER BY cents DESC`).all(like);

  // Per-store breakdown by merchant and by account (for drill-down)
  const storeDetail = (storeId: string | null) => ({
    by_merchant: db.prepare(`
      SELECT COALESCE(r.merchant_name, UPPER(SUBSTR(bt.description, 1, 22))) merchant,
        COUNT(*) n, SUM(ABS(bt.amount_cents)) cents
      FROM bank_transactions bt
      JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.status != 'merged'
      LEFT JOIN classification_results r ON r.txn_id = bt.id
      WHERE bt.date LIKE ? AND bt.amount_cents < 0
        AND COALESCE(r.category, '') NOT IN ${NON_EXPENSE}
        AND ${storeId ? 'r.store_id = ?' : 'r.store_id IS NULL'}
      GROUP BY merchant ORDER BY cents DESC LIMIT 12`).all(...(storeId ? [like, storeId] : [like])),
    by_account: db.prepare(`
      SELECT COALESCE(a.nickname, a.account_name, a.institution_name) || ' ····' || a.last_four account,
        a.account_type, COUNT(*) n, SUM(ABS(bt.amount_cents)) cents
      FROM bank_transactions bt
      JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.status != 'merged'
      LEFT JOIN classification_results r ON r.txn_id = bt.id
      WHERE bt.date LIKE ? AND bt.amount_cents < 0
        AND COALESCE(r.category, '') NOT IN ${NON_EXPENSE}
        AND ${storeId ? 'r.store_id = ?' : 'r.store_id IS NULL'}
      GROUP BY a.id ORDER BY cents DESC LIMIT 10`).all(...(storeId ? [like, storeId] : [like])),
  });

  // Credit-card allocation: whose stores generated each card's charges this
  // month. Payments (credits from pairing) shown separately, never as expense.
  const cards: any[] = db.prepare(`
    SELECT a.id, COALESCE(a.nickname, a.account_name) || ' ····' || a.last_four card,
      SUM(CASE WHEN bt.amount_cents < 0 THEN ABS(bt.amount_cents) ELSE 0 END) charges_cents,
      SUM(CASE WHEN bt.amount_cents > 0 AND COALESCE(r.category,'') = 'Credit Card Payment' THEN bt.amount_cents ELSE 0 END) payments_cents
    FROM bank_transactions bt
    JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.account_type = 'credit' AND a.status = 'active'
    LEFT JOIN classification_results r ON r.txn_id = bt.id
    WHERE bt.date LIKE ?
    GROUP BY a.id HAVING charges_cents > 0 OR payments_cents > 0
    ORDER BY charges_cents DESC`).all(like);
  const cardAllocation = cards.map((c: any) => ({
    ...c,
    stores: db.prepare(`
      SELECT COALESCE(s.name, '⚠ Unattributed') store, COUNT(*) n, SUM(ABS(bt.amount_cents)) cents
      FROM bank_transactions bt
      LEFT JOIN classification_results r ON r.txn_id = bt.id
      LEFT JOIN stores s ON s.id = r.store_id
      WHERE bt.bank_account_id = ? AND bt.date LIKE ? AND bt.amount_cents < 0
        AND COALESCE(r.category, '') NOT IN ${NON_EXPENSE}
      GROUP BY r.store_id ORDER BY cents DESC`).all(c.id, like),
  }));

  // P&L cross-check — daily_pnl AS-IS (existing truth, not recomputed)
  const pnl: any = db.prepare(`
    SELECT COALESCE(SUM(revenue_cents),0) revenue_cents,
      COALESCE(SUM(cogs_cents + shipping_cost_cents + pick_pack_cents + packaging_cents
        + ad_spend_cents + shopify_fees_cents + other_costs_cents + chargeback_cents + app_costs_cents),0) expenses_cents,
      COALESCE(SUM(net_profit_cents),0) net_profit_cents
    FROM daily_pnl WHERE date LIKE ?`).get(like);

  const totalExpense = storeExpenses.reduce((s: number, r: any) => s + r.cents, 0);
  const attributedExpense = storeExpenses.filter((r: any) => r.store_id).reduce((s: number, r: any) => s + r.cents, 0);

  return {
    month,
    store_expenses: storeExpenses,
    store_detail: Object.fromEntries(
      storeExpenses.map((r: any) => [r.store_id ?? 'unattributed', storeDetail(r.store_id)])
    ),
    card_allocation: cardAllocation,
    pnl,
    totals: {
      expense_cents: totalExpense,
      attributed_cents: attributedExpense,
      unattributed_cents: totalExpense - attributedExpense,
      attribution_pct: totalExpense > 0 ? Math.round((attributedExpense / totalExpense) * 100) : 100,
    },
  };
}
