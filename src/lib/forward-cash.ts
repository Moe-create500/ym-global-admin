// ── Forward cash — what is ABOUT to happen, per company ──────────────────────
// Consumes only authoritative facts (never recomputes them):
//   cash now        → foundation.getCashPosition (per company)
//   card targets    → transactions-intel.getPayPlan (statements, remaining, due)
//   payroll         → getPayPlan.payroll
//   payout schedule → incoming-cash.getIncomingCash (committed vs scheduled)
//   ad burn         → getPayPlan.position.ad_burn_daily (forecast label)
//
// Every event is labeled committed / expected / forecast. Assumptions are
// explicit, never silent. SAFE TO DEPLOY = the worst committed-scenario cash
// point over the horizon minus the configured operating floor — money you can
// spend on growth without a likely shortfall against known obligations.

import type DatabaseType from 'better-sqlite3';
import { getCashPosition, ensureFoundationSchema } from '@/lib/foundation';
import { getIncomingCash } from '@/lib/incoming-cash';

export type EventKind = 'committed' | 'expected' | 'forecast';
export interface FutureEvent {
  date: string;
  cents: number;            // + inflow, − outflow
  label: string;
  kind: EventKind;
  company: 'ymgv' | 'shipsourced';
}

export function ensureBrainConfig(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS brain_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))`);
}
export function getBrainConfig(db: DatabaseType.Database, key: string, fallback: number): number {
  ensureBrainConfig(db);
  const r: any = db.prepare('SELECT value FROM brain_config WHERE key = ?').get(key);
  const n = r ? Number(r.value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function pDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86400000));
}

export function getForwardCash(db: DatabaseType.Database, payPlan: any) {
  ensureFoundationSchema(db);
  const cash = getCashPosition(db);
  const incoming = getIncomingCash(db);
  const today = pDate();
  const HORIZON = 30;

  // Company of a store: ShipSourced store = shipsourced; brands = ymgv
  const ssStore = 'ShipSourced';
  const storeCo = (store: string): 'ymgv' | 'shipsourced' => (store === ssStore ? 'shipsourced' : 'ymgv');

  const events: FutureEvent[] = [];

  // Inflows: payout schedule (in_transit = committed; scheduled = expected;
  // paid-but-not-landed today = committed)
  for (const u of incoming.upcoming) {
    if (u.date < today) continue;
    events.push({
      date: u.date, cents: u.cents, company: storeCo(u.store),
      label: `Shopify payout — ${u.store}`,
      kind: u.status === 'scheduled' ? 'expected' : 'committed',
    });
  }
  // Beyond the known schedule: payout run-rate as an explicit FORECAST
  const lastKnown = incoming.upcoming.reduce((m, u) => (u.date > m ? u.date : m), today);
  if (incoming.landedDailyAvgCents > 0) {
    for (let d = 1; d <= HORIZON; d++) {
      const date = pDate(d);
      if (date <= lastKnown) continue;
      events.push({ date, cents: incoming.landedDailyAvgCents, company: 'ymgv', label: 'Payout run-rate (7d avg)', kind: 'forecast' });
    }
  }

  // Outflows: card statement remainings on their due dates (committed);
  // balance-mode cards have no deadline — informational, not projected
  for (const c of payPlan?.cards || []) {
    if (c.payMode === 'statement' && !c.stmtExpired && (c.remainingStmtCents ?? 0) > 0 && c.dueDate && c.dueDate >= today) {
      events.push({
        date: c.dueDate, cents: -c.remainingStmtCents, company: c.company === 'shipsourced' ? 'shipsourced' : 'ymgv',
        label: `${c.name} ·${c.last4} statement`, kind: 'committed',
      });
    }
  }
  // Overdue statements are due NOW — land them today
  for (const c of payPlan?.cards || []) {
    if (c.payMode === 'statement' && !c.stmtExpired && (c.remainingStmtCents ?? 0) > 0 && c.dueDate && c.dueDate < today) {
      events.push({ date: today, cents: -c.remainingStmtCents, company: c.company === 'shipsourced' ? 'shipsourced' : 'ymgv', label: `${c.name} ·${c.last4} statement (OVERDUE)`, kind: 'committed' });
    }
  }
  // Payroll (committed, dated) — payroll is YM-side unless a store maps it to SS
  for (const p of payPlan?.payroll?.items || []) {
    if (p.due_date >= today) {
      events.push({ date: p.due_date, cents: -p.amount_cents, company: p.store_name === ssStore ? 'shipsourced' : 'ymgv', label: `Payroll — ${p.label}`, kind: 'committed' });
    }
  }
  // Ad burn: real behavior projected forward (forecast) — YM side
  const adBurnDaily = payPlan?.position?.ad_burn_daily_cents || 0;
  if (adBurnDaily > 0) {
    for (let d = 1; d <= HORIZON; d++) {
      events.push({ date: pDate(d), cents: -adBurnDaily, company: 'ymgv', label: 'Ad spend run-rate', kind: 'forecast' });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  // Daily projection per company, two scenarios:
  //   committed-only (hard facts)  ·  with expected+forecast (the likely path)
  const project = (company: 'ymgv' | 'shipsourced') => {
    const start = cash[company]?.usableCents ?? 0;
    const daily: { date: string; committedCents: number; likelyCents: number }[] = [];
    let committed = start;
    let likely = start;
    for (let d = 0; d <= HORIZON; d++) {
      const date = pDate(d);
      for (const e of events) {
        if (e.company !== company || e.date !== date) continue;
        if (e.kind === 'committed') { committed += e.cents; likely += e.cents; }
        else likely += e.cents;
      }
      daily.push({ date, committedCents: committed, likelyCents: likely });
    }
    const low14 = daily.slice(0, 15).reduce((m, x) => (x.likelyCents < m.likelyCents ? x : m), daily[0]);
    const lowCommitted14 = daily.slice(0, 15).reduce((m, x) => (x.committedCents < m.committedCents ? x : m), daily[0]);
    const floor = getBrainConfig(db, `floor:${company}`, 0);
    return {
      startCents: start,
      daily,
      lowest14: { date: low14.date, cents: low14.likelyCents },
      lowestCommitted14: { date: lowCommitted14.date, cents: lowCommitted14.committedCents },
      floorCents: floor,
      // rigorous: worst committed-scenario point in 14d minus the floor
      safeToDeployCents: Math.max(0, lowCommitted14.committedCents - floor),
      assumptions: [
        `operating floor $${(floor / 100).toFixed(0)} (brain_config floor:${company}${floor === 0 ? ' — not set, assumed $0' : ''})`,
        'committed = bank statements, payroll, in-transit payouts',
        'ad spend + beyond-schedule payouts are run-rate forecasts',
        company === 'shipsourced' ? 'SS client A/R timing unknown — excluded from projection (shown separately)' : '',
      ].filter(Boolean),
    };
  };

  return {
    generatedAt: today,
    ymgv: project('ymgv'),
    shipsourced: project('shipsourced'),
    timeline: events.filter(e => e.kind !== 'forecast' && e.date <= pDate(14)).slice(0, 30),
    cashNow: { ymgv: cash.ymgv, shipsourced: cash.shipsourced },
    incomingTotals: incoming.totals,
  };
}
