import type DatabaseType from 'better-sqlite3';
import { type Scope } from './scopes';
import { type Period, _internals } from './report';
import { unpairedOutflows } from './movements';
import { cardOwedCents } from '../bank-balances';

/** Drilldown for a headline / table figure: what it means, how it is
 *  computed, the records that went into it, what was excluded, and when each
 *  source last synced. The included rows are read with the SAME helpers the
 *  overview used, so the drilldown total always equals the number clicked. */

export interface Trace {
  key: string;
  title: string;
  definition: string;
  formula: string;
  scope: { id: string; label: string };
  period: Period | null;
  sources: { system: string; table: string; lastSync: string | null; reference?: string }[];
  included: { columns: string[]; rows: (string | number | null)[][]; total: number | null; truncated: boolean };
  excluded: string[];
  adjustments: { note: string }[];
  kinds: string;   // actual / estimated / manual / missing / stale explanation
}

const LIMIT = 300;
const q = (n: number) => Array(n).fill('?').join(',') || "''";

export function traceFigure(db: DatabaseType.Database, key: string, scope: Scope, period: Period): Trace | null {
  const ids = scope.storeIds;
  const base = { scope: { id: scope.id, label: scope.label }, period, adjustments: [] as { note: string }[] };
  const lastPnl = (db.prepare(`SELECT MAX(COALESCE(updated_at, synced_at)) m FROM daily_pnl WHERE store_id IN (${q(ids.length)})`).get(...ids) as any)?.m || null;

  if (key === 'revenue' || key === 'net_profit' || key === 'gross_profit' || key === 'overhead' || key === 'period_profit') {
    if (scope.kind === 'warehouse') return { ...base, key, title: 'Not available for a warehouse', definition: 'Warehouse P&L needs the ShipSourced location mapping (Phase 2).', formula: '—', sources: [], included: { columns: [], rows: [], total: null, truncated: false }, excluded: [], kinds: 'missing' };
    const rows: any[] = db.prepare(`SELECT s.name, dp.date, dp.revenue_cents, dp.refunds_cents, dp.cogs_cents, dp.shipping_cost_cents, dp.pick_pack_cents, dp.packaging_cents, dp.ad_spend_cents, dp.shopify_fees_cents, dp.app_costs_cents, dp.chargeback_cents, dp.other_costs_cents, dp.fulfillment_est_cents, dp.net_profit_cents, dp.source, COALESCE(dp.updated_at, dp.synced_at) upd
      FROM daily_pnl dp JOIN stores s ON s.id = dp.store_id WHERE dp.store_id IN (${q(ids.length)}) AND dp.date BETWEEN ? AND ? ORDER BY dp.date DESC, s.name LIMIT ?`).all(...ids, period.from, period.to, LIMIT + 1);
    const agg = _internals.pnlFor(db, ids, period);
    const pick: Record<string, { title: string; def: string; formula: string; col: (r: any) => number; total: number }> = {
      revenue: { title: 'Revenue', def: 'Gross order revenue per day from the order syncs (Shopify / ShipSourced / CSV). Refunds are shown separately and are not subtracted here.', formula: 'Σ daily_pnl.revenue_cents over the period', col: r => r.revenue_cents, total: agg.revenue },
      net_profit: { title: 'Net profit', def: 'Revenue − refunds (non-Shopify) − COGS − shipping − pick/pack − packaging − ad spend − Shopify fees − app bills − chargebacks − other. Estimated fulfilment is NOT included.', formula: 'Σ daily_pnl.net_profit_cents (computePnl in src/lib/finance-core.ts)', col: r => r.net_profit_cents, total: agg.net },
      period_profit: { title: 'Profit for the period', def: 'Same as net profit for the selected scope and period.', formula: 'Σ daily_pnl.net_profit_cents', col: r => r.net_profit_cents, total: agg.net },
      gross_profit: { title: 'Gross profit', def: 'Revenue − refunds − COGS − shipping − pick/pack − packaging.', formula: 'Σ (revenue − refunds − cogs − shipping − pick_pack − packaging)', col: r => r.revenue_cents - (r.refunds_cents || 0) - r.cogs_cents - r.shipping_cost_cents - r.pick_pack_cents - r.packaging_cents, total: agg.revenue - agg.refunds - agg.cogs - agg.shipping - agg.pick_pack - agg.packaging },
      overhead: { title: 'Overhead (as tracked in P&L)', def: 'Ad spend + Shopify fees + app bills + chargebacks + other costs. Subscriptions, payroll, rent, utilities and card interest are NOT in daily_pnl today — they appear only in the bank ledger.', formula: 'Σ (ad_spend + shopify_fees + app_costs + chargeback + other_costs)', col: r => r.ad_spend_cents + r.shopify_fees_cents + r.app_costs_cents + r.chargeback_cents + r.other_costs_cents, total: agg.ad + agg.fees + agg.app + agg.chargeback + agg.other },
    };
    const p = pick[key];
    return { ...base, key, title: p.title, definition: p.def, formula: p.formula,
      sources: [{ system: 'daily_pnl', table: 'daily_pnl (writers: order sync, ShipSourced pull, ads sync, app invoices, apply-pricing, manual edits)', lastSync: lastPnl }],
      included: { columns: ['store', 'date', 'amount', 'revenue', 'net profit', 'est. fulfilment', 'source', 'updated'], rows: rows.slice(0, LIMIT).map(r => [r.name, r.date, p.col(r), r.revenue_cents, r.net_profit_cents, r.fulfillment_est_cents || 0, r.source, r.upd]), total: p.total, truncated: rows.length > LIMIT },
      excluded: ['Days outside the period', 'Stores outside the scope', key === 'net_profit' || key === 'period_profit' ? `Estimated fulfilment (${(agg.est / 100).toFixed(2)} USD in this period) — provisional until billed` : ''].filter(Boolean),
      kinds: agg.est > 0 ? 'estimated — some fulfilment is still projected' : 'actual — every day comes from a sync' };
  }

  if (key === 'cash' || key === 'available_cash' || key === 'card_debt') {
    const accts = _internals.accountsFor(db, scope).filter(a => key === 'card_debt' ? a.account_type === 'credit' : a.account_type !== 'credit');
    const rows = accts.map(a => [a.institution_name, `${a.account_name} ··${a.last_four}`, key === 'card_debt' ? cardOwedCents(a) : a.balance_available_cents, a.balance_updated_at]);
    const total = accts.reduce((s, a) => s + (key === 'card_debt' ? cardOwedCents(a) : (a.balance_available_cents || 0)), 0);
    return { ...base, period: null, key, title: key === 'card_debt' ? 'Card debt' : 'Available cash', definition: key === 'card_debt' ? 'What the bank reports as owed on each card (ledger balance) — the same number as the Credit Cards page.' : 'Available balance on every checking/savings account in scope, as last reported by the bank feed.', formula: key === 'card_debt' ? 'Σ |bank_accounts.balance_ledger_cents| over credit accounts (src/lib/bank-balances.ts)' : 'Σ bank_accounts.balance_available_cents over depository accounts',
      sources: accts.map(a => ({ system: 'Plaid', table: `bank_accounts ${a.institution_name} ··${a.last_four}`, lastSync: a.balance_updated_at })),
      included: { columns: ['institution', 'account', 'amount', 'balance as of'], rows, total, truncated: false },
      excluded: ['Accounts marked hidden on the CFO sheet', 'Merged / disconnected accounts', scope.kind === 'store' ? 'Accounts assigned to other stores' : ''].filter(Boolean),
      kinds: 'actual when the balance is under 36h old; stale (last-known) otherwise' };
  }

  if (key === 'net_assets') {
    const rows: any[] = ids.map(sid => db.prepare(`SELECT s.name, c.snapshot_date, c.created_at, c.assets_cents, c.liabilities_cents, c.equity_cents FROM cfo_snapshots c JOIN stores s ON s.id = c.store_id WHERE c.store_id = ? AND COALESCE(c.excluded,0)=0 ORDER BY c.created_at DESC LIMIT 1`).get(sid)).filter(Boolean);
    return { ...base, period: null, key, title: 'Net assets (latest snapshot)', definition: 'Assets − liabilities as saved on the Position sheet. This is the last snapshot each business saved, at its own date — not a synchronized period-end balance.', formula: 'Σ latest non-excluded cfo_snapshots.equity_cents per store',
      sources: rows.map(r => ({ system: 'Position sheet', table: `cfo_snapshots ${r.name}`, lastSync: r.created_at })),
      included: { columns: ['store', 'snapshot date', 'amount', 'assets', 'liabilities', 'saved at'], rows: rows.map(r => [r.name, r.snapshot_date, r.equity_cents, r.assets_cents, r.liabilities_cents, r.created_at]), total: rows.reduce((s, r) => s + r.equity_cents, 0), truncated: false },
      excluded: ['Stores with no snapshot (unknown, not zero)', 'Snapshots marked blocked'],
      kinds: 'manual-assisted: a snapshot freezes live feeds plus typed lines at the moment it was saved' };
  }

  if (key === 'unallocated') {
    const accts = _internals.accountsFor(db, scope);
    const { charges, movements } = unpairedOutflows(db, accts.map(a => a.id), period);
    const u = _internals.unallocatedFor(db, scope, period);
    const moved = movements.reduce((s, m) => s - m.amount_cents, 0);
    return { ...base, key, title: 'Unallocated charges', definition: 'Money that left a bank or card in the period and is paired to no store. It is in nobody\'s P&L. Card payments, transfers between our own accounts, transfers to ShipSourced and payouts are money moving, not charges, and are excluded.', formula: 'Σ unpaired outflows classified as charges by src/lib/cfo/movements.ts',
      sources: [{ system: 'categoriser', table: 'bank_transactions ⟕ classification_results', lastSync: u.figure.asOf }],
      included: { columns: ['date', 'institution', 'card/acct', 'description', 'amount', 'category', 'suggested store'], rows: charges.slice(0, LIMIT).map(r => [r.date, r.institution_name, r.last_four, r.description, -r.amount_cents, r.category || '', r.suggested_store_id || '']), total: u.figure.cents, truncated: charges.length > LIMIT },
      excluded: [`${movements.length} internal movements totalling $${(moved / 100).toFixed(2)}: ` + Object.entries(movements.reduce((acc: Record<string, number>, m) => { acc[m.kind] = (acc[m.kind] || 0) + 1; return acc; }, {})).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(', '), 'Shopify payouts', 'Fraud reversals'],
      kinds: 'derived from the pairing verdicts — pair a row on the Transactions page and it leaves this list' };
  }

  if (key === 'pending_payouts') {
    const rows: any[] = ids.map(sid => db.prepare(`SELECT s.name, s.platform, s.shopify_balance_cents, s.shopify_payout_cents, c.last_synced_at FROM stores s LEFT JOIN shopify_credentials c ON c.store_id = s.id WHERE s.id = ? AND s.name != 'ShipSourced' AND COALESCE(s.platform,'shopify') = 'shopify'`).get(sid)).filter(Boolean);
    return { ...base, period: null, key, title: 'Pending payouts', definition: 'Money Shopify holds for us: pending/scheduled balance plus payouts paid but not yet landed. Live on the Position sheet; here it is the last value read or typed.', formula: 'Σ (stores.shopify_balance_cents + stores.shopify_payout_cents)',
      sources: rows.map(r => ({ system: r.last_synced_at ? 'Shopify API (last read)' : 'typed on Position', table: `stores ${r.name}`, lastSync: r.last_synced_at })),
      included: { columns: ['store', 'balance', 'payout in transit', 'amount', 'last live read'], rows: rows.map(r => [r.name, r.shopify_balance_cents || 0, r.shopify_payout_cents || 0, (r.shopify_balance_cents || 0) + (r.shopify_payout_cents || 0), r.last_synced_at]), total: rows.reduce((s, r) => s + (r.shopify_balance_cents || 0) + (r.shopify_payout_cents || 0), 0), truncated: false },
      excluded: ['ShipSourced (Stripe balance lives on its Position sheet)', 'Amazon / eBay / Walmart stores (no Shopify balance)'],
      kinds: 'manual for stores without Shopify credentials; last live read otherwise' };
  }

  if (key === 'obligations') {
    const accts = _internals.accountsFor(db, scope).filter(a => a.account_type === 'credit');
    const horizon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const rows: any[] = [];
    for (const a of accts) {
      const st: any = db.prepare('SELECT min_payment_cents, statement_balance_cents, due_date, updated_at, source FROM card_statements WHERE bank_account_id = ?').get(a.id);
      if (st && st.due_date && st.due_date <= horizon) rows.push([`${a.institution_name} ··${a.last_four} minimum`, st.due_date, st.min_payment_cents || 0, st.source, st.updated_at]);
    }
    for (const sid of ids) {
      const s: any = db.prepare('SELECT name, ss_net_owed_cents, last_synced_at FROM stores WHERE id = ?').get(sid);
      if (s && s.name !== 'ShipSourced' && (s.ss_net_owed_cents || 0) > 0) rows.push([`ShipSourced balance — ${s.name}`, 'open', s.ss_net_owed_cents, 'ShipSourced sync', s.last_synced_at]);
    }
    return { ...base, period: null, key, title: 'Obligations due soon', definition: 'Card minimum payments due within 14 days (from the bank statement feed) plus open ShipSourced balances owed by stores in scope.', formula: 'Σ card_statements.min_payment_cents (due ≤ 14d) + Σ stores.ss_net_owed_cents',
      sources: [{ system: 'Plaid liabilities', table: 'card_statements', lastSync: rows.find(r => r[3] === 'plaid')?.[4] as string || null }, { system: 'ShipSourced', table: 'stores.ss_net_owed_cents', lastSync: null }],
      included: { columns: ['obligation', 'due', 'amount', 'source', 'as of'], rows, total: rows.reduce((s, r) => s + (r[2] as number), 0), truncated: false },
      excluded: ['Statements with no due date (cards without liabilities consent)', 'Full statement balances — only the minimum is a hard obligation', 'Payments already in flight'],
      kinds: 'actual from bank statements; ShipSourced balances as of the last sync' };
  }

  return null;
}
