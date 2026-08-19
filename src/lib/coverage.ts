// ── Coverage & reservation engine ────────────────────────────────────────────
// Answers "HOW is each obligation getting paid?" with one hard law:
//   ONE DOLLAR CANNOT BE PROMISED TWICE.
// Obligations (statement remainings + payroll) are funded in due-date order,
// per company, from: reserved cash first, then dated committed inflows that
// land BEFORE the recommended payment date (money arriving after the payment
// can't fund it). Scheduled-but-not-committed payouts only ever upgrade a gap
// to "funded if payout lands" — never to funded.
// Also produces the payment calendar: WHEN to pay each obligation inside a
// safety window (2 business days before due), and how much liquidity holding
// the post-statement balance preserves.

import type DatabaseType from 'better-sqlite3';
import { getIncomingCash } from '@/lib/incoming-cash';
import { getCashPosition } from '@/lib/foundation';

function pDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86400000));
}

/** due − safetyDays, rolled backward off weekends, never before today */
export function recommendedPayDate(dueDate: string, safetyDays = 2): string {
  const today = pDate();
  let t = new Date(dueDate + 'T12:00:00Z').getTime() - safetyDays * 86400000;
  let d = new Date(t);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) { t -= 86400000; d = new Date(t); }
  const iso = new Date(t).toISOString().slice(0, 10);
  return iso < today ? today : iso;
}

export interface Obligation {
  kind: 'card_statement' | 'payroll';
  id: string;
  label: string;
  company: 'ymgv' | 'shipsourced';
  amountCents: number;
  dueDate: string;
  payDate: string;               // recommended execution date (safety window)
  overdue: boolean;
  coveredBy: { source: string; cents: number; date?: string; kind: 'cash' | 'inflow' | 'expected_inflow' }[];
  coveredCents: number;
  gapCents: number;
  status: 'funded' | 'funded_if_payout_lands' | 'underfunded' | 'overdue_unfunded';
  holdNote?: string;             // "don't pay the current balance" guidance
}

export function getCoveragePlan(db: DatabaseType.Database, payPlan: any) {
  const cash = getCashPosition(db);
  const incoming = getIncomingCash(db);
  const today = pDate();
  const ssStore = 'ShipSourced';
  const co = (store: string): 'ymgv' | 'shipsourced' => (store === ssStore ? 'shipsourced' : 'ymgv');

  // ── Resources, per company. Mutated as reservations consume them. ──
  const cashPool: Record<string, number> = {
    ymgv: Math.max(0, cash.ymgv?.usableCents ?? 0),
    shipsourced: Math.max(0, cash.shipsourced?.usableCents ?? 0),
  };
  // Dated inflows with remaining-unallocated balances (committed = paid/in_transit)
  const inflows = incoming.upcoming
    .filter(u => u.date >= today)
    .map(u => ({ ...u, company: co(u.store), remainingCents: u.cents, committed: u.status !== 'scheduled' }));

  // ── Obligations in due-date order (overdue first → today) ──
  const obligations: Obligation[] = [];
  for (const c of payPlan?.cards || []) {
    if (c.payMode !== 'statement' || c.stmtExpired || !(c.remainingStmtCents > 0) || !c.dueDate) continue;
    const overdue = c.dueDate < today;
    obligations.push({
      kind: 'card_statement', id: c.id,
      label: `${c.name.replace('American Express ', 'Amex ').replace('Bank of America ', 'BofA ')} ·${c.last4}`,
      company: c.company === 'shipsourced' ? 'shipsourced' : 'ymgv',
      amountCents: c.remainingStmtCents,
      dueDate: c.dueDate,
      payDate: overdue ? today : recommendedPayDate(c.dueDate),
      overdue,
      coveredBy: [], coveredCents: 0, gapCents: c.remainingStmtCents, status: 'underfunded',
      holdNote: c.postedCents > c.remainingStmtCents
        ? `pay the statement ${(c.remainingStmtCents / 100).toFixed(0)}, NOT the ${(c.postedCents / 100).toFixed(0)} balance — the extra $${((c.postedCents - c.remainingStmtCents) / 100).toFixed(0)} is post-statement spend for the next cycle`
        : undefined,
    });
  }
  for (const p of payPlan?.payroll?.items || []) {
    if (!p.due_date || p.due_date < pDate(-3)) continue;
    obligations.push({
      kind: 'payroll', id: String(p.id), label: `Payroll — ${p.label}`,
      company: p.store_name === ssStore ? 'shipsourced' : 'ymgv',
      amountCents: p.amount_cents, dueDate: p.due_date,
      payDate: p.due_date < today ? today : recommendedPayDate(p.due_date, 1),
      overdue: p.due_date < today,
      coveredBy: [], coveredCents: 0, gapCents: p.amount_cents, status: 'underfunded',
    });
  }
  obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amountCents - a.amountCents);

  // ── Sequential reservation — earliest due claims resources first ──
  const allocate = (o: Obligation, committedOnly: boolean) => {
    // 1. reserved cash
    if (o.gapCents > 0 && cashPool[o.company] > 0 && committedOnly) {
      const take = Math.min(cashPool[o.company], o.gapCents);
      cashPool[o.company] -= take;
      o.coveredBy.push({ source: 'cash reserved', cents: take, kind: 'cash' });
      o.coveredCents += take; o.gapCents -= take;
    }
    // 2. dated inflows landing on/before the pay date
    for (const inf of inflows) {
      if (o.gapCents <= 0) break;
      if (inf.company !== o.company || inf.remainingCents <= 0) continue;
      if (inf.date > o.payDate) continue;              // money after payment can't fund it
      if (committedOnly !== inf.committed) continue;
      const take = Math.min(inf.remainingCents, o.gapCents);
      inf.remainingCents -= take;
      o.coveredBy.push({ source: `${inf.store} payout ${inf.date.slice(5)}`, cents: take, date: inf.date, kind: inf.committed ? 'inflow' : 'expected_inflow' });
      o.coveredCents += take; o.gapCents -= take;
    }
  };
  for (const o of obligations) allocate(o, true);   // committed pass, in due order
  for (const o of obligations) allocate(o, false);  // expected pass fills leftover gaps

  for (const o of obligations) {
    const expectedPart = o.coveredBy.filter(c => c.kind === 'expected_inflow').reduce((s, c) => s + c.cents, 0);
    o.status = o.gapCents > 0
      ? (o.overdue ? 'overdue_unfunded' : 'underfunded')
      : expectedPart > 0 ? 'funded_if_payout_lands' : 'funded';
    // Day-by-day paydown plan — "cycle the card through": pay each reserved
    // piece the day its money exists. Cash reserved = payable today; each
    // payout funds a same-day payment when it lands. The statement walks to
    // zero in steps instead of one lump, and daily ad spend riding the card
    // stays in the NEXT cycle (post-statement) — it never inflates this plan.
    const byDate = new Map<string, { cents: number; sources: string[] }>();
    for (const cb of o.coveredBy) {
      const d = cb.kind === 'cash' ? today : (cb.date || today);
      if (!byDate.has(d)) byDate.set(d, { cents: 0, sources: [] });
      const e = byDate.get(d)!;
      e.cents += cb.cents;
      e.sources.push(cb.source);
    }
    (o as any).paydownPlan = [...byDate.entries()]
      .map(([date, v]) => ({ date, cents: v.cents, sources: v.sources }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    obligations,
    freeCashAfterReservations: { ymgv: cashPool.ymgv, shipsourced: cashPool.shipsourced },
    unallocatedInflows: inflows.filter(i => i.remainingCents > 0).map(i => ({ store: i.store, date: i.date, cents: i.remainingCents, committed: i.committed })),
    totalGapCents: obligations.reduce((s, o) => s + o.gapCents, 0),
    calendar: obligations
      .filter(o => o.amountCents > 0)
      .map(o => ({ payDate: o.payDate, dueDate: o.dueDate, label: o.label, cents: o.amountCents, status: o.status, company: o.company, holdNote: o.holdNote }))
      .sort((a, b) => a.payDate.localeCompare(b.payDate)),
  };
}

/** Dollar-traceability: how much of the 90d money the Brain actually
 *  understands (attributed to a store OR matched to an entity OR a real
 *  classification), measured in DOLLARS not row counts. */
export function getTraceability(db: DatabaseType.Database) {
  const r: any = db.prepare(`
    SELECT COALESCE(SUM(ABS(t.amount_cents)), 0) total,
           COALESCE(SUM(CASE WHEN l.store_id IS NOT NULL OR l.entity_id IS NOT NULL OR l.pair_txn_id IS NOT NULL
             OR COALESCE(l.class, 'other') NOT IN ('other') THEN ABS(t.amount_cents) ELSE 0 END), 0) tracked
    FROM bank_transactions t LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE t.status = 'posted' AND t.date >= date('now', '-90 days')
  `).get();
  const untrackedRows: any = db.prepare(`
    SELECT COUNT(*) n, COALESCE(SUM(ABS(t.amount_cents)), 0) cents
    FROM bank_transactions t LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE t.status = 'posted' AND t.date >= date('now', '-90 days')
      AND l.store_id IS NULL AND l.entity_id IS NULL AND l.pair_txn_id IS NULL
      AND COALESCE(l.class, 'other') = 'other'
  `).get();
  return {
    totalCents: r.total, trackedCents: r.tracked,
    trackedPct: r.total > 0 ? Math.round(10000 * r.tracked / r.total) / 100 : 100,
    untrackedCents: untrackedRows.cents, untrackedCount: untrackedRows.n,
  };
}
