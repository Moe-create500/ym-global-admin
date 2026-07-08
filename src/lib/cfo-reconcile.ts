/**
 * CFO ↔ P&L Reconciliation Engine
 * ================================
 * The CFO dashboard reports EQUITY as a point-in-time balance sheet (Assets − Liabilities).
 * The P&L reports NET PROFIT as a flow over a date range. These two views articulate:
 *
 *     ΔEquity(t1→t2)  ==  NetProfit(t1→t2)  +  CapitalMovements  +  ReconcilingItems  +  Residual
 *
 * When a store's equity moves by a different amount than its P&L profit, the difference is
 * NOT necessarily an error — most of it is explainable: owner draws, ad/fulfillment billing
 * that lags the P&L accrual, manual balance corrections, etc. This engine peels every
 * *explainable* cause off the gap so the leftover "residual" is small, honest, and points at
 * the real problem when numbers don't tie.
 *
 * Sign convention: every reconciling item is expressed as its CONTRIBUTION to (ΔEquity − NetProfit).
 *   residual = (ΔEquity − NetProfit) − Σ(items)
 * A residual of ~0 means the balance sheet and P&L fully agree.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { matchTransactions, type MoneyFlow } from './transaction-matcher';

type DB = BetterSqlite3.Database;

// ── Known snapshot component keys. Anything outside these lists is surfaced as "unmodeled"
//    so a future balance-sheet line can never be silently dropped from the reconciliation. ──
export const ASSET_KEYS = [
  'cash_bank_cents',
  'cash_shopify_cents',
  'shopify_payout_cents',
  'reserves_cents',
  'inventory_cents',
  'loans_receivable_cents',
] as const;

export const LIABILITY_KEYS = [
  'fulfillment_owed_cents',
  'fulfillment_estimated_cents',
  'ad_spend_pending_cents',
  'fb_pending_balance_cents',
  'app_invoices_due_cents',
  'loans_payable_cents',
  'manual_cc_cents',
] as const;

// Bank-transaction category patterns that represent owner capital movements (not P&L events).
const OWNER_DRAW_PATTERNS = ['owner draw', 'owner withdraw', 'withdrawal', 'distribution', 'dividend'];
const OWNER_CONTRIB_PATTERNS = ['owner contribution', 'owner deposit', 'owner invest', 'capital injection', 'capital contribution', 'owner funding'];

export interface ReconItemDetail {
  id: string;
  date: string;
  amount_cents: number;
  description: string;
  card?: string;
  platform?: string;
  matched?: boolean;
}

export interface ReconItem {
  key: string;
  label: string;
  amount_cents: number; // contribution to (ΔEquity − NetProfit)
  kind: 'capital' | 'timing' | 'manual' | 'noncash';
  note?: string;
  details?: {
    invoices?: ReconItemDetail[];
    payments?: ReconItemDetail[];
    bank_txns?: ReconItemDetail[];
  };
}

export interface ComponentDelta {
  key: string;
  label: string;
  t1_cents: number;
  t2_cents: number;
  delta_cents: number;
}

export interface ReconResult {
  store_id: string;
  t1_snapshot_id: string;
  t2_snapshot_id: string;
  period_start: string; // first P&L date included
  period_end: string;   // last P&L date included
  period_start_ts: string; // exact snapshot timestamp (t1.created_at)
  period_end_ts: string;   // exact snapshot timestamp (t2.created_at)
  equity_t1_cents: number;
  equity_t2_cents: number;
  delta_equity_cents: number;
  net_income_cents: number;
  gap_cents: number;         // ΔEquity − NetProfit (the thing we explain)
  explained_cents: number;   // Σ items
  residual_cents: number;    // gap − explained (should be ~0)
  tolerance_cents: number;
  status: 'matched' | 'flagged' | 'insufficient_data';
  items: ReconItem[];
  asset_deltas: ComponentDelta[];
  liability_deltas: ComponentDelta[];
  pnl: { revenue: number; fulfillment: number; ad: number; fees: number; app: number; other: number; chargeback: number; net: number };
  flows: { ss_paid: number; ad_paid: number; app_paid: number; owner_draws: number; owner_contributions: number };
  flows_detail: MoneyFlow | null;
  unmodeled_keys: string[];
  drivers: { label: string; amount_cents: number }[]; // largest residual-bearing component moves
}

const HUMAN_LABEL: Record<string, string> = {
  cash_bank_cents: 'Bank cash',
  cash_shopify_cents: 'Shopify balance',
  shopify_payout_cents: 'Shopify payout (in transit)',
  reserves_cents: 'Reserves',
  inventory_cents: 'Inventory',
  loans_receivable_cents: 'Loans receivable',
  fulfillment_owed_cents: 'Fulfillment owed',
  fulfillment_estimated_cents: 'Fulfillment (estimated)',
  ad_spend_pending_cents: 'Ad invoices unpaid',
  fb_pending_balance_cents: 'FB unbilled balance',
  app_invoices_due_cents: 'App invoices due',
  loans_payable_cents: 'Loans payable',
  manual_cc_cents: 'Manual credit cards',
};

export function ensureReconcileTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cfo_reconciliations (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      t1_snapshot_id TEXT NOT NULL,
      t2_snapshot_id TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      delta_equity_cents INTEGER NOT NULL DEFAULT 0,
      net_income_cents INTEGER NOT NULL DEFAULT 0,
      gap_cents INTEGER NOT NULL DEFAULT 0,
      explained_cents INTEGER NOT NULL DEFAULT 0,
      residual_cents INTEGER NOT NULL DEFAULT 0,
      tolerance_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'matched',
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(t2_snapshot_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cfo_recon_store ON cfo_reconciliations(store_id, period_end);
  `);
}

interface SnapshotRow {
  id: string;
  store_id: string;
  snapshot_date: string;
  equity_cents: number;
  data: string | null;
  created_at: string;
}

/** Flatten a snapshot's stored data JSON into asset/liability component maps. */
function components(snap: SnapshotRow): { assets: Record<string, number>; liabilities: Record<string, number>; ok: boolean } {
  if (!snap.data) return { assets: {}, liabilities: {}, ok: false };
  try {
    const d = JSON.parse(snap.data);
    return { assets: d.assets || {}, liabilities: d.liabilities || {}, ok: !!(d.assets && d.liabilities) };
  } catch {
    return { assets: {}, liabilities: {}, ok: false };
  }
}

/** Day after a YYYY-MM-DD date (UTC-safe string math). */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function sumOwner(rows: { amount_cents: number; cat: string }[]): { draws: number; contributions: number } {
  let draws = 0;
  let contributions = 0;
  for (const r of rows) {
    const c = (r.cat || '').toLowerCase();
    if (OWNER_DRAW_PATTERNS.some(p => c.includes(p))) draws += r.amount_cents;
    else if (OWNER_CONTRIB_PATTERNS.some(p => c.includes(p))) contributions += r.amount_cents;
  }
  return { draws, contributions }; // draws are negative cents, contributions positive
}

/**
 * Reconcile two consecutive snapshots. t1 is the earlier snapshot, t2 the later.
 * Returns the full bridge. Does not write to the DB (see saveReconciliation).
 */
export function reconcile(db: DB, storeId: string, t1: SnapshotRow, t2: SnapshotRow): ReconResult {
  const c1 = components(t1);
  const c2 = components(t2);

  // Use exact snapshot timestamps for period boundaries
  const periodStartTs = t1.created_at || t1.snapshot_date;
  const periodEndTs = t2.created_at || t2.snapshot_date;

  // For date-only tables (daily_pnl), use snapshot dates
  // Include t1's date since transactions after the snapshot are real changes
  const periodStart = t1.snapshot_date;
  const periodEnd = t2.snapshot_date;

  const base: ReconResult = {
    store_id: storeId,
    t1_snapshot_id: t1.id,
    t2_snapshot_id: t2.id,
    period_start: periodStart,
    period_end: periodEnd,
    period_start_ts: periodStartTs,
    period_end_ts: periodEndTs,
    equity_t1_cents: t1.equity_cents,
    equity_t2_cents: t2.equity_cents,
    delta_equity_cents: t2.equity_cents - t1.equity_cents,
    net_income_cents: 0,
    gap_cents: 0,
    explained_cents: 0,
    residual_cents: 0,
    tolerance_cents: 0,
    status: 'insufficient_data',
    items: [],
    asset_deltas: [],
    liability_deltas: [],
    pnl: { revenue: 0, fulfillment: 0, ad: 0, fees: 0, app: 0, other: 0, chargeback: 0, net: 0 },
    flows: { ss_paid: 0, ad_paid: 0, app_paid: 0, owner_draws: 0, owner_contributions: 0 },
    flows_detail: null,
    unmodeled_keys: [],
    drivers: [],
  };

  // Need both snapshots to carry full component data to reconcile component-by-component.
  if (!c1.ok || !c2.ok || periodEnd < periodStart) {
    return base;
  }

  // ── P&L over the window (dates strictly after t1's snapshot date, through t2's) ──
  const pnl: any = db.prepare(`
    SELECT
      COALESCE(SUM(revenue_cents),0) AS revenue,
      COALESCE(SUM(cogs_cents + shipping_cost_cents + pick_pack_cents + packaging_cents),0) AS fulfillment,
      COALESCE(SUM(ad_spend_cents),0) AS ad,
      COALESCE(SUM(shopify_fees_cents),0) AS fees,
      COALESCE(SUM(app_costs_cents),0) AS app,
      COALESCE(SUM(other_costs_cents),0) AS other,
      COALESCE(SUM(chargeback_cents),0) AS chargeback,
      COALESCE(SUM(net_profit_cents),0) AS net
    FROM daily_pnl WHERE store_id = ? AND date >= ? AND date <= ?
  `).get(storeId, periodStart, periodEnd);

  base.pnl = pnl;
  base.net_income_cents = pnl.net;

  // ── Exact-second boundary pro-rate (per-transaction evidence) ──
  // daily_pnl counts FULL calendar days, but snapshots are mid-day: charges made on t1's
  // date BEFORE the snapshot second belong to the PRIOR window (their cash was already in
  // t1 equity), and charges on t2's date AFTER the snapshot second belong to the NEXT one.
  // With per-second Shopify transaction data we split boundary days exactly — consecutive
  // windows share the same cut, so every dollar of profit lives in exactly one window.
  // Only the revenue−fees side is second-stamped (costs are day-billed); the accrued-net
  // used by the revenue-timing item is adjusted identically, so the residual is unchanged —
  // this fixes what the numbers SAY, attributing profit to the true window.
  let preT1Net = 0, postT2Net = 0;
  try {
    const pacDate = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts.replace(' ', 'T') + 'Z'));
    const evUploads: any[] = db.prepare(
      "SELECT rows_json FROM cfo_evidence WHERE store_id = ? AND kind = 'shopify_payments'"
    ).all(storeId);
    for (const u of evUploads) {
      let rows: any[] = [];
      try { rows = JSON.parse(u.rows_json) || []; } catch { continue; }
      for (const r of rows) {
        if (!r.ts_utc || r.net_cents == null) continue;
        if (!/charge|refund|chargeback|dispute/.test((r.type || '').toLowerCase())) continue;
        const d = pacDate(r.ts_utc);
        if (d === periodStart && r.ts_utc <= periodStartTs) preT1Net += r.net_cents;
        else if (d === periodEnd && r.ts_utc > periodEndTs) postT2Net += r.net_cents;
      }
    }
  } catch { /* no per-second evidence → full-day behavior */ }
  // Convert boundary net-revenue into a FULL component pro-rate: excluding only revenue
  // while leaving the excluded hours' day-billed costs (ads, fulfillment…) in the window
  // would understate profit (Purebite 07-03: $2,590 revenue out, $2,141 ads left in →
  // profit looked like $541 instead of ~$2,255). Every P&L component scales by that day's
  // revenue fraction, so all downstream timing items stay coherent with the same window.
  const prorateDay = (dateStr: string, boundaryNetRev: number): number => {
    if (boundaryNetRev === 0) return 0;
    const day: any = db.prepare(
      `SELECT revenue_cents AS rev, shopify_fees_cents AS fees,
              (cogs_cents + shipping_cost_cents + pick_pack_cents + packaging_cents) AS fulfillment,
              ad_spend_cents AS ad, app_costs_cents AS app, other_costs_cents AS other,
              chargeback_cents AS chargeback, net_profit_cents AS net
       FROM daily_pnl WHERE store_id = ? AND date = ?`
    ).get(storeId, dateStr);
    if (!day) return 0;
    const dayNetRev = (day.rev || 0) - (day.fees || 0);
    if (dayNetRev <= 0) return 0;
    const frac = Math.max(0, Math.min(1, boundaryNetRev / dayNetRev));
    pnl.revenue -= Math.round((day.rev || 0) * frac);
    pnl.fees -= Math.round((day.fees || 0) * frac);
    pnl.fulfillment -= Math.round((day.fulfillment || 0) * frac);
    pnl.ad -= Math.round((day.ad || 0) * frac);
    pnl.app -= Math.round((day.app || 0) * frac);
    pnl.other -= Math.round((day.other || 0) * frac);
    pnl.chargeback -= Math.round((day.chargeback || 0) * frac);
    const profitShare = Math.round((day.net || 0) * frac);
    pnl.net -= profitShare;
    return profitShare;
  };
  const preT1Profit = prorateDay(periodStart, preT1Net);
  const postT2Profit = prorateDay(periodEnd, postT2Net);
  if (preT1Profit !== 0 || postT2Profit !== 0) {
    base.net_income_cents = pnl.net;
    (base as any).boundary_prorate = {
      pre_t1_cents: preT1Profit, post_t2_cents: postT2Profit,
      pre_t1_netrev_cents: preT1Net, post_t2_netrev_cents: postT2Net,
    };
  }

  // ── Cash payments made within the window (reduce liabilities, leave bank) ──
  // Boundary-second filtering: a payment dated on t1's snapshot DATE but recorded BEFORE the
  // exact snapshot second is already inside t1's balances — counting it again double-counts
  // (e.g. Purebite 06-28: $5,982.74 SS payment at 19:27, snapshot at 20:18). Rows on boundary
  // dates only count when their created_at falls inside (ts1, ts2]; NULL created_at keeps the
  // legacy date-window behavior.
  const BOUNDARY = `AND (date != ? OR created_at IS NULL OR created_at > ?)
                    AND (date != ? OR created_at IS NULL OR created_at <= ?)`;
  const boundaryArgs = [periodStart, periodStartTs, periodEnd, periodEndTs];
  const ssPaid = (db.prepare(
    `SELECT COALESCE(SUM(amount_cents),0) AS t FROM ss_payments WHERE store_id = ? AND date >= ? AND date <= ? ${BOUNDARY}`
  ).get(storeId, periodStart, periodEnd, ...boundaryArgs) as any).t;
  // card_payments_log keeps a date-only START boundary: a log row's created_at is when it was
  // typed, not when cash moved (the 06-28 AmEx pair was logged pre-snapshot but debited 06-29),
  // and the manual-CC placeholder lines already bridge log-vs-bank timing for card payments.
  // The END boundary is exact-second, though: a payment logged AFTER t2's snapshot second
  // cannot be in this window — neither the log nor the cash existed when t2 was captured
  // (Elvris 07-06: $1,151.52 FB ACH logged 20:55:10 vs snapshot 20:43:00 inflated ad_timing
  // by the full amount). It belongs to the next window, where its balances will exist.
  const CARD_END_BOUNDARY = `AND (date != ? OR created_at IS NULL OR created_at <= ?)`;
  const adPaid = (db.prepare(
    `SELECT COALESCE(SUM(amount_cents),0) AS t FROM card_payments_log WHERE store_id = ? AND category = 'ad' AND date >= ? AND date <= ? ${CARD_END_BOUNDARY}`
  ).get(storeId, periodStart, periodEnd, periodEnd, periodEndTs) as any).t;
  const appPaid = (db.prepare(
    `SELECT COALESCE(SUM(amount_cents),0) AS t FROM card_payments_log WHERE store_id = ? AND category = 'app' AND date >= ? AND date <= ? ${CARD_END_BOUNDARY}`
  ).get(storeId, periodStart, periodEnd, periodEnd, periodEndTs) as any).t;

  // ── Owner capital movements from categorized bank transactions in the window ──
  const ownerRows = db.prepare(`
    SELECT bt.id, bt.date, bt.amount_cents AS amount_cents, COALESCE(bt.custom_category, bt.category, '') AS cat
    FROM bank_transactions bt
    JOIN bank_accounts ba ON ba.id = bt.bank_account_id
    WHERE ba.store_id = ? AND bt.date >= ? AND bt.date <= ? AND bt.date != 'N/A'
      AND (bt.date != ? OR bt.created_at IS NULL OR bt.created_at > ?)
      AND (bt.date != ? OR bt.created_at IS NULL OR bt.created_at <= ?)
  `).all(storeId, periodStart, periodEnd, ...boundaryArgs) as { id: string; date: string; amount_cents: number; cat: string }[];
  const owner = sumOwner(ownerRows);

  base.flows = { ss_paid: ssPaid, ad_paid: adPaid, app_paid: appPaid, owner_draws: owner.draws, owner_contributions: owner.contributions };

  // ── Component deltas (exact, from snapshot JSON) ──
  const dA = (k: string) => (c2.assets[k] || 0) - (c1.assets[k] || 0);
  const dL = (k: string) => (c2.liabilities[k] || 0) - (c1.liabilities[k] || 0);

  base.asset_deltas = ASSET_KEYS.map(k => ({ key: k, label: HUMAN_LABEL[k] || k, t1_cents: c1.assets[k] || 0, t2_cents: c2.assets[k] || 0, delta_cents: dA(k) }));
  base.liability_deltas = LIABILITY_KEYS.map(k => ({ key: k, label: HUMAN_LABEL[k] || k, t1_cents: c1.liabilities[k] || 0, t2_cents: c2.liabilities[k] || 0, delta_cents: dL(k) }));

  // Detect any unmodeled keys so nothing is silently ignored.
  const known = new Set<string>([...ASSET_KEYS, ...LIABILITY_KEYS, 'total_cents']);
  for (const k of Object.keys({ ...c2.assets, ...c2.liabilities })) {
    if (!known.has(k)) base.unmodeled_keys.push(k);
  }

  // ── Build reconciling items (each = contribution to ΔEquity − NetProfit) ──
  const items: ReconItem[] = [];

  if (owner.draws !== 0) {
    const drawDetails: ReconItem['details'] = {};
    // Owner draw details come from bank transactions with matching categories
    const drawTxns = ownerRows.filter(r => {
      const c = (r.cat || '').toLowerCase();
      return OWNER_DRAW_PATTERNS.some(p => c.includes(p));
    });
    if (drawTxns.length > 0) {
      drawDetails.bank_txns = drawTxns.map((t: any) => ({
        id: t.id || '', date: t.date || '', amount_cents: t.amount_cents,
        description: t.cat || 'Owner draw', matched: true,
      }));
    }
    items.push({ key: 'owner_draws', label: 'Owner draws', amount_cents: owner.draws, kind: 'capital',
      note: 'Cash withdrawn by owner — reduces equity, never a P&L expense.',
      details: drawDetails.bank_txns?.length ? drawDetails : undefined });
  }
  if (owner.contributions !== 0) {
    const contribDetails: ReconItem['details'] = {};
    const contribTxns = ownerRows.filter(r => {
      const c = (r.cat || '').toLowerCase();
      return OWNER_CONTRIB_PATTERNS.some(p => c.includes(p));
    });
    if (contribTxns.length > 0) {
      contribDetails.bank_txns = contribTxns.map((t: any) => ({
        id: t.id || '', date: t.date || '', amount_cents: t.amount_cents,
        description: t.cat || 'Owner contribution', matched: true,
      }));
    }
    items.push({ key: 'owner_contributions', label: 'Owner contributions', amount_cents: owner.contributions, kind: 'capital',
      note: 'Capital injected by owner — raises equity, not P&L income.',
      details: contribDetails.bank_txns?.length ? contribDetails : undefined });
  }

  // ── Run transaction matcher for drill-down details ──
  let flowsDetail: MoneyFlow | null = null;
  try {
    flowsDetail = matchTransactions(db, storeId, periodStart, periodEnd);
  } catch {}

  // Ad billing timing: P&L books spend from FB insights; the balance sheet records spend as
  // (Δ ad invoices unpaid + Δ FB unbilled balance + ad payments made). Any difference is timing.
  const bsAdSpend = dL('ad_spend_pending_cents') + dL('fb_pending_balance_cents') + adPaid;
  const adTiming = pnl.ad - bsAdSpend;
  if (adTiming !== 0) {
    const adDetails: ReconItem['details'] = {};
    if (flowsDetail) {
      const adFlows = flowsDetail.matched.filter(f => f.type === 'ad');
      const adUnmatched = flowsDetail.unmatched_invoices.filter(i => i.type === 'ad');
      adDetails.invoices = [
        ...adFlows.filter(f => f.invoice).map(f => ({
          id: f.invoice!.id, date: f.invoice!.date, amount_cents: f.invoice!.amount_cents,
          description: f.invoice!.description, platform: f.invoice!.platform,
          card: f.invoice!.card_last4 || '', matched: true,
        })),
        ...adUnmatched.map(i => ({
          id: i.id, date: i.date, amount_cents: i.amount_cents,
          description: i.description, platform: i.platform,
          card: i.card_last4 || '', matched: false,
        })),
      ];
      adDetails.payments = adFlows.filter(f => f.payment && 'card_last4' in f.payment).map(f => {
        const p = f.payment as any;
        return { id: p.id, date: p.date, amount_cents: p.amount_cents, description: p.method || '', card: p.card_last4 || '', matched: true };
      });
    }
    items.push({ key: 'ad_timing', label: 'Ad billing timing', amount_cents: adTiming, kind: 'timing',
      note: `P&L ad spend ${fmt(pnl.ad)} vs balance-sheet recorded ${fmt(bsAdSpend)} (invoices + unbilled + payments).`,
      details: adDetails.invoices?.length ? adDetails : undefined });
  }

  // Fulfillment billing timing: P&L COGS+shipping+pick/pack+packaging vs ShipSourced charges
  // recorded = (Δ fulfillment owed + Δ fulfillment estimated + SS payments made).
  const bsFf = dL('fulfillment_owed_cents') + dL('fulfillment_estimated_cents') + ssPaid;
  const ffTiming = pnl.fulfillment - bsFf;
  if (ffTiming !== 0) {
    const ffDetails: ReconItem['details'] = {};
    if (flowsDetail) {
      const ffFlows = flowsDetail.matched.filter(f => f.type === 'fulfillment');
      ffDetails.payments = ffFlows.filter(f => f.payment).map(f => ({
        id: f.payment!.id, date: f.payment!.date, amount_cents: f.payment!.amount_cents,
        description: 'note' in f.payment! ? (f.payment as any).note : '', matched: !!f.bank_txn,
      }));
      ffDetails.bank_txns = ffFlows.filter(f => f.bank_txn).map(f => ({
        id: f.bank_txn!.id, date: f.bank_txn!.date, amount_cents: f.bank_txn!.amount_cents,
        description: f.bank_txn!.description, matched: true,
      }));
    }
    items.push({ key: 'fulfillment_timing', label: 'Fulfillment billing timing', amount_cents: ffTiming, kind: 'timing',
      note: `P&L fulfillment ${fmt(pnl.fulfillment)} vs ShipSourced charges ${fmt(bsFf)} (billed + estimated + payments).`,
      details: ffDetails.payments?.length ? ffDetails : undefined });
  }

  // App / Shopify-app billing timing.
  const bsApp = dL('app_invoices_due_cents') + appPaid;
  const appTiming = pnl.app - bsApp;
  if (appTiming !== 0) {
    const appDetails: ReconItem['details'] = {};
    if (flowsDetail) {
      const appFlows = flowsDetail.matched.filter(f => f.type === 'app');
      const appUnmatched = flowsDetail.unmatched_invoices.filter(i => i.type === 'app');
      appDetails.invoices = [
        ...appFlows.filter(f => f.invoice).map(f => ({
          id: f.invoice!.id, date: f.invoice!.date, amount_cents: f.invoice!.amount_cents,
          description: f.invoice!.description, platform: f.invoice!.platform,
          card: f.invoice!.card_last4 || '', matched: true,
        })),
        ...appUnmatched.map(i => ({
          id: i.id, date: i.date, amount_cents: i.amount_cents,
          description: i.description, platform: i.platform,
          card: i.card_last4 || '', matched: false,
        })),
      ];
      appDetails.payments = appFlows.filter(f => f.payment && 'card_last4' in f.payment).map(f => {
        const p = f.payment as any;
        return { id: p.id, date: p.date, amount_cents: p.amount_cents, description: p.method || '', card: p.card_last4 || '', matched: true };
      });
    }
    items.push({ key: 'app_timing', label: 'App / Shopify billing timing', amount_cents: appTiming, kind: 'timing',
      note: `P&L app costs ${fmt(pnl.app)} vs app charges ${fmt(bsApp)} (invoices + payments).`,
      details: appDetails.invoices?.length ? appDetails : undefined });
  }

  // Payments in transit: a payment logged in the window (ad/app card payments, ShipSourced
  // transfers) whose cash has NOT actually left any connected bank account yet (pending
  // ACH/card settlement). The paid totals above already counted it as cash-out, but the
  // bank/equity side hasn't moved — same dollars would otherwise land in the residual
  // (and double-count against a manual credit-card placeholder typed for the same charge).
  const bankDebitCandidates = db.prepare(`
    SELECT bt.id FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id
    WHERE (ba.store_id = ? OR COALESCE(ba.is_global, 0) = 1)
      AND bt.amount_cents BETWEEN ? AND ?
      AND bt.date >= date(?, '-5 days') AND bt.date <= date(?, '+5 days')
  `);
  const loggedPayments: { id: string; date: string; amount_cents: number; description: string }[] = db.prepare(`
    SELECT id, date, amount_cents, category || ' payment *' || COALESCE(card_last4, '?') AS description
    FROM card_payments_log
    WHERE store_id = ? AND category IN ('ad','app') AND date != 'N/A' AND date >= ? AND date <= ?
      AND (date != ? OR created_at IS NULL OR created_at <= ?)
    UNION ALL
    SELECT id, date, amount_cents, 'ShipSourced payment' AS description
    FROM ss_payments
    WHERE store_id = ? AND date != 'unknown' AND date >= ? AND date <= ?
      AND (date != ? OR created_at IS NULL OR created_at > ?)
      AND (date != ? OR created_at IS NULL OR created_at <= ?)
  `).all(storeId, periodStart, periodEnd, periodEnd, periodEndTs, storeId, periodStart, periodEnd, ...boundaryArgs) as any[];
  // ^ card branch gets the same exact-second END boundary as adPaid/appPaid — a payment
  // logged after t2's snapshot second is next window's business, not this window's
  // in-transit (it would re-inject the exact amount CARD_END_BOUNDARY excludes above).
  // One-to-one matching: each bank debit can settle only ONE payment (two same-amount
  // payments must find two debits — the Purebite \$2,000 pair shares nothing).
  const usedDebits = new Set<string>();
  let settledCount = 0;
  const inTransitPayments = loggedPayments.filter(pmt => {
    const debit = -pmt.amount_cents;
    const candidates = bankDebitCandidates.all(storeId, debit - 100, debit + 100, pmt.date, pmt.date) as { id: string }[];
    const free = candidates.find(c => !usedDebits.has(c.id));
    if (free) { usedDebits.add(free.id); settledCount++; return false; }
    return true;
  });
  const inTransitCents = inTransitPayments.reduce((sum, pmt) => sum + pmt.amount_cents, 0);
  // Visibility gate: if NONE of the store's payments matched any debit, the payment rail
  // simply isn't visible in the linked bank accounts (no feed / cards elsewhere) — claiming
  // everything is "in transit" would be false. Only report when the rail is provably visible.
  if (inTransitCents !== 0 && settledCount > 0) {
    items.push({ key: 'payments_in_transit', label: 'Payments in transit (not yet bank-settled)',
      amount_cents: inTransitCents, kind: 'timing',
      note: `${fmt(inTransitCents)} of logged payments have no matching bank debit yet (pending ACH/card settlement). Cash leaves when they post — this clears itself. If you typed a manual credit-card line for the same charge, that pair now cancels instead of flagging.`,
      details: { payments: inTransitPayments.map(pmt => ({
        id: pmt.id, date: pmt.date, amount_cents: pmt.amount_cents, description: pmt.description, matched: false,
      })) } });
  }

  // Shopify revenue-to-cash timing: P&L accrues revenue daily, but cash appears as
  // (Δ Shopify balance + Δ payout-in-transit + payouts landed in the bank this window).
  // Sales whose payout hasn't landed yet make equity move LESS than profit — a real,
  // self-correcting timing gap that previously leaked into the residual.
  const storePlatform = ((db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId) as any)?.platform) || 'shopify';
  if (storePlatform !== 'amazon' && storePlatform !== 'ebay') {
    const landedPayouts = (db.prepare(`
      SELECT COALESCE(SUM(bt.amount_cents),0) AS t
      FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id
      WHERE ba.store_id = ? AND bt.amount_cents > 0 AND UPPER(bt.description) LIKE '%SHOPIFY%'
        AND bt.date >= ? AND bt.date <= ? AND bt.date != 'N/A'
        AND (bt.date != ? OR bt.created_at IS NULL OR bt.created_at > ?)
        AND (bt.date != ? OR bt.created_at IS NULL OR bt.created_at <= ?)
    `).get(storeId, periodStart, periodEnd, ...boundaryArgs) as any).t;
    // Shopify nets fees out of payouts. pnl.revenue/fees are already boundary-prorated
    // above, so this compares window-exact accrual against window-exact cash.
    const accruedNet = pnl.revenue - pnl.fees;
    const bsRevenue = dA('cash_shopify_cents') + dA('shopify_payout_cents') + landedPayouts;
    const revTiming = bsRevenue - accruedNet;
    // Only claim a revenue-timing gap when we can actually SEE the payout rail — a store with
    // no linked bank feed (landedPayouts = 0) would otherwise look like its cash never arrived.
    if (revTiming !== 0 && landedPayouts > 0) {
      items.push({ key: 'revenue_timing', label: 'Shopify revenue timing', amount_cents: revTiming, kind: 'timing',
        note: `Accrued net revenue ${fmt(accruedNet)} vs cash received ${fmt(bsRevenue)} (Δbalance + Δpayout + ${fmt(landedPayouts)} payouts landed). Self-corrects as payouts land.` });
    }
  }

  // Reserves are Shopify-internal holdbacks: money withheld FROM the store's own payout
  // pipeline ("Reserved Funds" on the payouts export). The cash comes out of the Shopify
  // balance/payout lines, so a reserve increase is NOT new equity and must never inflate
  // expected equity as a reconciling item (doing so double-counts and manufactures phantom
  // drift). The reserve delta stays inside the residual and is surfaced as a driver below,
  // where the AI investigator ties it to the payouts export's Reserved Funds rows.
  const dReserves = dA('reserves_cents');
  const dManualCC = dL('manual_cc_cents');
  if (dManualCC !== 0) {
    items.push({ key: 'manual_cc_adj', label: 'Manual credit-card adjustment', amount_cents: -dManualCC, kind: 'manual',
      note: 'Manually-entered credit-card balance change.' });
  }

  // Add owner draw/contribution details from the transaction matcher
  if (flowsDetail && owner.draws !== 0) {
    const drawTxns = flowsDetail.owner_movements.filter(m => m.type === 'draw');
    if (drawTxns.length > 0) {
      // Will be attached to the owner_draws item below
    }
  }

  base.items = items;
  base.flows_detail = flowsDetail;
  base.gap_cents = base.delta_equity_cents - base.net_income_cents;
  base.explained_cents = items.reduce((s, it) => s + it.amount_cents, 0);
  base.residual_cents = base.gap_cents - base.explained_cents;

  // Tolerance: the larger of $50 or 2% of |net income|.
  base.tolerance_cents = Math.max(5000, Math.round(Math.abs(base.net_income_cents) * 0.02));
  base.status = Math.abs(base.residual_cents) <= base.tolerance_cents ? 'matched' : 'flagged';

  // Drivers: the component moves most likely to contain an unexplained residual — the manual /
  // Teller-updated balances (bank, shopify balance, payout) plus any unmodeled key. Shown so the
  // user can eyeball where a flagged residual is hiding.
  if (base.status === 'flagged') {
    const candidates: { label: string; amount_cents: number }[] = [
      { label: 'Bank cash move', amount_cents: dA('cash_bank_cents') },
      { label: 'Shopify balance move', amount_cents: dA('cash_shopify_cents') },
      { label: 'Shopify payout move', amount_cents: dA('shopify_payout_cents') },
      { label: 'Reserves move (Shopify holdback)', amount_cents: dReserves },
      { label: 'Inventory move', amount_cents: dA('inventory_cents') },
      { label: 'Loans payable move', amount_cents: -dL('loans_payable_cents') },
      { label: 'Loans receivable move', amount_cents: dA('loans_receivable_cents') },
    ];
    base.drivers = candidates.filter(c => c.amount_cents !== 0).sort((a, b) => Math.abs(b.amount_cents) - Math.abs(a.amount_cents)).slice(0, 4);
  }

  return base;
}

function fmt(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

import crypto from 'crypto';

/** Persist a reconciliation result (one row per t2 snapshot; re-running replaces it). */
export function saveReconciliation(db: DB, r: ReconResult): void {
  ensureReconcileTable(db);
  db.prepare(`
    INSERT INTO cfo_reconciliations
      (id, store_id, t1_snapshot_id, t2_snapshot_id, period_start, period_end,
       delta_equity_cents, net_income_cents, gap_cents, explained_cents, residual_cents,
       tolerance_cents, status, result)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(t2_snapshot_id) DO UPDATE SET
      t1_snapshot_id=excluded.t1_snapshot_id, period_start=excluded.period_start, period_end=excluded.period_end,
      delta_equity_cents=excluded.delta_equity_cents, net_income_cents=excluded.net_income_cents,
      gap_cents=excluded.gap_cents, explained_cents=excluded.explained_cents, residual_cents=excluded.residual_cents,
      tolerance_cents=excluded.tolerance_cents, status=excluded.status, result=excluded.result,
      created_at=datetime('now')
  `).run(
    crypto.randomUUID(), r.store_id, r.t1_snapshot_id, r.t2_snapshot_id, r.period_start, r.period_end,
    r.delta_equity_cents, r.net_income_cents, r.gap_cents, r.explained_cents, r.residual_cents,
    r.tolerance_cents, r.status, JSON.stringify(r)
  );
}

/** Find the snapshot immediately before the given one (by created_at) for a store. */
export function priorSnapshot(db: DB, storeId: string, beforeCreatedAt: string): SnapshotRow | undefined {
  return db.prepare(`
    SELECT id, store_id, snapshot_date, equity_cents, data, created_at
    FROM cfo_snapshots
    WHERE store_id = ? AND created_at < ? AND COALESCE(excluded, 0) = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(storeId, beforeCreatedAt) as SnapshotRow | undefined;
}

/** Reconcile a snapshot against its immediate predecessor and persist. Returns the result or null. */
export function reconcileSnapshot(db: DB, storeId: string, snapshotId: string): ReconResult | null {
  const t2 = db.prepare(
    `SELECT id, store_id, snapshot_date, equity_cents, data, created_at FROM cfo_snapshots WHERE id = ?`
  ).get(snapshotId) as SnapshotRow | undefined;
  if (!t2) return null;
  const t1 = priorSnapshot(db, storeId, t2.created_at);
  if (!t1) return null;
  const result = reconcile(db, storeId, t1, t2);
  if (result.status !== 'insufficient_data') saveReconciliation(db, result);
  return result;
}
