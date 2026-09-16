import { merchantKey, NEVER_SUBSCRIPTION } from './normalize';

/** Recurring-charge detection over real bank/card rows. Pure: no DB, no
 *  clock other than `today`. Every subscription lists the exact transaction
 *  ids that made it one, and a transaction belongs to at most one
 *  subscription, so Σ subscription totals always reconciles to the ledger.
 *
 *  Pipeline per (merchant, account):
 *   1. cluster charges into amount tiers (±12% or ±$3)
 *   2. tiers that run one after the other (not concurrently) and sit within
 *      60% of each other are ONE subscription with a price change; tiers
 *      that overlap in time are separate subscriptions from the same vendor
 *   3. a subscription needs ≥2 charges on a regular interval (weekly …
 *      yearly). Groups with ≥3 charges on a regular interval but no stable
 *      tier become one VARIABLE recurring bill, flagged Needs Review. */

export interface TxnRow {
  id: string; date: string; amount_cents: number; description: string | null; status?: string | null;
  bank_account_id: string; account_label: string; account_store_id: string | null; account_is_holding?: boolean;
  store_id: string | null; category: string | null;
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'yearly' | 'irregular';
export type SubStatus = 'active' | 'possibly_active' | 'cancelled' | 'needs_review';
export type SubFlag = 'new' | 'price_increase' | 'price_decrease' | 'possible_duplicate' | 'stopped' | 'multi_card' | 'same_vendor' | 'variable';

export interface Attribution {
  storeId: string | null;
  confidence: number;                 // 0..1
  basis: 'mapping' | 'transactions' | 'account' | 'none';
  needsAttribution: boolean;
  suggestedStoreId: string | null;
  votes: Record<string, number>;      // storeId → charge count (from pairing verdicts)
}

export interface Subscription {
  id: string;
  merchantKey: string;
  name: string;
  accountId: string;
  accountLabel: string;
  cadence: Cadence;
  intervalDays: number | null;
  regularity: number;                 // share of gaps inside the cadence band
  amountKind: 'fixed' | 'variable';
  currentAmountCents: number;
  previousAmountCents: number | null;
  priceChangePct: number | null;
  monthlyCents: number;
  annualCents: number;
  firstDate: string;
  lastDate: string;
  nextExpectedDate: string | null;
  chargeCount: number;
  totalCents: number;
  status: SubStatus;
  statusReason: string;
  attribution: Attribution;
  flags: SubFlag[];
  duplicateOf: string[];
  evidence: string[];
  txnIds: string[];
  descriptions: string[];             // distinct raw descriptions seen
}

export const CADENCE_BANDS: { name: Cadence; lo: number; hi: number; perYear: number }[] = [
  { name: 'weekly', lo: 5, hi: 9, perYear: 52 },
  { name: 'biweekly', lo: 12, hi: 16, perYear: 26 },
  { name: 'monthly', lo: 26, hi: 35, perYear: 12 },
  { name: 'bimonthly', lo: 55, hi: 70, perYear: 6 },
  { name: 'quarterly', lo: 80, hi: 100, perYear: 4 },
  { name: 'semiannual', lo: 170, hi: 200, perYear: 2 },
  { name: 'yearly', lo: 340, hi: 400, perYear: 1 },
];

const dayNum = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000);
const dayStr = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

export function cadenceOf(gaps: number[]): { cadence: Cadence; interval: number | null; regularity: number } {
  if (!gaps.length) return { cadence: 'irregular', interval: null, regularity: 0 };
  const med = median(gaps);
  const band = CADENCE_BANDS.find(b => med >= b.lo && med <= b.hi);
  if (!band) return { cadence: 'irregular', interval: med, regularity: 0 };
  const inside = gaps.filter(g => g >= band.lo * 0.8 && g <= band.hi * 1.2).length;
  return { cadence: band.name, interval: med, regularity: inside / gaps.length };
}

export function monthlyFromCadence(cents: number, cadence: Cadence, perYearFallback?: number): number {
  const band = CADENCE_BANDS.find(b => b.name === cadence);
  const perYear = band ? band.perYear : (perYearFallback || 12);
  return Math.round(cents * perYear / 12);
}

/** Excluded from detection by nature (money moving, ads, marketplaces, meals…). */
export function isCandidate(r: TxnRow): boolean {
  if (r.amount_cents >= 0) return false;
  if (r.status && r.status !== 'posted') return false;
  const cat = r.category || '';
  if (['Credit Card Payment', 'Transfer Out', 'Transfer In', 'Shopify Payout', 'Fraud Reversal', 'Ad Spend', 'Inventory', 'Owner Draw'].includes(cat) || /Ad Spend/.test(cat)) return false;
  if (NEVER_SUBSCRIPTION.test(r.description || '')) return false;
  return true;
}

interface Tier { rows: TxnRow[]; med: number }

function tiers(rows: TxnRow[]): Tier[] {
  const sorted = [...rows].sort((a, b) => Math.abs(a.amount_cents) - Math.abs(b.amount_cents));
  const out: Tier[] = [];
  for (const r of sorted) {
    const amt = Math.abs(r.amount_cents);
    const last = out[out.length - 1];
    if (last && Math.abs(amt - last.med) <= Math.max(300, last.med * 0.12)) { last.rows.push(r); last.med = median(last.rows.map(x => Math.abs(x.amount_cents))); }
    else out.push({ rows: [r], med: amt });
  }
  for (const t of out) t.rows.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Sequential tiers (one ends, the next begins) within 60% of each other are
 *  one subscription with a price change. Overlapping tiers stay separate. */
function mergeSequential(ts: Tier[]): Tier[] {
  const byStart = [...ts].sort((a, b) => a.rows[0].date.localeCompare(b.rows[0].date));
  const merged: Tier[] = [];
  for (const t of byStart) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const prevEnd = prev.rows[prev.rows.length - 1].date, start = t.rows[0].date;
      const ratio = Math.abs(t.med - prev.med) / Math.max(prev.med, 1);
      const gapDays = dayNum(start) - dayNum(prevEnd);
      if (start > prevEnd && gapDays <= 70 && ratio <= 0.6) { prev.rows.push(...t.rows); prev.rows.sort((a, b) => a.date.localeCompare(b.date)); prev.med = median(prev.rows.map(x => Math.abs(x.amount_cents))); continue; }
    }
    merged.push({ rows: [...t.rows], med: t.med });
  }
  return merged;
}

export interface DetectOptions {
  today?: string;
  mappings?: Map<string, string>;               // merchantKey → storeId (worker-assigned, remembered)
  holdingStoreIds?: Set<string>;                // stores that merely hold shared accounts — never an attribution basis
}

function attribute(rows: TxnRow[], key: string, opts: DetectOptions): Attribution {
  const votes: Record<string, number> = {};
  for (const r of rows) if (r.store_id) votes[r.store_id] = (votes[r.store_id] || 0) + 1;
  const mapped = opts.mappings?.get(key);
  if (mapped) return { storeId: mapped, confidence: 1, basis: 'mapping', needsAttribution: false, suggestedStoreId: mapped, votes };
  const total = Object.values(votes).reduce((s, n) => s + n, 0);
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (top && total >= 2 && top[1] / total >= 0.8) return { storeId: top[0], confidence: Math.min(0.95, 0.6 + 0.35 * (top[1] / rows.length)), basis: 'transactions', needsAttribution: false, suggestedStoreId: top[0], votes };
  const acct = rows[0].account_store_id;
  const holding = opts.holdingStoreIds || new Set();
  if (top) return { storeId: null, confidence: top[1] / rows.length, basis: 'transactions', needsAttribution: true, suggestedStoreId: top[0], votes };
  if (acct && !holding.has(acct) && !rows[0].account_is_holding) return { storeId: null, confidence: 0.5, basis: 'account', needsAttribution: true, suggestedStoreId: acct, votes };
  return { storeId: null, confidence: 0, basis: 'none', needsAttribution: true, suggestedStoreId: null, votes };
}

function build(key: string, name: string, rows: TxnRow[], kind: 'fixed' | 'variable', opts: DetectOptions, today: string): Subscription | null {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const days = sorted.map(r => dayNum(r.date));
  const gaps = days.slice(1).map((d, i) => d - days[i]).filter(g => g > 0);
  const c = cadenceOf(gaps);
  if (sorted.length < 2) return null;
  if (c.cadence === 'irregular' || c.regularity < 0.5) return null;
  const amounts = sorted.map(r => Math.abs(r.amount_cents));
  // Evidence thresholds: two charges only count when they are the SAME amount
  // a regular interval apart (a plan, not two purchases); weekly / biweekly
  // rhythms need four charges before they mean anything.
  if (kind === 'fixed' && sorted.length === 2 && Math.abs(amounts[0] - amounts[1]) > Math.max(100, amounts[0] * 0.03)) return null;
  if ((c.cadence === 'weekly' || c.cadence === 'biweekly') && sorted.length < 4) return null;
  const current = amounts[amounts.length - 1];
  const previous = amounts.length > 1 ? amounts[amounts.length - 2] : null;
  const pct = previous ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
  const total = amounts.reduce((s, a) => s + a, 0);
  const spanDays = Math.max(1, days[days.length - 1] - days[0]);
  const monthly = kind === 'variable' ? Math.round(total / Math.max(1, spanDays / 30.44)) : monthlyFromCadence(current, c.cadence);
  const t = dayNum(today), last = days[days.length - 1], interval = c.interval || 30;
  const overdue = (t - last) / interval;
  let status: SubStatus, reason: string;
  if (kind === 'variable') { status = 'needs_review'; reason = `amounts vary (${(Math.min(...amounts) / 100).toFixed(2)}–${(Math.max(...amounts) / 100).toFixed(2)}) on a ${c.cadence} rhythm — a recurring bill, not a fixed plan`; }
  else if (c.regularity < 0.7) { status = 'needs_review'; reason = `only ${Math.round(c.regularity * 100)}% of intervals fit a ${c.cadence} rhythm`; }
  else if (overdue <= 1.5) { status = sorted.length === 2 ? 'possibly_active' : 'active'; reason = sorted.length === 2 ? 'two charges so far — one more confirms it' : `charged ${c.cadence}, last ${sorted[sorted.length - 1].date}`; }
  else if (overdue <= 2.5) { status = 'possibly_active'; reason = `expected a charge ${Math.round((t - last) - interval)} days ago — none seen yet`; }
  else { status = 'cancelled'; reason = `no charge since ${sorted[sorted.length - 1].date} (${Math.round(t - last)} days, ${overdue.toFixed(1)} intervals)`; }
  const flags: SubFlag[] = [];
  if (kind === 'variable') flags.push('variable');
  if (status === 'cancelled') flags.push('stopped');
  if (pct != null && kind === 'fixed' && pct >= 5) flags.push('price_increase');
  if (pct != null && kind === 'fixed' && pct <= -5) flags.push('price_decrease');
  if (t - days[0] <= 60) flags.push('new');
  return {
    id: `sub:${key}:${sorted[0].bank_account_id}:${sorted[0].id}`,
    merchantKey: key, name, accountId: sorted[0].bank_account_id, accountLabel: sorted[0].account_label,
    cadence: c.cadence, intervalDays: c.interval, regularity: Math.round(c.regularity * 100) / 100, amountKind: kind,
    currentAmountCents: current, previousAmountCents: previous, priceChangePct: pct,
    monthlyCents: monthly, annualCents: monthly * 12,
    firstDate: sorted[0].date, lastDate: sorted[sorted.length - 1].date,
    nextExpectedDate: status === 'cancelled' ? null : dayStr(last + interval),
    chargeCount: sorted.length, totalCents: total, status, statusReason: reason,
    attribution: attribute(sorted, key, opts), flags, duplicateOf: [], evidence: [],
    txnIds: sorted.map(r => r.id), descriptions: [...new Set(sorted.map(r => (r.description || '').trim()))].slice(0, 6),
  };
}

export function detectSubscriptions(rows: TxnRow[], opts: DetectOptions = {}): Subscription[] {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const groups = new Map<string, { name: string; rows: TxnRow[] }>();
  for (const r of rows) {
    if (!isCandidate(r)) continue;
    const mk = merchantKey(r.description);
    if (!mk) continue;
    const gk = `${mk.key}|${r.bank_account_id}`;
    const g = groups.get(gk) || { name: mk.display, rows: [] };
    g.rows.push(r); groups.set(gk, g);
  }
  const subs: Subscription[] = [];
  for (const [gk, g] of groups) {
    const key = gk.split('|')[0];
    const merged = mergeSequential(tiers(g.rows));
    const found: Subscription[] = [];
    for (const t of merged) { const s = build(key, g.name, t.rows, 'fixed', opts, today); if (s) found.push(s); }
    if (found.length) {
      if (found.length > 1) for (const s of found) { s.flags.push('same_vendor'); s.evidence.push(`${found.length} separate plans from ${g.name} on this account (different amounts, overlapping in time)`); }
      subs.push(...found);
      continue;
    }
    if (g.rows.length >= 3) { const v = build(key, g.name, g.rows, 'variable', opts, today); if (v) subs.push(v); }
  }
  // Duplicates: same vendor, overlapping active periods, on different accounts or stores.
  const byKey = new Map<string, Subscription[]>();
  for (const s of subs) { const l = byKey.get(s.merchantKey) || []; l.push(s); byKey.set(s.merchantKey, l); }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    for (const a of list) for (const b of list) {
      if (a === b || a.accountId === b.accountId) continue;
      const overlap = a.firstDate <= b.lastDate && b.firstDate <= a.lastDate;
      if (!overlap || a.status === 'cancelled' || b.status === 'cancelled') continue;
      if (!a.flags.includes('possible_duplicate')) a.flags.push('possible_duplicate');
      if (!a.flags.includes('multi_card')) a.flags.push('multi_card');
      a.duplicateOf.push(b.id);
      const sameStore = a.attribution.storeId && a.attribution.storeId === b.attribution.storeId;
      a.evidence.push(`${b.name} also billed on ${b.accountLabel} (${(b.currentAmountCents / 100).toFixed(2)} ${b.cadence}, ${b.firstDate} → ${b.lastDate})${sameStore ? ' for the same store' : b.attribution.storeId ? ' for a different store' : ' with no store assigned'}`);
    }
  }
  return subs.sort((a, b) => b.monthlyCents - a.monthlyCents);
}

/** Σ subscription totals must equal Σ of their source rows, and no row may
 *  belong to two subscriptions. Returns the discrepancies (empty = reconciled). */
export function reconcile(subs: Subscription[], rows: TxnRow[]): string[] {
  const problems: string[] = [];
  const byId = new Map(rows.map(r => [r.id, r]));
  const seen = new Map<string, string>();
  for (const s of subs) {
    let sum = 0;
    for (const id of s.txnIds) {
      const r = byId.get(id);
      if (!r) { problems.push(`${s.id}: source row ${id} not in ledger`); continue; }
      if (seen.has(id)) problems.push(`row ${id} in both ${seen.get(id)} and ${s.id}`);
      seen.set(id, s.id);
      sum += Math.abs(r.amount_cents);
    }
    if (sum !== s.totalCents) problems.push(`${s.id}: total ${s.totalCents} ≠ Σ rows ${sum}`);
    if (s.chargeCount !== s.txnIds.length) problems.push(`${s.id}: chargeCount ${s.chargeCount} ≠ ${s.txnIds.length} rows`);
  }
  return problems;
}
