// ── TRANSACTION SPINE HEALTH AUDIT ───────────────────────────────────────────
// Read-only. Proves, from real data, that the financial spine holds:
// every source fact represented once, one economic effect each, lineage
// intact, no dollar invisible. Non-zero exit on serious violations.
//
// Usage:
//   npx tsx scripts/brain-spine-audit.ts                 # 30d, human output
//   npx tsx scripts/brain-spine-audit.ts --days 7
//   npx tsx scripts/brain-spine-audit.ts --json          # automation
//   npx tsx scripts/brain-spine-audit.ts --company ymgv  # filter
//
// Every metric documents its numerator/denominator — no misleading percentages.

import { getDb } from '../src/lib/db';

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] || 'true') : dflt;
};
const DAYS = Math.min(Math.max(Number(opt('days', '30')) || 30, 1), 365);
const JSON_OUT = args.includes('--json');
const COMPANY = opt('company'); // ymgv | shipsourced | undefined

const db = getDb();
const d = `-${DAYS} days`;
const coWhere = COMPANY ? `AND COALESCE(a.company,'ymgv') = '${COMPANY === 'shipsourced' ? 'shipsourced' : 'ymgv'}'` : '';

const one = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any);

const report: any = { generated: null, window_days: DAYS, company: COMPANY || 'all', sections: {}, violations: [] };
const violate = (sev: 'P0' | 'P1' | 'P2', what: string, detail: string) => report.violations.push({ sev, what, detail });

// ── 1. LIFECYCLE INTEGRITY ───────────────────────────────────────────────────
{
  const total = one(`SELECT COUNT(*) n FROM bank_transactions t JOIN bank_accounts a ON a.id=t.bank_account_id WHERE t.date >= date('now', ?) ${coWhere}`, d).n;
  const pending = one(`SELECT COUNT(*) n FROM bank_transactions t JOIN bank_accounts a ON a.id=t.bank_account_id WHERE t.status='pending' AND t.date >= date('now', ?) ${coWhere}`, d).n;
  const twins = one(`SELECT COUNT(*) n, COALESCE(SUM(ABS(p.amount_cents)),0) cents FROM bank_transactions p
    WHERE p.status='pending' AND p.date < date('now','-3 days') AND p.date >= date('now', ?)
    AND EXISTS (SELECT 1 FROM bank_transactions q WHERE q.bank_account_id=p.bank_account_id AND q.status='posted'
      AND q.amount_cents=p.amount_cents AND ABS(julianday(q.date)-julianday(p.date))<=3 AND q.description=p.description)`, d);
  const dupFeedIds = one(`SELECT COUNT(*) n FROM (SELECT teller_transaction_id FROM bank_transactions WHERE teller_transaction_id IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1)`).n;
  const orphanLinks = one(`SELECT COUNT(*) n FROM txn_links l LEFT JOIN bank_transactions t ON t.id=l.txn_id WHERE t.id IS NULL`).n;
  const orphanPairs = one(`SELECT COUNT(*) n FROM txn_links l WHERE l.pair_txn_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bank_transactions t WHERE t.id=l.pair_txn_id)`).n;
  report.sections.lifecycle = {
    txns: total, pending,
    stale_pending_with_posted_twin: twins.n, twin_cents: twins.cents,
    duplicate_feed_ids: dupFeedIds, orphan_links: orphanLinks, orphan_pair_refs: orphanPairs,
    note: 'twins = double-counted economic events; feed-id dupes = one bank event, two rows',
  };
  if (twins.n > 0) violate('P0', 'pending/posted twins active', `${twins.n} twins ($${(twins.cents / 100).toFixed(2)}) double-counting`);
  if (dupFeedIds > 0) violate('P0', 'duplicate feed ids', `${dupFeedIds} bank events represented twice`);
  if (orphanLinks > 5 + Math.round(total * 0.01)) violate('P2', 'orphan links', `${orphanLinks} txn_links point at deleted transactions`);
}

// ── 2. INTERPRETATION COVERAGE (dollars, not row counts) ─────────────────────
{
  const OWNERLESS = `('other','supplier','software','shopify_app','fb_ads','google_ads','personal')`;
  const t = one(`SELECT COALESCE(SUM(ABS(t.amount_cents)),0) total,
      COALESCE(SUM(CASE WHEN l.store_id IS NOT NULL OR l.entity_id IS NOT NULL OR l.pair_txn_id IS NOT NULL
        OR COALESCE(l.class,'other') NOT IN ${OWNERLESS} THEN ABS(t.amount_cents) ELSE 0 END),0) tracked,
      COUNT(*) n,
      SUM(CASE WHEN l.txn_id IS NULL THEN 1 ELSE 0 END) unclassified
    FROM bank_transactions t JOIN bank_accounts a ON a.id=t.bank_account_id AND a.status='active'
    LEFT JOIN txn_links l ON l.txn_id=t.id
    WHERE t.status='posted' AND t.date >= date('now', ?) ${coWhere}`, d);
  report.sections.traceability = {
    numerator: 'posted $ with owner OR entity-match OR pair OR structural class',
    denominator: `all posted $ on active accounts, ${DAYS}d`,
    total_cents: t.total, tracked_cents: t.tracked,
    pct: t.total > 0 ? Math.round(10000 * t.tracked / t.total) / 100 : 100,
    unclassified_rows: t.unclassified,
  };
  if (t.unclassified > 0) violate('P1', 'unclassified transactions', `${t.unclassified} posted txns have NO txn_links row — invisible to every downstream truth`);
}

// ── 3. PAYMENT PAIRING ───────────────────────────────────────────────────────
{
  const credits = one(`SELECT COUNT(*) n, SUM(CASE WHEN l.pair_txn_id IS NOT NULL THEN 1 ELSE 0 END) paired
    FROM bank_transactions t JOIN txn_links l ON l.txn_id=t.id AND l.class='card_payment' WHERE t.date >= date('now', ?)`, d);
  const sent = one(`SELECT COUNT(*) n, SUM(CASE WHEN l.pair_txn_id IS NOT NULL THEN 1 ELSE 0 END) paired
    FROM bank_transactions t JOIN txn_links l ON l.txn_id=t.id AND l.class='card_payment_sent' WHERE t.date >= date('now', ?)`, d);
  // logged payments with no bank evidence past the settlement window
  const notTaken = one(`SELECT COUNT(*) n, COALESCE(SUM(p.amount_cents),0) cents FROM card_payments_log p
    WHERE p.date != 'N/A' AND p.date >= date('now', ?) AND p.date < date('now','-10 days')
    AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE ABS(b.amount_cents) BETWEEN p.amount_cents-100 AND p.amount_cents+100
      AND b.amount_cents < 0 AND b.date BETWEEN date(p.date,'-3 days') AND date(p.date,'+10 days'))`, d);
  report.sections.payments = {
    card_credits: credits.n, credits_paired: credits.paired,
    sent_debits: sent.n, sent_paired: sent.paired,
    note: 'unpaired ≠ broken: one side may be on a blind feed (one-sided proof covers cards)',
    logged_not_taken: notTaken.n, logged_not_taken_cents: notTaken.cents,
  };
  if (notTaken.n > 0) violate('P1', 'logged payments never taken', `${notTaken.n} ($${(notTaken.cents / 100).toFixed(2)}) marked paid, no bank debit ≥10d — debt may be misstated`);
}

// ── 4. CARD TRUTH INVARIANTS (composition = balance, remaining sane) ─────────
{
  const { getTruth, getPayPlan } = require('../src/lib/transactions-intel');
  const truth = getTruth(db, Math.max(DAYS, 90));
  let compFail = 0;
  for (const c of truth.composition) {
    const g = (c.groups || []).reduce((s: number, x: any) => s + x.cents, 0) + (c.unexplainedCents || 0);
    if (Math.abs(g - c.postedCents) > 100) compFail++;
  }
  const plan = getPayPlan(db);
  let remFail = 0, shareFail = 0;
  for (const c of plan.cards) {
    if (c.remainingStmtCents != null && c.stmtBalanceCents != null &&
        (c.remainingStmtCents < 0 || c.remainingStmtCents > c.stmtBalanceCents + 1 || c.remainingStmtCents > c.postedCents + 1)) remFail++;
    const shares = (c.owners || []).reduce((s: number, o: any) => s + o.owesCents, 0);
    if (shares > c.postedCents * 1.02 + 1000) shareFail++;
  }
  report.sections.cards = { cards: plan.cards.length, composition_failures: compFail, remaining_bound_failures: remFail, share_bound_failures: shareFail };
  if (compFail) violate('P0', 'composition ≠ balance', `${compFail} card(s) decompose to a different total than their balance`);
  if (remFail) violate('P0', 'remaining out of bounds', `${remFail} card(s) violate 0 ≤ remaining ≤ min(stmt, live)`);
  if (shareFail) violate('P0', 'shares exceed balance', `${shareFail} card(s) attribute more than they owe`);
}

// ── 5. ONE DOLLAR = ONE PROMISE (coverage conservation) ──────────────────────
{
  const { getCoveragePlan } = require('../src/lib/coverage');
  const { getPayPlan } = require('../src/lib/transactions-intel');
  const { getIncomingCash } = require('../src/lib/incoming-cash');
  const cov = getCoveragePlan(db, getPayPlan(db));
  const allocated = cov.obligations.flatMap((o: any) => o.coveredBy).filter((c: any) => c.kind !== 'cash').reduce((s: number, c: any) => s + c.cents, 0);
  const today = new Date().toISOString().slice(0, 10);
  const inflows = getIncomingCash(db).upcoming.filter((u: any) => u.date >= today).reduce((s: number, u: any) => s + u.cents, 0);
  const overCovered = cov.obligations.filter((o: any) => o.coveredCents > o.amountCents + 1).length;
  report.sections.coverage = { obligations: cov.obligations.length, inflow_allocated_cents: allocated, inflow_available_cents: inflows, over_covered: overCovered, total_gap_cents: cov.totalGapCents };
  if (allocated > inflows + 1) violate('P0', 'dollar promised twice', `allocated $${(allocated / 100).toFixed(2)} exceeds available inflows $${(inflows / 100).toFixed(2)}`);
  if (overCovered) violate('P0', 'over-covered obligation', `${overCovered} obligation(s) covered beyond their amount`);
}

// ── 6. SOURCE FRESHNESS ──────────────────────────────────────────────────────
{
  const { getSourceHealth } = require('../src/lib/source-registry');
  const h = getSourceHealth(db);
  const bad = h.sources.filter((s: any) => s.state === 'stale' || s.state === 'failing');
  report.sections.sources = { registered: h.sources.length, stale_or_failing: bad.length, detail: bad.map((b: any) => `${b.label || b.id}: ${b.state}`) };
  if (bad.length) violate('P1', 'stale/failing feeds', bad.map((b: any) => b.label || b.id).join(', '));
}

// ── OUTPUT ───────────────────────────────────────────────────────────────────
report.generated = new Date().toISOString();
const p0 = report.violations.filter((v: any) => v.sev === 'P0').length;
const p1 = report.violations.filter((v: any) => v.sev === 'P1').length;
report.verdict = p0 > 0 ? 'SPINE VIOLATED' : p1 > 0 ? 'SPINE HOLDS WITH WARNINGS' : 'SPINE HOLDS';

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`🧠 TRANSACTION SPINE HEALTH — ${DAYS}d — ${report.company}\n`);
  for (const [k, v] of Object.entries(report.sections)) {
    console.log(`[${k}]`);
    for (const [kk, vv] of Object.entries(v as any)) console.log(`  ${kk}: ${Array.isArray(vv) ? (vv as any[]).join(' | ') : vv}`);
  }
  console.log(`\nVIOLATIONS (${report.violations.length}):`);
  for (const v of report.violations) console.log(`  [${v.sev}] ${v.what} — ${v.detail}`);
  console.log(`\nVERDICT: ${report.verdict}`);
}
process.exit(p0 > 0 ? 2 : p1 > 0 ? 1 : 0);
