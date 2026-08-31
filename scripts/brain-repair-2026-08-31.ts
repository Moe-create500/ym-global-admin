// ── REPAIR 2026-08-31 (Moe-approved) ─────────────────────────────────────────
// Three workstreams, executed in one controlled, idempotent, auditable run:
//   1. Narrow merchant rule #1 ("mohamed hussein" → owner-pull) with a
//      direction constraint; preserve the old rule disabled.
//   2. Re-attribute every transaction the broad rule corrupted (full history,
//      not a fixed window) via the system's own force rescan under the
//      already-deployed class guard.
//   3. Resolve the 12 payment-log duplicate groups from external evidence
//      (ad_payments corroboration + created_at batching); supersede proven
//      duplicates, keep proven-real, quarantine the uncorroborated.
// Safety: online DB snapshot first; every changed record's before-state is in
// brain_repair_log; invariant failures abort with non-zero exit; re-running
// skips completed steps. Nothing is ever DELETEd.
// Usage: npx tsx scripts/brain-repair-2026-08-31.ts

import fs from 'fs';
import { getDb } from '../src/lib/db';
import { runTransactionScan, ensureMerchantRules } from '../src/lib/transactions-intel';
import { runIntegrityChecks } from '../src/lib/brain-insights';
import { getPayPlan } from '../src/lib/transactions-intel';

const db = getDb();
const say = (m: string) => console.log(`[repair] ${m}`);
ensureMerchantRules(db);

db.exec(`CREATE TABLE IF NOT EXISTS brain_repair_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch TEXT NOT NULL,
  record_kind TEXT NOT NULL,
  record_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);
const logRepair = db.prepare(`INSERT INTO brain_repair_log (batch, record_kind, record_id, before_json, after_json) VALUES (?, ?, ?, ?, ?)`);
const BATCH = 'repair-2026-08-31';

// ── 0. Recoverable snapshot (online backup — safe under WAL) ─────────────────
const snapPath = 'prisma/dev.db.pre-repair-20260831.bak';
(async () => {
  if (fs.existsSync(snapPath)) {
    say(`snapshot already exists: ${snapPath} (${Math.round(fs.statSync(snapPath).size / 1e6)}MB) — keeping it`);
  } else {
    say('taking online snapshot…');
    await db.backup(snapPath);
    say(`snapshot written: ${snapPath} (${Math.round(fs.statSync(snapPath).size / 1e6)}MB)`);
  }

  // ── 1. RULE #1 — narrow with audit trail ───────────────────────────────────
  const rule1: any = db.prepare('SELECT * FROM merchant_store_rules WHERE id = 1').get();
  if (!rule1) { console.error('rule #1 not found — aborting'); process.exit(2); }
  const ssStore: any = db.prepare("SELECT id FROM stores WHERE name = 'ShipSourced'").get();
  if (rule1.enabled === 1 && rule1.pattern === 'mohamed hussein') {
    logRepair.run(BATCH, 'merchant_rule', '1', JSON.stringify(rule1), null);
    db.prepare(`UPDATE merchant_store_rules SET enabled = 0,
      note = 'DISABLED 2026-08-31 (Moe-approved repair): pattern matched INDN:MOHAMED HUSSEIN bank metadata inside Shopify payout deposits and rerouted $282k of Marroomi revenue to ShipSourced. Replaced by narrowed credit-only Zelle rule.'
      WHERE id = 1`).run();
    say('rule #1 disabled (row preserved with note)');
  } else say(`rule #1 already handled (enabled=${rule1.enabled}, pattern='${rule1.pattern}')`);

  const narrowed: any = db.prepare(`SELECT id FROM merchant_store_rules WHERE pattern = 'zelle payment from mohamed hussein'`).get();
  if (!narrowed) {
    const r = db.prepare(`INSERT INTO merchant_store_rules (pattern, store_id, class, direction, source, note)
      VALUES ('zelle payment from mohamed hussein', ?, 'owner_draw', 'credit', 'user',
        'Narrowed replacement for rule #1 (2026-08-31): owner pulls Moe Zelles out of ShipSourced. Credit-direction only; class guard already blocks payouts/payments from all merchant rules.')`)
      .run(ssStore.id);
    logRepair.run(BATCH, 'merchant_rule', String(r.lastInsertRowid), null, JSON.stringify({ pattern: 'zelle payment from mohamed hussein', store: 'ShipSourced', class: 'owner_draw', direction: 'credit' }));
    say(`narrowed rule created (id ${r.lastInsertRowid})`);
  } else say(`narrowed rule already exists (id ${narrowed.id})`);

  // ── 2. HISTORICAL REPAIR — record before-state, then full-range rescan ─────
  const victims: any[] = db.prepare(`
    SELECT l.txn_id, l.class, l.store_id, l.store_source, t.date, t.amount_cents, t.description
    FROM txn_links l JOIN bank_transactions t ON t.id = l.txn_id
    WHERE l.store_id = ? AND l.store_source = 'merchant_rule' AND l.confidence != 'manual'
      AND lower(t.description) LIKE '%mohamed hussein%'`).all(ssStore.id);
  const vCents = victims.reduce((s, v) => s + Math.abs(v.amount_cents), 0);
  const dates = victims.map(v => v.date).sort();
  say(`rule-#1 victims still attributed: ${victims.length} txns, $${(vCents / 100).toFixed(2)}, ${dates[0] || '—'} → ${dates[dates.length - 1] || '—'}`);
  const already = new Set((db.prepare(`SELECT record_id FROM brain_repair_log WHERE batch = ? AND record_kind = 'txn_link_before'`).all(BATCH) as any[]).map(r => r.record_id));
  for (const v of victims) if (!already.has(v.txn_id))
    logRepair.run(BATCH, 'txn_link_before', v.txn_id, JSON.stringify(v), null);

  // Cover the full corruption range (earliest victim 2025-11-26 ≈ 280d ago)
  // plus margin. The rescan is the system's own idempotent classifier: manual
  // links untouched, pairs preserved, sweeps + heals run first.
  say('force rescan, 450 days…');
  const scan = runTransactionScan(db, { days: 450, force: true });
  say(`rescan done: ${JSON.stringify(scan)}`);

  // After-state for every victim
  const after = db.prepare(`SELECT l.class, l.store_id, l.store_source, s.name store FROM txn_links l LEFT JOIN stores s ON s.id = l.store_id WHERE l.txn_id = ?`);
  const outcome: Record<string, number> = {};
  for (const v of victims) {
    const a: any = after.get(v.txn_id);
    logRepair.run(BATCH, 'txn_link_after', v.txn_id, null, JSON.stringify(a));
    const key = `${v.class}→${a?.store || 'UNOWNED'}/${a?.class}`;
    outcome[key] = (outcome[key] || 0) + 1;
  }
  say(`re-attribution outcomes: ${JSON.stringify(outcome)}`);

  // Invariant gate: SS-attributed payouts are corruption ONLY on YM-company
  // accounts (the wall). Payouts INTO ShipSourced's own accounts are its
  // clients paying it via Shopify/Stripe (Elvaris/Houthe/Skinco) — legitimate.
  const ssPayouts: any = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(ABS(t.amount_cents)),0) c
    FROM txn_links l JOIN bank_transactions t ON t.id = l.txn_id
    JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE l.store_id = ? AND l.class = 'shopify_payout' AND COALESCE(a.company, 'ymgv') = 'ymgv'`).get(ssStore.id);
  if (ssPayouts.n > 0) { console.error(`INVARIANT FAIL: ${ssPayouts.n} payouts ($${(ssPayouts.c / 100).toFixed(2)}) on YM accounts still attributed to ShipSourced`); process.exit(2); }
  say('invariant: zero Shopify payouts on YM accounts attributed to ShipSourced ✓');

  // ── 3. PAYMENT-LOG DUPLICATE GROUPS ────────────────────────────────────────
  // Evidence rule (deterministic):
  //   corroboration = distinct ad_payments charges, same store+amount, ±10d
  //   (N/A-dated groups have no timing evidence → uncorroborated)
  //   corroborated ≥ group size  → B: all real, keep active, annotate
  //   1 ≤ corroborated < size    → A: keep first N real, supersede the rest
  //   0 corroborated             → E: quarantine (inert but preserved+visible)
  const groups: any[] = db.prepare(`
    SELECT store_id, card_last4, date, amount_cents, COUNT(*) n
    FROM card_payments_log WHERE COALESCE(status,'active') = 'active'
    GROUP BY store_id, card_last4, date, amount_cents HAVING COUNT(*) > 1`).all();
  say(`duplicate groups still active: ${groups.length}`);
  const results: any[] = [];
  for (const g of groups) {
    const members: any[] = db.prepare(`SELECT id, created_at, notes FROM card_payments_log
      WHERE store_id = ? AND card_last4 = ? AND date = ? AND amount_cents = ? AND COALESCE(status,'active') = 'active'
      ORDER BY created_at, id`).all(g.store_id, g.card_last4, g.date, g.amount_cents);
    const corro: any = g.date === 'N/A'
      ? { n: 0 }
      : db.prepare(`SELECT COUNT(*) n FROM ad_payments WHERE store_id = ? AND amount_cents = ? AND ABS(julianday(date) - julianday(?)) <= 10`).get(g.store_id, g.amount_cents, g.date);
    const st: any = db.prepare('SELECT name FROM stores WHERE id = ?').get(g.store_id);
    const label = `${st?.name} ··${g.card_last4} ${g.date} $${(g.amount_cents / 100).toFixed(2)} ×${g.n}`;
    const mark = db.prepare(`UPDATE card_payments_log SET status = ?, resolution_note = ? WHERE id = ?`);
    if (corro.n >= g.n) {
      for (const m of members) {
        logRepair.run(BATCH, 'payment_log', m.id, JSON.stringify({ status: 'active' }), JSON.stringify({ status: 'active', cls: 'B' }));
        mark.run('active', `B (2026-08-31): ${corro.n} distinct platform charges corroborate ${g.n} entries — separate real payments`, m.id);
      }
      results.push({ group: label, cls: 'B', action: 'kept all', evidence: `${corro.n} ad_payments charges` });
    } else if (corro.n >= 1) {
      members.forEach((m, i) => {
        const dup = i >= corro.n;
        logRepair.run(BATCH, 'payment_log', m.id, JSON.stringify({ status: 'active' }), JSON.stringify({ status: dup ? 'superseded_duplicate' : 'active', cls: 'A' }));
        mark.run(dup ? 'superseded_duplicate' : 'active',
          dup ? `A (2026-08-31): only ${corro.n} platform charge(s) exist for ${g.n} entries — superseded, one economic effect kept`
              : `A (2026-08-31): the corroborated real payment (${corro.n} platform charge(s))`, m.id);
      });
      results.push({ group: label, cls: 'A', action: `kept ${corro.n}, superseded ${g.n - corro.n}`, evidence: `${corro.n} ad_payments charges` });
    } else {
      for (const m of members) {
        logRepair.run(BATCH, 'payment_log', m.id, JSON.stringify({ status: 'active' }), JSON.stringify({ status: 'unresolved_uncorroborated', cls: 'E' }));
        mark.run('unresolved_uncorroborated', `E (2026-08-31): no platform charge or bank evidence corroborates this group (${g.date === 'N/A' ? 'no date' : 'no matching records'}) — preserved, excluded from money math, awaiting evidence`, m.id);
      }
      results.push({ group: label, cls: 'E', action: 'quarantined (inert, preserved)', evidence: 'zero corroboration' });
    }
  }
  for (const r of results) say(`  ${r.cls} · ${r.group} → ${r.action} [${r.evidence}]`);

  // ── 4. FULL INVARIANT GATE + cache/state refresh ───────────────────────────
  const integ = runIntegrityChecks(db, getPayPlan(db));
  if (!integ.ok) { console.error(`INTEGRITY FAILURES: ${JSON.stringify(integ.failures)}`); process.exit(2); }
  say(`integrity: all ${integ.passed.length} checks pass ✓`);
  try {
    const { dropBrainCache } = require('../src/lib/brain-cache');
    dropBrainCache();
    const { takeBrainSnapshot } = require('../src/lib/brain-insights');
    takeBrainSnapshot(db);
  } catch (e: any) { say(`cache/snapshot refresh: ${e.message}`); }

  say('REPAIR COMPLETE');
  console.log(JSON.stringify({ victims: victims.length, victimCents: vCents, outcomes: outcome, dupeGroups: results }, null, 2));
})();
