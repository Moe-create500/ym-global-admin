// ── Brain insights: integrity · risk · what-changed ──────────────────────────
// The Brain checking its own homework. Invariants that must hold, risks ranked
// by money × urgency, and a daily snapshot diff that explains movement.
// Consumes authoritative facts only; every conclusion carries its evidence.

import type DatabaseType from 'better-sqlite3';

// ── FINANCIAL INTEGRITY — invariants that must hold ──────────────────────────
export function runIntegrityChecks(db: DatabaseType.Database, payPlan: any) {
  const failures: { check: string; detail: string; cents?: number }[] = [];
  const passed: string[] = [];

  // 1. Card decomposition: store shares can never exceed the card's balance
  //    (shares are net of store payments, so ≤ posted is the invariant)
  for (const c of payPlan?.cards || []) {
    const shareSum = (c.owners || []).reduce((s: number, o: any) => s + (o.owesCents || 0), 0);
    if (shareSum > c.postedCents * 1.02 + 1000) { // 2% + $10 tolerance for pending drift
      failures.push({ check: 'card_decomposition', cents: shareSum - c.postedCents, detail: `${c.name} ·${c.last4}: store shares $${(shareSum / 100).toFixed(2)} exceed card balance $${(c.postedCents / 100).toFixed(2)}` });
    }
  }
  if (!failures.some(f => f.check === 'card_decomposition')) passed.push('card decompositions ≤ balances');

  // 2. Pending/posted twins: a pending older than 3 days with an identical
  //    posted twin is a double-counted economic event
  const twins: any = db.prepare(`
    SELECT COUNT(*) n, COALESCE(SUM(ABS(p.amount_cents)), 0) cents
    FROM bank_transactions p
    WHERE p.status = 'pending' AND p.date < date('now', '-3 days') AND p.date >= date('now', '-14 days')
      AND EXISTS (SELECT 1 FROM bank_transactions q WHERE q.bank_account_id = p.bank_account_id
        AND q.status = 'posted' AND q.amount_cents = p.amount_cents
        AND ABS(julianday(q.date) - julianday(p.date)) <= 3 AND q.description = p.description)
  `).get();
  if (twins?.n > 0) failures.push({ check: 'pending_posted_twins', cents: twins.cents, detail: `${twins.n} pending transactions have identical posted twins — double-counted until the bank feed reconciles them` });
  else passed.push('no pending/posted twins in active window');

  // 3. Duplicate bank-feed ids — one bank event must exist exactly once
  const dupes: any = db.prepare(`
    SELECT COUNT(*) n FROM (SELECT teller_transaction_id FROM bank_transactions
      WHERE teller_transaction_id IS NOT NULL GROUP BY teller_transaction_id HAVING COUNT(*) > 1)
  `).get();
  if (dupes?.n > 0) failures.push({ check: 'duplicate_feed_ids', detail: `${dupes.n} bank feed ids appear on multiple rows` });
  else passed.push('bank feed ids unique');

  // 4. Money classed as revenue must never be an internal movement: a
  // shopify_payout-classed credit that is the pair leg of another transaction,
  // or whose description reads as an account transfer, would inflate income
  const pairRev: any = db.prepare(`
    SELECT COUNT(*) n FROM txn_links l JOIN bank_transactions t ON t.id = l.txn_id
    WHERE l.class = 'shopify_payout'
      AND (EXISTS (SELECT 1 FROM txn_links l2 WHERE l2.pair_txn_id = l.txn_id)
        OR LOWER(t.description) LIKE '%transfer from acct%'
        OR LOWER(t.description) LIKE '%online transfer from%')
  `).get();
  if (pairRev?.n > 0) failures.push({ check: 'transfer_as_revenue', detail: `${pairRev.n} internal transfers classed as revenue` });
  else passed.push('transfers never classed as revenue');

  // 5. Lineage integrity: every interpretation must point at a living
  // transaction — orphan links are stale opinions about money that no longer
  // exists and can silently feed store credits or pair proofs
  const orphans: any = db.prepare(`
    SELECT SUM(CASE WHEN t.id IS NULL THEN 1 ELSE 0 END) dead,
           SUM(CASE WHEN l.pair_txn_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bank_transactions p WHERE p.id = l.pair_txn_id) THEN 1 ELSE 0 END) deadPair
    FROM txn_links l LEFT JOIN bank_transactions t ON t.id = l.txn_id
  `).get();
  if ((orphans?.dead || 0) > 0 || (orphans?.deadPair || 0) > 0)
    failures.push({ check: 'orphan_links', detail: `${orphans.dead || 0} links to deleted txns, ${orphans.deadPair || 0} pair refs to deleted txns` });
  else passed.push('no orphaned interpretations');

  // 6. Company separation: money attributed to a store must not cross the
  // YM ↔ ShipSourced wall except through explicit transfer/payment classes
  const coDrift: any = db.prepare(`
    SELECT COUNT(*) n FROM txn_links l
    JOIN bank_transactions t ON t.id = l.txn_id
    JOIN bank_accounts a ON a.id = t.bank_account_id
    JOIN stores s ON s.id = l.store_id
    WHERE COALESCE(a.company, 'ymgv') != CASE WHEN s.name = 'ShipSourced' THEN 'shipsourced' ELSE 'ymgv' END
      AND l.class NOT IN ('card_payment', 'card_payment_sent', 'transfer', 'internal_transfer', 'supplier')
  `).get(); // supplier allowed: SS stock purchases ride YM cards by design (interco debt)
  if (coDrift?.n > 0) failures.push({ check: 'company_separation', detail: `${coDrift.n} attributions cross the YM↔SS wall without a transfer class` });
  else passed.push('company wall holds');

  return { ok: failures.length === 0, failures, passed };
}

// ── RISKS — ranked by money × urgency, each with a why and an action ─────────
export function getRisks(db: DatabaseType.Database, payPlan: any, forward: any) {
  const risks: { rank?: number; title: string; cents: number; urgencyDays: number | null; company: string; why: string; action: string }[] = [];

  // Overdue bank-fed statements (real lateness)
  for (const c of payPlan?.meetStatement?.overdueCards || []) {
    risks.push({
      title: `${c.name.replace('American Express ', 'Amex ')} ·${c.last4} statement OVERDUE`,
      cents: c.cents, urgencyDays: c.daysToDue, company: 'ymgv',
      why: `bank-fed statement was due ${c.dueDate} and $${(c.cents / 100).toFixed(2)} remains unpaid — late fees/interest accruing`,
      action: 'pay today or confirm autopay covered it',
    });
  }
  // Statement shortfalls: due ≤7d where committed cash at the due date goes negative
  for (const co of ['ymgv', 'shipsourced'] as const) {
    const proj = forward?.[co];
    if (!proj) continue;
    if (proj.lowestCommitted14.cents < proj.floorCents) {
      risks.push({
        title: `${co === 'ymgv' ? 'YM' : 'ShipSourced'} committed cash dips below floor`,
        cents: proj.floorCents - proj.lowestCommitted14.cents, urgencyDays: Math.max(0, Math.round((new Date(proj.lowestCommitted14.date + 'T12:00:00Z').getTime() - Date.now()) / 86400000)),
        company: co,
        why: `known obligations alone take cash to $${(proj.lowestCommitted14.cents / 100).toFixed(0)} on ${proj.lowestCommitted14.date} (floor $${(proj.floorCents / 100).toFixed(0)})`,
        action: 'delay a payment, accelerate a payout, or settle inter-company balances',
      });
    }
  }
  // Payments that left the books but the bank never took (mis-accounting risk)
  try {
    const { reconcileLoggedPayments } = require('@/lib/transactions-intel');
    const rec: Record<string, any> = reconcileLoggedPayments(db, 45);
    const logs: any[] = db.prepare(`SELECT id, amount_cents, card_last4 FROM card_payments_log WHERE date != 'N/A' AND date >= date('now', '-45 days')`).all();
    const notTaken = logs.filter(p => rec[p.id]?.status === 'not_taken');
    const cents = notTaken.reduce((s, p) => s + (p.amount_cents || 0), 0);
    if (notTaken.length > 0) {
      risks.push({
        title: `${notTaken.length} logged payment(s) never taken by the bank`,
        cents, urgencyDays: 0, company: 'ymgv',
        why: `marked paid (cards ${[...new Set(notTaken.map(p => '·' + p.card_last4))].join(' ')}) but no bank debit ever appeared — the debt is still real`,
        action: 'verify with the card issuer; re-make or unmark these payments',
      });
    }
  } catch { /* reconciler shape drift must not kill risks */ }
  // Payout anomaly: store landed payouts before but nothing in 3+ days
  const anomalies: any[] = db.prepare(`
    SELECT s.name, MAX(t.date) last_landing
    FROM txn_links l JOIN bank_transactions t ON t.id = l.txn_id JOIN stores s ON s.id = l.store_id
    WHERE l.class = 'shopify_payout' AND t.amount_cents > 0 AND t.status = 'posted'
    GROUP BY l.store_id
    HAVING last_landing < date('now', '-4 days') AND last_landing >= date('now', '-21 days')
  `).all();
  for (const a of anomalies) {
    risks.push({
      title: `${a.name} payouts stopped landing`, cents: 0, urgencyDays: 2, company: 'ymgv',
      why: `last confirmed bank landing ${a.last_landing} — payouts normally land near-daily`,
      action: 'check Shopify payout status / bank feed for this store',
    });
  }
  // Product tests burning money with no signal — the operator decides, the
  // Brain refuses to let it burn silently
  try {
    const { getActiveTests } = require('@/lib/product-performance');
    for (const t of (getActiveTests(db).tests || [])) {
      if (t.verdict === 'kill_candidate' && t.running_by_spend) {
        risks.push({
          title: `Product test failing AND still spending: ${String(t.title).slice(0, 36)} (${t.store_name})`,
          cents: t.spend_cents, urgencyDays: 1, company: 'ymgv',
          why: `${t.why} — last spend ${t.last_spend_date}`,
          action: 'pause the campaign or change creative/offer — burn continues daily until acted on',
        });
      }
    }
  } catch { /* product engine must never break risks */ }

  // Declining FB funding cards (ads die)
  for (const c of payPlan?.cards || []) {
    if (c.declining) risks.push({ title: `FB declining charges on ·${c.last4}`, cents: c.fbOwedCents || 0, urgencyDays: 0, company: 'ymgv', why: 'Facebook reports the funding card declining — ad accounts will pause', action: 'pay the card down or swap the funding card' });
  }

  risks.sort((a, b) => ((b.cents / 100) / Math.max(1, (b.urgencyDays ?? 30) + 1)) - ((a.cents / 100) / Math.max(1, (a.urgencyDays ?? 30) + 1)));
  risks.forEach((r, i) => (r.rank = i + 1));
  return risks;
}

// ── WHAT CHANGED — daily snapshots + diff ────────────────────────────────────
export function ensureSnapshots(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS brain_snapshots (
    snap_date TEXT NOT NULL, metric TEXT NOT NULL, value_cents INTEGER NOT NULL,
    PRIMARY KEY (snap_date, metric))`);
}

export function takeBrainSnapshot(db: DatabaseType.Database) {
  ensureSnapshots(db);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  const exists = db.prepare('SELECT 1 FROM brain_snapshots WHERE snap_date = ? LIMIT 1').get(today);
  if (exists) return; // one per business day
  const { getCashPosition } = require('@/lib/foundation');
  const cash = getCashPosition(db);
  const cardDebt: any = db.prepare(`SELECT COALESCE(SUM(ABS(balance_ledger_cents)), 0) c FROM bank_accounts WHERE account_type = 'credit' AND status = 'active' AND COALESCE(cfo_hidden, 0) = 0`).get();
  const fbUnbilled: any = db.prepare(`SELECT COALESCE(SUM(balance_cents), 0) c FROM fb_profiles WHERE is_active = 1 AND balance_cents > 0`).get();
  const intercoOwed: any = db.prepare(`SELECT COALESCE(SUM(ss_net_owed_cents), 0) c FROM stores WHERE is_active = 1 AND ss_net_owed_cents > 0 AND name != 'ShipSourced'`).get();
  const ins = db.prepare('INSERT OR REPLACE INTO brain_snapshots (snap_date, metric, value_cents) VALUES (?, ?, ?)');
  ins.run(today, 'cash_ymgv', cash.ymgv?.cashCents ?? 0);
  ins.run(today, 'cash_ss', cash.shipsourced?.cashCents ?? 0);
  ins.run(today, 'usable_ymgv', cash.ymgv?.usableCents ?? 0);
  ins.run(today, 'usable_ss', cash.shipsourced?.usableCents ?? 0);
  ins.run(today, 'card_debt', cardDebt?.c ?? 0);
  ins.run(today, 'fb_unbilled', fbUnbilled?.c ?? 0);
  ins.run(today, 'interco_brands_owe_ss', intercoOwed?.c ?? 0);
}

export function getWhatChanged(db: DatabaseType.Database) {
  ensureSnapshots(db);
  const dates: any[] = db.prepare('SELECT DISTINCT snap_date FROM brain_snapshots ORDER BY snap_date DESC LIMIT 2').all();
  if (dates.length < 2) return { available: false, note: 'needs two daily snapshots — first diff appears tomorrow' };
  const [cur, prev] = [dates[0].snap_date, dates[1].snap_date];
  const rows: any[] = db.prepare(`
    SELECT a.metric, a.value_cents AS now_c, b.value_cents AS prev_c
    FROM brain_snapshots a JOIN brain_snapshots b ON b.metric = a.metric AND b.snap_date = ?
    WHERE a.snap_date = ?`).all(prev, cur);
  const LABELS: Record<string, string> = {
    cash_ymgv: 'YM cash', cash_ss: 'ShipSourced cash', usable_ymgv: 'YM usable now', usable_ss: 'SS usable now',
    card_debt: 'Total card debt', fb_unbilled: 'FB unbilled', interco_brands_owe_ss: 'Brands owe ShipSourced',
  };
  return {
    available: true, from: prev, to: cur,
    changes: rows
      .map(r => ({ metric: LABELS[r.metric] || r.metric, nowCents: r.now_c, deltaCents: r.now_c - r.prev_c }))
      .filter(r => Math.abs(r.deltaCents) >= 100)
      .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents)),
  };
}
