import type DatabaseType from 'better-sqlite3';
import { type Scope, childUnits, listScopes } from './scopes';
import { type Figure, figure, missing, sumFigures, FRESH_HOURS, hoursSince } from './figures';
import { getPaymentsInFlight } from '../payments-in-flight';
import { unpairedOutflows } from './movements';
import { cardOwedCents } from '../bank-balances';

/** The CFO overview reporting service. Deterministic reads over the existing
 *  tables — nothing here writes, calls a provider, or re-derives a number the
 *  Position sheet already owns. Every figure says where it came from, when
 *  it was true, and how to drill into it (`trace`). */

export interface Period { from: string; to: string }   // inclusive YYYY-MM-DD

export interface BusinessRow {
  unit: Scope;
  revenue: Figure;
  netProfit: Figure;
  grossProfit: Figure;
  overhead: Figure;
  cash: Figure;
  cardDebt: Figure;
  netAssets: Figure;
  status: 'ok' | 'attention' | 'stale' | 'unmapped' | 'no-data';
  statusReason: string;
  issueCount: number;
}

export interface Overview {
  scope: Scope;
  period: Period;
  compare: Period;
  currency: 'USD';
  currencyNote: string;
  positionAsOf: string | null;
  performanceFor: string;
  freshness: { bank: string | null; pnl: string | null; snapshot: string | null; shipsourced: string | null; shopify: string | null };
  headline: { availableCash: Figure; pendingPayouts: Figure; obligationsDueSoon: Figure; periodProfit: Figure; periodRevenue: Figure };
  rows: BusinessRow[];
  unallocated: { figure: Figure; byAccount: { account: string; last4: string; count: number; cents: number }[]; movementsCents: number };
  totals: { revenue: Figure; netProfit: Figure; cash: Figure; netAssets: Figure };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function defaultPeriod(now = new Date()): Period {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: iso(from), to: iso(now) };
}

/** Same length, ending the day before `p.from`. */
export function priorPeriod(p: Period): Period {
  const from = new Date(p.from + 'T00:00:00Z'), to = new Date(p.to + 'T00:00:00Z');
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const cTo = new Date(from.getTime() - 86_400_000);
  const cFrom = new Date(cTo.getTime() - (days - 1) * 86_400_000);
  return { from: iso(cFrom), to: iso(cTo) };
}

interface PnlAgg { revenue: number; cogs: number; shipping: number; pick_pack: number; packaging: number; ad: number; fees: number; other: number; chargeback: number; app: number; refunds: number; net: number; est: number; orders: number; rows: number; last: string | null }

function pnlFor(db: DatabaseType.Database, storeIds: string[], p: Period): PnlAgg {
  if (!storeIds.length) return { revenue: 0, cogs: 0, shipping: 0, pick_pack: 0, packaging: 0, ad: 0, fees: 0, other: 0, chargeback: 0, app: 0, refunds: 0, net: 0, est: 0, orders: 0, rows: 0, last: null };
  const q = storeIds.map(() => '?').join(',');
  const r: any = db.prepare(`
    SELECT COALESCE(SUM(revenue_cents),0) revenue, COALESCE(SUM(cogs_cents),0) cogs, COALESCE(SUM(shipping_cost_cents),0) shipping,
           COALESCE(SUM(pick_pack_cents),0) pick_pack, COALESCE(SUM(packaging_cents),0) packaging, COALESCE(SUM(ad_spend_cents),0) ad,
           COALESCE(SUM(shopify_fees_cents),0) fees, COALESCE(SUM(other_costs_cents),0) other, COALESCE(SUM(chargeback_cents),0) chargeback,
           COALESCE(SUM(app_costs_cents),0) app, COALESCE(SUM(refunds_cents),0) refunds, COALESCE(SUM(net_profit_cents),0) net,
           COALESCE(SUM(fulfillment_est_cents),0) est, COALESCE(SUM(order_count),0) orders, COUNT(*) rows,
           MAX(COALESCE(updated_at, synced_at, created_at)) last
    FROM daily_pnl WHERE store_id IN (${q}) AND date BETWEEN ? AND ?`).get(...storeIds, p.from, p.to);
  return r;
}

function pnlFigures(db: DatabaseType.Database, unit: Scope, p: Period, c: Period, now: number, extras?: OverviewExtras) {
  const src = 'daily_pnl (order, ShipSourced, ads and invoice syncs)';
  if (unit.kind === 'warehouse' || unit.id === 'ss') {
    // ShipSourced is a 3PL: its P&L is billed revenue and direct costs per
    // warehouse from ShipSourced itself + YM's classified ledger costs.
    const pnl = extras?.ssPnl;
    const ssSrc = 'ShipSourced billing (per warehouse) + YM ledger rows classified by fulfilment line × centre';
    if (!pnl) return { revenue: missing('revenue', ssSrc, 'ShipSourced P&L not loaded'), netProfit: missing('net_profit', ssSrc, 'ShipSourced P&L not loaded'), grossProfit: missing('gross_profit', ssSrc, 'ShipSourced P&L not loaded'), overhead: missing('overhead', ssSrc, 'ShipSourced P&L not loaded'), agg: null as PnlAgg | null };
    const cen = unit.id === 'ss' ? null : pnl.centers.find(x => x.center === (unit.warehouse === 'US' ? 'CA' : 'CN'))!;
    const opex = cen ? cen.opexCents : pnl.combined.opexCents;
    const unavailable = pnl.source.shipsourced !== 'live' ? `ShipSourced feed unavailable${pnl.source.reason ? `: ${pnl.source.reason}` : ''} — revenue and direct costs unknown` : undefined;
    const asOf = pnl.source.asOf || null;
    const fig = (key: string, cents: number | null, note?: string) => cents == null ? missing(key, ssSrc, unavailable || 'unknown') : figure({ cents, asOf, source: ssSrc, trace: key, note }, now);
    const gross = cen ? cen.grossCents : (pnl.combined.revenueCents == null || pnl.combined.directCents == null ? null : pnl.combined.revenueCents - pnl.combined.directCents);
    return { revenue: fig('revenue', cen ? cen.revenueCents : pnl.combined.revenueCents), netProfit: fig('net_profit', cen ? cen.netCents : pnl.combined.netCents), grossProfit: fig('gross_profit', gross), overhead: fig('overhead', opex, `ledger costs classified to this centre incl. shared allocation ${pnl.shared.basis}`), agg: null as PnlAgg | null };
  }
  const a = pnlFor(db, unit.storeIds, p), b = pnlFor(db, unit.storeIds, c);
  if (!a.rows) {
    const note = 'no P&L rows in this period — the store has not synced, or has no orders';
    return { revenue: missing('revenue', src, note), netProfit: missing('net_profit', src, note), grossProfit: missing('gross_profit', src, note), overhead: missing('overhead', src, note), agg: a };
  }
  const gross = a.revenue - a.refunds - a.cogs - a.shipping - a.pick_pack - a.packaging;
  const grossC = b.revenue - b.refunds - b.cogs - b.shipping - b.pick_pack - b.packaging;
  const overhead = a.ad + a.fees + a.app + a.other + a.chargeback;
  const overheadC = b.ad + b.fees + b.app + b.other + b.chargeback;
  const estNote = a.est > 0 ? `provisional — ${(a.est / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} of fulfilment is still an estimate and is NOT in net profit` : undefined;
  const revenue = figure({ cents: a.revenue, asOf: a.last, source: src, trace: 'revenue', compare: b.rows ? b.revenue : null, maxAgeHours: FRESH_HOURS.pnl }, now);
  const netProfit = figure({ cents: a.net, kind: a.est > 0 ? 'estimated' : 'actual', asOf: a.last, source: src, trace: 'net_profit', compare: b.rows ? b.net : null, note: estNote, maxAgeHours: FRESH_HOURS.pnl }, now);
  return {
    revenue, netProfit,
    grossProfit: figure({ cents: gross, asOf: a.last, source: src, trace: 'gross_profit', compare: b.rows ? grossC : null, maxAgeHours: FRESH_HOURS.pnl }, now),
    overhead: figure({ cents: overhead, asOf: a.last, source: src, trace: 'overhead', compare: b.rows ? overheadC : null, note: 'ads + Shopify fees + app bills + chargebacks + other; subscriptions, payroll, rent and card interest are not in daily_pnl', maxAgeHours: FRESH_HOURS.pnl }, now),
    agg: a,
  };
}

interface Acct { id: string; store_id: string; company: string | null; account_type: string; account_name: string; institution_name: string; last_four: string; balance_available_cents: number | null; balance_ledger_cents: number | null; balance_updated_at: string | null; credit_limit_cents: number | null }

function accountsFor(db: DatabaseType.Database, unit: Scope): Acct[] {
  const all: Acct[] = db.prepare(`SELECT id, store_id, company, account_type, account_name, institution_name, last_four, balance_available_cents, balance_ledger_cents, balance_updated_at, credit_limit_cents
    FROM bank_accounts WHERE status = 'active' AND COALESCE(cfo_hidden, 0) = 0`).all() as any[];
  if (unit.id === 'all') return all;
  if (unit.kind === 'store' || unit.id === 'stores') return all.filter(a => unit.storeIds.includes(a.store_id));
  if (unit.company) return all.filter(a => a.company === unit.company || unit.storeIds.includes(a.store_id));
  return [];
}

function cashFigures(db: DatabaseType.Database, unit: Scope, now: number) {
  if (unit.kind === 'warehouse') {
    return { cash: missing('cash', 'bank_accounts', 'cash is held by the company, not by a warehouse'), cardDebt: missing('card_debt', 'bank_accounts', 'card debt is held by the company, not by a warehouse'), accounts: [] as Acct[] };
  }
  const accts = accountsFor(db, unit);
  const dep = accts.filter(a => a.account_type !== 'credit');
  const cards = accts.filter(a => a.account_type === 'credit');
  const cash = dep.length
    ? sumFigures(dep.map(a => figure({ cents: a.balance_available_cents, asOf: a.balance_updated_at, source: `${a.institution_name} ··${a.last_four}`, trace: 'cash', maxAgeHours: FRESH_HOURS.bank }, now)), 'cash', 'bank_accounts (Plaid)', { partial: true })
    : missing('cash', 'bank_accounts', unit.kind === 'store' ? 'no bank account is assigned to this store — cash lives at the company level' : 'no bank accounts in scope');
  const cardDebt = cards.length
    ? sumFigures(cards.map(a => figure({ cents: cardOwedCents(a), asOf: a.balance_updated_at, source: `${a.institution_name} ··${a.last_four}`, trace: 'card_debt', maxAgeHours: FRESH_HOURS.bank }, now)), 'card_debt', 'bank_accounts (Plaid)', { partial: true })
    : missing('card_debt', 'bank_accounts', 'no credit cards assigned in scope');
  return { cash, cardDebt, accounts: accts };
}

function netAssetsFigure(db: DatabaseType.Database, unit: Scope, now: number): Figure {
  if (unit.kind === 'warehouse') return missing('net_assets', 'cfo_snapshots', 'balance sheet is kept per business, not per warehouse');
  const parts: Figure[] = [];
  for (const sid of unit.storeIds) {
    const snap: any = db.prepare(`SELECT equity_cents, created_at, snapshot_date FROM cfo_snapshots WHERE store_id = ? AND COALESCE(excluded,0) = 0 ORDER BY created_at DESC LIMIT 1`).get(sid);
    const name = (db.prepare('SELECT name FROM stores WHERE id = ?').get(sid) as any)?.name || sid;
    parts.push(snap
      ? figure({ cents: snap.equity_cents, asOf: snap.created_at, source: `snapshot ${name} ${snap.snapshot_date}`, trace: 'net_assets', maxAgeHours: FRESH_HOURS.snapshot }, now)
      : missing('net_assets', 'cfo_snapshots', `${name}: no snapshot saved yet — open Position and save one`));
  }
  if (parts.length === 1) return parts[0];
  return sumFigures(parts, 'net_assets', 'cfo_snapshots (latest per store)', { partial: true });
}

function unallocatedFor(db: DatabaseType.Database, unit: Scope, p: Period) {
  // Outflows in the period that are paired to no store. Card payments,
  // own-account transfers, intercompany transfers and payouts are money
  // moving, not spend — one rule in movements.ts keeps every surface agreeing.
  const accts = accountsFor(db, unit);
  if (!accts.length) return { figure: missing('unallocated', 'bank_transactions', 'no accounts in scope'), byAccount: [], movementsCents: 0 };
  const { charges, movements } = unpairedOutflows(db, accts.map(a => a.id), p);
  const by = new Map<string, { account: string; last4: string; count: number; cents: number }>();
  for (const r of charges) {
    const cur = by.get(r.bank_account_id) || { account: r.account_name, last4: r.last_four, count: 0, cents: 0 };
    cur.count++; cur.cents += -r.amount_cents; by.set(r.bank_account_id, cur);
  }
  const total = charges.reduce((s, r) => s - r.amount_cents, 0);
  const q = accts.map(() => '?').join(',');
  const last: any = db.prepare(`SELECT MAX(bank_data_as_of) m FROM bank_accounts WHERE id IN (${q})`).get(...accts.map(a => a.id));
  return {
    figure: figure({ cents: total, kind: 'derived', asOf: last?.m || null, source: 'bank_transactions with no store pairing', trace: 'unallocated', note: `${charges.length} charges nobody is billed for in this period` }),
    byAccount: [...by.values()].sort((a, b) => b.cents - a.cents),
    movementsCents: movements.reduce((s, r) => s - r.amount_cents, 0),
  };
}

function pendingPayouts(db: DatabaseType.Database, unit: Scope, now: number): Figure {
  if (unit.kind === 'warehouse') return missing('pending_payouts', 'stores', 'not a payout-receiving unit');
  const parts: Figure[] = [];
  for (const sid of unit.storeIds) {
    const s: any = db.prepare(`SELECT s.name, s.platform, s.shopify_balance_cents, s.shopify_payout_cents, c.last_synced_at
      FROM stores s LEFT JOIN shopify_credentials c ON c.store_id = s.id WHERE s.id = ?`).get(sid);
    if (!s) continue;
    if (s.name === 'ShipSourced') continue; // Stripe balance is on the Position sheet (live SS feed), not stored here
    if ((s.platform || 'shopify') !== 'shopify') continue;
    const cents = (s.shopify_balance_cents || 0) + (s.shopify_payout_cents || 0);
    parts.push(s.last_synced_at
      ? figure({ cents, asOf: s.last_synced_at, source: `Shopify ${s.name} (last live read)`, trace: 'pending_payouts', maxAgeHours: FRESH_HOURS.shopify }, now)
      : figure({ cents, kind: 'manual', asOf: null, source: `Shopify ${s.name} (typed on Position)`, trace: 'pending_payouts', note: 'no Shopify credentials — value is whatever was last typed' }, now));
  }
  if (!parts.length) return missing('pending_payouts', 'Shopify', 'no Shopify stores in scope');
  return parts.length === 1 ? parts[0] : sumFigures(parts, 'pending_payouts', 'Shopify balances + payouts in transit', { partial: true });
}

function obligationsDueSoon(db: DatabaseType.Database, unit: Scope, now: number): Figure {
  if (unit.kind === 'warehouse') return missing('obligations', 'card_statements + stores', 'obligations are held by the company');
  const accts = accountsFor(db, unit).filter(a => a.account_type === 'credit');
  const parts: Figure[] = [];
  const horizon = new Date(now + 14 * 86_400_000).toISOString().slice(0, 10);
  for (const a of accts) {
    const st: any = db.prepare('SELECT min_payment_cents, statement_balance_cents, due_date, updated_at FROM card_statements WHERE bank_account_id = ?').get(a.id);
    if (!st || !st.due_date || st.due_date > horizon) continue;
    parts.push(figure({ cents: st.min_payment_cents || 0, asOf: st.updated_at, source: `${a.institution_name} ··${a.last_four} minimum due ${st.due_date}`, trace: 'obligations' }, now));
  }
  for (const sid of unit.storeIds) {
    const s: any = db.prepare('SELECT name, ss_net_owed_cents, last_synced_at FROM stores WHERE id = ?').get(sid);
    if (s && s.name !== 'ShipSourced' && (s.ss_net_owed_cents || 0) > 0) {
      parts.push(figure({ cents: s.ss_net_owed_cents, asOf: s.last_synced_at, source: `ShipSourced balance owed by ${s.name}`, trace: 'obligations', maxAgeHours: FRESH_HOURS.ss }, now));
    }
  }
  if (!parts.length) return figure({ cents: 0, kind: 'derived', asOf: new Date(now).toISOString(), source: 'card minimums due ≤14d + ShipSourced balances', trace: 'obligations', note: 'nothing due in the next 14 days from the sources we have' });
  return sumFigures(parts, 'obligations', 'card minimums due ≤14d + ShipSourced balances owed', { partial: true });
}

export interface OverviewExtras { ssPnl?: import('./ss-pnl').SsPnl | null }

export function buildRow(db: DatabaseType.Database, unit: Scope, p: Period, c: Period, issueCount: number, now: number, extras?: OverviewExtras): BusinessRow {
  const pnl = pnlFigures(db, unit, p, c, now, extras);
  const { cash, cardDebt } = cashFigures(db, unit, now);
  const netAssets = netAssetsFigure(db, unit, now);
  let status: BusinessRow['status'] = 'ok'; let statusReason = 'sources fresh';
  if (unit.mapping.status === 'unresolved') { status = 'unmapped'; statusReason = `${unit.mapping.decisions.length} mapping decisions pending`; }
  else if (pnl.revenue.kind === 'missing' && netAssets.kind === 'missing') { status = 'no-data'; statusReason = 'no P&L rows and no snapshot'; }
  else if ([pnl.revenue, cash, netAssets].some(f => f.kind === 'stale')) { status = 'stale'; statusReason = 'a source is older than its freshness window'; }
  else if (issueCount > 0 || pnl.netProfit.kind === 'estimated') { status = 'attention'; statusReason = issueCount ? `${issueCount} open issues` : 'net profit is provisional'; }
  return { unit, revenue: pnl.revenue, netProfit: pnl.netProfit, grossProfit: pnl.grossProfit, overhead: pnl.overhead, cash, cardDebt, netAssets, status, statusReason, issueCount };
}

export function getOverview(db: DatabaseType.Database, scope: Scope, period: Period, issueCountByUnit: Map<string, number>, now = Date.now(), extras?: OverviewExtras): Overview {
  const compare = priorPeriod(period);
  const units = childUnits(db, scope);
  const rows = units.map(u => buildRow(db, u, period, compare, issueCountByUnit.get(u.id) || 0, now, extras));
  const self = buildRow(db, scope, period, compare, issueCountByUnit.get(scope.id) || 0, now, extras);
  const { cash } = cashFigures(db, scope, now);
  const unalloc = unallocatedFor(db, scope, period);

  const fresh = (sql: string, ...args: any[]) => (db.prepare(sql).get(...args) as any)?.m || null;
  const storeQ = scope.storeIds.map(() => '?').join(',') || "''";
  const freshness = {
    bank: fresh(`SELECT MAX(balance_updated_at) m FROM bank_accounts WHERE status='active' AND store_id IN (${storeQ})`, ...scope.storeIds),
    pnl: fresh(`SELECT MAX(COALESCE(updated_at, synced_at)) m FROM daily_pnl WHERE store_id IN (${storeQ})`, ...scope.storeIds),
    snapshot: fresh(`SELECT MAX(created_at) m FROM cfo_snapshots WHERE COALESCE(excluded,0)=0 AND store_id IN (${storeQ})`, ...scope.storeIds),
    shipsourced: fresh(`SELECT MAX(last_synced_at) m FROM stores WHERE id IN (${storeQ})`, ...scope.storeIds),
    shopify: fresh(`SELECT MAX(last_synced_at) m FROM shopify_credentials WHERE store_id IN (${storeQ})`, ...scope.storeIds),
  };
  const positionTs = [freshness.bank, freshness.snapshot].filter(Boolean).sort();
  return {
    scope, period, compare, currency: 'USD',
    currencyNote: 'All sources report in USD. No exchange-rate table exists yet, so nothing is converted; a non-USD source would be shown unconverted and flagged.',
    positionAsOf: positionTs.length ? positionTs[0] : null,
    performanceFor: `${period.from} → ${period.to}`,
    freshness,
    headline: {
      availableCash: cash,
      pendingPayouts: pendingPayouts(db, scope, now),
      obligationsDueSoon: obligationsDueSoon(db, scope, now),
      periodProfit: self.netProfit,
      periodRevenue: self.revenue,
    },
    rows,
    unallocated: unalloc,
    totals: { revenue: self.revenue, netProfit: self.netProfit, cash, netAssets: self.netAssets },
  };
}

/** Exposed for the trace endpoint so the drilldown reads the same helpers. */
export const _internals = { pnlFor, accountsFor, unallocatedFor, listScopes, hoursSince, getPaymentsInFlight };
