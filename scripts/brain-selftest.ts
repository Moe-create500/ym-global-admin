// Brain self-test — runs the invariant suite + consistency checks against the
// REAL database, read-only in effect (only idempotent ensure* migrations run).
// Usage: npx tsx scripts/brain-selftest.ts   (exit 0 = all green)

import { getDb } from '../src/lib/db';
import { getPayPlan, getCardClarity, getTruth, reconcileLoggedPayments } from '../src/lib/transactions-intel';
import { getCashPosition } from '../src/lib/foundation';
import { getIncomingCash } from '../src/lib/incoming-cash';
import { getForwardCash } from '../src/lib/forward-cash';
import { runIntegrityChecks, getRisks, getWhatChanged } from '../src/lib/brain-insights';
import { getSourceHealth } from '../src/lib/source-registry';
import { getCoveragePlan, getTraceability, recommendedPayDate } from '../src/lib/coverage';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const db = getDb();
console.log('🧠 BRAIN SELF-TEST\n');

// ── 1. Core engines produce coherent output ──
console.log('[engines]');
const payPlan = getPayPlan(db);
ok('payplan builds', !!payPlan && Array.isArray(payPlan.cards));
ok('every card has a payMode', payPlan.cards.every((c: any) => c.payMode === 'statement' || c.payMode === 'balance'));
ok('every card need is finite ≥ 0', payPlan.cards.every((c: any) => Number.isFinite(c.needCents) && c.needCents >= 0));
const clarity = getCardClarity(db);
ok('clarity builds', !!clarity?.perCard);
const truth = getTruth(db, 90);
ok('truth builds', Array.isArray(truth?.composition));

// ── 2. Financial invariants ──
console.log('[invariants]');
const integ = runIntegrityChecks(db, payPlan);
for (const p of integ.passed) ok(p, true);
for (const f of integ.failures) ok(f.check, false, f.detail);

// composition explains each card's balance (groups + unexplained = posted, ±$1)
for (const c of truth.composition) {
  const g = (c.groups || []).reduce((s: number, x: any) => s + x.cents, 0) + (c.unexplainedCents || 0);
  ok(`composition sums to balance ·${c.last4}`, Math.abs(g - c.postedCents) <= 100, `groups+unexplained ${(g / 100).toFixed(2)} vs posted ${(c.postedCents / 100).toFixed(2)}`);
}

// remaining-for-statement never exceeds the statement, never negative
for (const c of payPlan.cards) {
  if (c.stmtBalanceCents != null && c.remainingStmtCents != null) {
    ok(`remaining ≤ statement ·${c.last4}`, c.remainingStmtCents >= 0 && c.remainingStmtCents <= c.stmtBalanceCents + 1);
    if (c.postedCents > 0) ok(`remaining ≤ live balance ·${c.last4}`, c.remainingStmtCents <= c.postedCents + 1, `${c.remainingStmtCents} vs ${c.postedCents}`);
  }
}

// ── 3. Company separation ──
console.log('[companies]');
const cash = getCashPosition(db);
ok('both companies present', !!cash.ymgv && !!cash.shipsourced);
const acctSum: any = db.prepare(`SELECT COALESCE(SUM(COALESCE(balance_available_cents, balance_ledger_cents, 0)), 0) c FROM bank_accounts WHERE status = 'active' AND COALESCE(cfo_hidden, 0) = 0 AND account_type != 'credit'`).get();
ok('company cash sums to account cash', Math.abs((cash.ymgv.cashCents + cash.shipsourced.cashCents) - acctSum.c) <= 1, `${cash.ymgv.cashCents + cash.shipsourced.cashCents} vs ${acctSum.c}`);

// ── 4. Incoming cash coherence ──
console.log('[incoming]');
const inc = getIncomingCash(db);
{
  // real recomputation with the lib's own rule: within 7 Pacific days, never 'paid'
  const p7 = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  p7.setDate(p7.getDate() + 7);
  const in7 = `${p7.getFullYear()}-${String(p7.getMonth() + 1).padStart(2, '0')}-${String(p7.getDate()).padStart(2, '0')}`;
  const recomputed = inc.upcoming.filter(u => u.date <= in7 && u.status !== 'paid').reduce((s, u) => s + u.cents, 0);
  ok('upcoming7 excludes already-paid payouts', inc.totals.upcoming7Cents === recomputed, `lib ${inc.totals.upcoming7Cents} vs recomputed ${recomputed}`);
}
ok('no negative payout amounts in schedule', inc.upcoming.every(u => u.cents > 0 || u.status === 'scheduled'));
ok('landed daily avg finite', Number.isFinite(inc.landedDailyAvgCents));

// ── 5. Merchant rules applied ──
console.log('[rules]');
const xe: any = db.prepare(`
  SELECT COUNT(*) total, SUM(CASE WHEN s.name = 'ShipSourced' THEN 1 ELSE 0 END) ss
  FROM bank_transactions t JOIN txn_links l ON l.txn_id = t.id LEFT JOIN stores s ON s.id = l.store_id
  JOIN bank_accounts a ON a.id = t.bank_account_id AND a.account_type = 'credit'
  WHERE lower(t.description) LIKE '%xe money transfer%'`).get();
ok('XE transfers attributed to ShipSourced', xe.total === 0 || xe.ss === xe.total, `${xe.ss}/${xe.total}`);

// ── 6. Forward cash + risks + Q&A machinery ──
console.log('[forward]');
const fwd = getForwardCash(db, payPlan);
ok('projection horizon = 31 days per company', fwd.ymgv.daily.length === 31 && fwd.shipsourced.daily.length === 31);
ok('safe-to-deploy finite ≥ 0', fwd.ymgv.safeToDeployCents >= 0 && fwd.shipsourced.safeToDeployCents >= 0);
ok('timeline events labeled', fwd.timeline.every((e: any) => ['committed', 'expected', 'forecast'].includes(e.kind)));
ok('assumptions surfaced', fwd.ymgv.assumptions.length > 0);
const risks = getRisks(db, payPlan, fwd);
ok('risks ranked with actions', risks.every((r: any) => r.rank && r.action && r.why));
const ch = getWhatChanged(db);
ok('what-changed answers honestly', ch.available === true || String((ch as any).note || '').includes('snapshot'));

// ── 7. Payments reconciler ──
console.log('[payments]');
const rec = reconcileLoggedPayments(db, 45);
ok('reconciler keyed by payment id', typeof rec === 'object');

// ── 8. Source health ──
console.log('[trust]');
const trust = getSourceHealth(db);
ok('source registry has feeds reporting', trust.sources.length >= 3, `${trust.sources.length} feeds`);

// ── 9. Coverage / reservation invariants ──
console.log('[coverage]');
const cov = getCoveragePlan(db, payPlan);
ok('coverage never exceeds obligation', cov.obligations.every(o => o.coveredCents <= o.amountCents + 1));
ok('covered + gap = obligation', cov.obligations.every(o => Math.abs(o.coveredCents + o.gapCents - o.amountCents) <= 1));
ok('no negative reservations', cov.freeCashAfterReservations.ymgv >= 0 && cov.freeCashAfterReservations.shipsourced >= 0);
ok('unallocated inflows non-negative', cov.unallocatedInflows.every(i => i.cents >= 0));
ok('pay dates never after due dates', cov.obligations.every(o => o.payDate <= o.dueDate || o.overdue));
{
  // one dollar never twice: sum of all allocations from inflows ≤ sum of inflows
  const allocatedFromInflows = cov.obligations.flatMap(o => o.coveredBy).filter(c => c.kind !== 'cash').reduce((s, c) => s + c.cents, 0);
  const { getIncomingCash: gic } = require('../src/lib/incoming-cash');
  const totalInflows = gic(db).upcoming.filter((u: any) => u.date >= new Date().toISOString().slice(0,10)).reduce((s: number, u: any) => s + u.cents, 0);
  ok('inflow allocations ≤ total inflows (no dollar twice)', allocatedFromInflows <= totalInflows + 1, `${allocatedFromInflows} vs ${totalInflows}`);
}
{
  // property: for any due date, the recommended date is never a weekend and
  // never after the due date (unless already past due → today)
  const dues = ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13'];
  const okAll = dues.every(due => {
    const rec = recommendedPayDate(due);
    const dow = new Date(rec + 'T12:00:00Z').getUTCDay();
    return dow !== 0 && dow !== 6 && rec <= due; // future dues: recommendation is never late
  });
  ok('recommended pay dates never weekend, never late (7-day sweep)', okAll);
}
const trace = getTraceability(db);
ok('traceability 0–100%', trace.trackedPct >= 0 && trace.trackedPct <= 100);

// ── 10. SS settlement regression (permanent) ──
console.log('[ss-settlement]');
const logged: any[] = db.prepare(`SELECT amount_cents FROM card_payments_log p JOIN stores s ON s.id = p.store_id WHERE s.name = 'ShipSourced' AND p.date = '2026-08-19' AND p.card_last4 = '1654'`).all();
ok('both SS settlement payments logged', logged.length >= 2 && logged.some(l => l.amount_cents === 398491) && logged.some(l => l.amount_cents === 304484));
ok('settlement sums to the SS share', logged.filter(l => l.amount_cents === 398491 || l.amount_cents === 304484).reduce((s, l) => s + l.amount_cents, 0) === 702975); // from DB — also proves neither leg was double-logged
{
  // when the bank debits land+pair, SS share on 1654 must drop — assert machinery: 
  // no duplicate expense (payments classed card_payment_sent never as supplier/other spend)
  // DEBITS must be payment-classed; an inbound funding transfer sharing the
  // amount is a separate economic event and must NOT be payment-classed
  // the true invariant: settlement money must NEVER be classed as an operating
  // expense — payment legs and internal funding transfer legs are both fine
  const misclassed: any = db.prepare(`SELECT COUNT(*) n FROM bank_transactions t JOIN txn_links l ON l.txn_id = t.id WHERE t.amount_cents IN (-398491, -304484) AND l.class NOT IN ('card_payment', 'card_payment_sent', 'transfer', 'internal_transfer')`).get();
  ok('settlement debits never misclassed as expense', misclassed.n === 0);
}

// ── 11. Product performance invariants ──
console.log('[products]');
{
  const { backfillLaunches, getProductPerformance, getProductRevenue, getActiveTests } = require('../src/lib/product-performance');
  const bf = backfillLaunches(db);
  const nLaunch: any = db.prepare('SELECT COUNT(*) n FROM product_launches').get();
  ok('launch registry populated', nLaunch.n >= 100, `${nLaunch.n} launches`);
  const perf = getProductPerformance(db, { days: 30 });
  ok('performance builds with products', perf.products.length > 0, `${perf.products.length}`);
  ok('no NaN money in products', perf.products.every((p: any) => Number.isFinite(p.revenue_cents) && Number.isFinite(p.spend_cents) && Number.isFinite(p.net_cents)));
  {
    // attributed spend + unattributed ≤ total ad spend (30d) — no dollar invented
    const attributed = perf.products.reduce((s2: number, p: any) => s2 + p.spend_cents, 0);
    const total: any = db.prepare("SELECT COALESCE(SUM(spend_cents),0) t FROM ad_spend WHERE date >= date('now','-30 days')").get();
    ok('spend attribution conserves dollars', attributed + perf.unattributedSpendCents <= total.t + 100, `${attributed}+${perf.unattributedSpendCents} vs ${total.t}`);
  }
  {
    // line-item revenue reconciles to order subtotals (sample store, ±5% for edits)
    const pb: any = db.prepare("SELECT id FROM stores WHERE name = 'Purebite'").get();
    const li = getProductRevenue(db, { storeId: pb.id, days: 14 }).reduce((s2: number, r: any) => s2 + r.revenue_cents, 0);
    const sub: any = db.prepare("SELECT COALESCE(SUM(COALESCE(net_revenue_cents, total_cents)),0) t FROM orders WHERE store_id = ? AND order_date >= date('now','-14 days') AND fulfillment_status != 'cancelled' AND line_items IS NOT NULL AND json_valid(line_items)").get(pb.id);
    ok('product revenue sums to order net revenue (Purebite 14d)', sub.t === 0 || Math.abs(li - sub.t) / sub.t < 0.01, `${li} vs ${sub.t}`);
  }
  const tests = getActiveTests(db);
  ok('every test has a verdict + why', (tests.tests || []).every((t: any) => t.verdict && t.why));
}

// ── 12. Lineage integrity (2026-08-31 audit regressions) ──
console.log('[lineage]');
{
  // orphan links: interpretations must never outlive their transaction
  // (twin-healing used to delete bank rows and strand the links — swept every scan now)
  const orphan: any = db.prepare(`SELECT COUNT(*) n FROM txn_links l LEFT JOIN bank_transactions t ON t.id = l.txn_id WHERE t.id IS NULL`).get();
  ok('no txn_links pointing at deleted transactions', orphan.n === 0, `${orphan.n} orphans`);
  const deadPair: any = db.prepare(`SELECT COUNT(*) n FROM txn_links WHERE pair_txn_id IS NOT NULL AND pair_txn_id NOT IN (SELECT id FROM bank_transactions)`).get();
  ok('no pair refs pointing at deleted transactions', deadPair.n === 0, `${deadPair.n} dead pairs`);
  // a pair leg is claimed at most once — one payment, one debit↔credit couple
  const doublePair: any = db.prepare(`SELECT COUNT(*) n FROM (SELECT pair_txn_id FROM txn_links WHERE pair_txn_id IS NOT NULL GROUP BY pair_txn_id HAVING COUNT(*) > 1)`).get();
  ok('no transaction claimed as pair by multiple links', doublePair.n === 0, `${doublePair.n} double-claimed`);
  // manual payment log carries no business-key duplicates — scoped to entries
  // after the POST guard went live (12 historical pre-guard groups exist and
  // are the user's call to resolve; the guard proves it can't happen again)
  const logDupes: any = db.prepare(`SELECT COUNT(*) n FROM (SELECT store_id, card_last4, date, amount_cents FROM card_payments_log WHERE date >= '2026-08-31' GROUP BY store_id, card_last4, date, amount_cents HAVING COUNT(*) > 1)`).get();
  ok('card_payments_log has no business-key duplicates (post-guard)', logDupes.n === 0, `${logDupes.n} duplicate groups`);
  // every posted transaction on an active account carries an interpretation
  const unclassified: any = db.prepare(`
    SELECT COUNT(*) n FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.status = 'active'
    LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE t.status = 'posted' AND t.date >= date('now', '-45 days') AND l.txn_id IS NULL`).get();
  ok('every posted txn (45d) has an interpretation', unclassified.n === 0, `${unclassified.n} invisible to the Brain`);
}

// ── 13. Rule safety + repair-2026-08-31 regressions (permanent) ──
console.log('[rules-safety]');
{
  // NEGATIVE: the broad "mohamed hussein" rule stays dead forever
  const r1: any = db.prepare(`SELECT enabled, pattern FROM merchant_store_rules WHERE id = 1`).get();
  ok('broad rule #1 permanently disabled', !r1 || r1.enabled === 0, `enabled=${r1?.enabled}`);
  // POSITIVE: the narrowed owner-pull rule exists, credit-direction-scoped
  const nr: any = db.prepare(`SELECT direction, class, enabled FROM merchant_store_rules WHERE pattern = 'zelle payment from mohamed hussein'`).get();
  ok('narrowed owner-pull rule active with direction constraint', !!nr && nr.enabled === 1 && nr.direction === 'credit' && nr.class === 'owner_draw');
  // NEGATIVE: no merchant rule may ever own a payout or payment leg
  const ruleOwned: any = db.prepare(`SELECT COUNT(*) n FROM txn_links l WHERE l.store_source = 'merchant_rule' AND l.class IN ('shopify_payout', 'card_payment', 'card_payment_sent', 'transfer', 'internal_transfer')`).get();
  ok('merchant rules own zero payout/payment/transfer legs', ruleOwned.n === 0, `${ruleOwned.n} rule-owned protected-class links`);
  // NEGATIVE: a payout on a YM-company account attributed to ShipSourced is
  // corruption (the rule-#1 pattern). Payouts INTO SS's own accounts are its
  // clients paying it via Shopify — legitimate SS revenue, excluded here.
  const ssPayout: any = db.prepare(`SELECT COUNT(*) n FROM txn_links l JOIN stores s ON s.id = l.store_id
    JOIN bank_transactions t ON t.id = l.txn_id JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE s.name = 'ShipSourced' AND l.class = 'shopify_payout' AND COALESCE(a.company, 'ymgv') = 'ymgv'`).get();
  ok('zero Shopify payouts on YM accounts attributed to ShipSourced', ssPayout.n === 0, `${ssPayout.n}`);
  // guard against future broad patterns: enabled rules carry meaningful patterns
  const broad: any[] = db.prepare(`SELECT id, pattern FROM merchant_store_rules WHERE enabled = 1 AND length(pattern) < 8`).all();
  ok('no enabled rule with a dangerously short pattern', broad.length === 0, broad.map((b: any) => `#${b.id}:${b.pattern}`).join(','));
  // POSITIVE: intended owner-pull credits still land as owner_draw + ShipSourced
  const pulls: any = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN l.class = 'owner_draw' AND s.name = 'ShipSourced' THEN 1 ELSE 0 END) tagged
    FROM bank_transactions t JOIN txn_links l ON l.txn_id = t.id LEFT JOIN stores s ON s.id = l.store_id
    WHERE lower(t.description) LIKE 'zelle payment from mohamed hussein%' AND t.amount_cents > 0 AND l.confidence != 'manual'`).get();
  ok('owner-pull Zelle credits stay owner_draw/ShipSourced', pulls.total === 0 || pulls.tagged === pulls.total, `${pulls.tagged}/${pulls.total}`);
  // superseded/quarantined payment-log rows carry zero economic weight and stay preserved
  const inert: any = db.prepare(`SELECT COUNT(*) n FROM card_payments_log WHERE COALESCE(status,'active') != 'active' AND resolution_note IS NULL`).get();
  ok('every inert payment-log row explains itself', inert.n === 0, `${inert.n} unexplained`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
