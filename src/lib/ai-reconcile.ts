/**
 * AI Reconciliation Investigator
 * ==============================
 * When the deterministic CFO ↔ P&L reconciliation engine (cfo-reconcile.ts) leaves an
 * unexplained residual, this module hands the case to Claude (Fable 5): it gathers every
 * piece of financial evidence recorded between the two snapshot timestamps — bank
 * transactions, payment logs, P&L rows, activity/sync logs, manual entries, snapshot
 * component data — and asks the model to explain the residual line by line, citing the
 * exact rows it used.
 *
 * The evidence window uses the EXACT snapshot timestamps (t1.created_at → t2.created_at)
 * for timestamped tables, and snapshot dates for date-only tables; each evidence section
 * is annotated with which boundary basis it uses so the model can reason about edge
 * effects at the boundaries.
 */

import Anthropic from '@anthropic-ai/sdk';
import type BetterSqlite3 from 'better-sqlite3';
import crypto from 'crypto';
import type { ReconResult } from './cfo-reconcile';

type DB = BetterSqlite3.Database;

const MODEL = 'claude-fable-5';
const FALLBACK_MODEL = 'claude-opus-4-8';
const MAX_ROWS_PER_SECTION = 400;

export interface AiCause {
  title: string;
  amount_cents: number;
  category: 'timing' | 'capital' | 'data_bug' | 'double_count' | 'missing_data' | 'unknown';
  explanation: string;
  evidence: string[];
  fix: string;
}

export interface AiAnalysis {
  verdict: string;
  confidence: 'high' | 'medium' | 'low';
  residual_cents: number;
  causes: AiCause[];
  unexplained_remaining_cents: number;
  data_quality_issues: string[];
  recommended_actions: string[];
  raw_text?: string; // populated only if JSON parsing failed
}

export function ensureEvidenceTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cfo_evidence (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      reconciliation_id TEXT,
      kind TEXT NOT NULL,
      filename TEXT,
      headers_json TEXT,
      rows_json TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      min_ts TEXT,
      max_ts TEXT,
      sum_amount_cents INTEGER,
      sum_net_cents INTEGER,
      note TEXT,
      warnings TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cfo_evidence_store ON cfo_evidence(store_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_cfo_evidence_recon ON cfo_evidence(reconciliation_id);
  `);
}

export function ensureAiAnalysisTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cfo_ai_analyses (
      id TEXT PRIMARY KEY,
      reconciliation_id TEXT NOT NULL UNIQUE,
      store_id TEXT NOT NULL,
      model TEXT,
      analysis_json TEXT NOT NULL,
      input_chars INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cfo_ai_store ON cfo_ai_analyses(store_id, created_at);
  `);
}

function cap<T>(rows: T[], label: string, notes: string[]): T[] {
  if (rows.length > MAX_ROWS_PER_SECTION) {
    notes.push(`${label}: ${rows.length} rows total, first ${MAX_ROWS_PER_SECTION} included (sorted).`);
    return rows.slice(0, MAX_ROWS_PER_SECTION);
  }
  return rows;
}

/** Collect every relevant record between the two snapshot timestamps. */
export function gatherEvidence(db: DB, storeId: string, recon: ReconResult, reconciliationId?: string): { pack: any; truncationNotes: string[] } {
  const notes: string[] = [];
  const ts1 = recon.period_start_ts;
  const ts2 = recon.period_end_ts;
  const d1 = recon.period_start;
  const d2 = recon.period_end;

  const store: any = db.prepare(
    `SELECT id, name, platform, shipsourced_client_id, shipsourced_extra_client_ids,
            shopify_balance_cents, shopify_payout_cents, ss_charges_pending_cents,
            ss_total_paid_cents, ss_net_owed_cents, cfo_overrides
     FROM stores WHERE id = ?`
  ).get(storeId);

  const snapshots = db.prepare(
    'SELECT id, snapshot_date, assets_cents, liabilities_cents, equity_cents, data, created_at FROM cfo_snapshots WHERE id IN (?, ?)'
  ).all(recon.t1_snapshot_id, recon.t2_snapshot_id).map((s: any) => {
    let parsed = null;
    try { parsed = s.data ? JSON.parse(s.data) : null; } catch { /* keep raw */ }
    return { ...s, data: parsed };
  });

  const dailyPnl = cap(db.prepare(
    'SELECT * FROM daily_pnl WHERE store_id = ? AND date >= ? AND date <= ? ORDER BY date'
  ).all(storeId, d1, d2), 'daily_pnl', notes);

  const adPayments = cap(db.prepare(
    `SELECT id, platform, date, transaction_id, payment_method, card_last4, amount_cents, currency, status, account_id, created_at
     FROM ad_payments WHERE store_id = ? AND (date >= ? AND date <= ? OR (created_at >= ? AND created_at <= ?)) ORDER BY date`
  ).all(storeId, d1, d2, ts1, ts2), 'ad_payments', notes);

  const cardPayments = cap(db.prepare(
    `SELECT id, date, amount_cents, category, platform, card_last4, notes, created_at
     FROM card_payments_log WHERE store_id = ? AND date != 'N/A' AND date >= ? AND date <= ? ORDER BY date`
  ).all(storeId, d1, d2), 'card_payments_log', notes);

  // Bank transactions on this store's accounts AND global accounts (cash can move anywhere)
  const bankTxns = cap(db.prepare(
    `SELECT bt.id, ba.account_name, ba.account_type, ba.store_id AS account_store_id, bt.date,
            bt.description, bt.category, bt.custom_category, bt.amount_cents, bt.created_at
     FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id
     WHERE (ba.store_id = ? OR COALESCE(ba.is_global, 0) = 1) AND bt.date >= ? AND bt.date <= ?
     ORDER BY bt.date, bt.created_at`
  ).all(storeId, d1, d2), 'bank_transactions', notes);

  const manualEntries = cap(db.prepare(
    'SELECT id, date, entry_type, amount_cents, description, created_at FROM manual_entries WHERE store_id = ? AND date >= ? AND date <= ? ORDER BY date'
  ).all(storeId, d1, d2), 'manual_entries', notes);

  const manualCards = db.prepare(
    'SELECT * FROM manual_credit_cards WHERE store_id = ? OR store_id IS NULL'
  ).all(storeId);

  const chargebacks = cap(db.prepare(
    'SELECT * FROM chargebacks WHERE store_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at'
  ).all(storeId, ts1, ts2), 'chargebacks', notes);

  const activityLog = cap(db.prepare(
    `SELECT action, entity_type, entity_id, details, created_at FROM activity_log
     WHERE created_at >= ? AND created_at <= ? ORDER BY created_at`
  ).all(ts1, ts2), 'activity_log', notes);

  const syncLog = cap(db.prepare(
    'SELECT * FROM sync_log WHERE started_at >= ? AND started_at <= ? ORDER BY started_at'
  ).all(ts1, ts2), 'sync_log', notes);

  const adSpendDaily = db.prepare(
    `SELECT date, platform, SUM(spend_cents) AS spend_cents, COUNT(*) AS rows
     FROM ad_spend WHERE store_id = ? AND date >= ? AND date <= ? GROUP BY date, platform ORDER BY date`
  ).all(storeId, d1, d2);

  // User-submitted ground-truth exports (Shopify Payments export, bank statements) attached
  // to this reconciliation. Rows carry exact-second UTC timestamps (ts_utc) where the export
  // had them — filter to the window with ±3 days slack so boundary/pipeline rows are visible.
  ensureEvidenceTable(db);
  const slackMs = 3 * 24 * 3600 * 1000;
  const winLo = new Date(ts1.replace(' ', 'T') + 'Z').getTime() - slackMs;
  const winHi = new Date(ts2.replace(' ', 'T') + 'Z').getTime() + slackMs;
  const userEvidence = db.prepare(
    `SELECT id, kind, filename, headers_json, rows_json, row_count, min_ts, max_ts, sum_amount_cents, sum_net_cents, note, warnings, created_at
     FROM cfo_evidence WHERE store_id = ? AND (reconciliation_id = ? OR reconciliation_id IS NULL)
     ORDER BY created_at`
  ).all(storeId, reconciliationId || '__none__').map((ev: any) => {
    let rows: any[] = [];
    try { rows = JSON.parse(ev.rows_json) || []; } catch { /* keep empty */ }
    const inWindow = rows.filter((r: any) => {
      const key = r.ts_utc || (r.date ? r.date + ' 12:00:00' : null);
      if (!key) return true; // undated rows: keep, flagged for the model
      const t = new Date(key.replace(' ', 'T') + 'Z').getTime();
      return t >= winLo && t <= winHi;
    });
    const dropped = rows.length - inWindow.length;
    return {
      id: ev.id,
      kind: ev.kind,
      filename: ev.filename,
      note: ev.note,
      uploaded_at: ev.created_at,
      export_full_range: { min_ts: ev.min_ts, max_ts: ev.max_ts, total_rows: ev.row_count, sum_amount_cents: ev.sum_amount_cents, sum_net_cents: ev.sum_net_cents },
      window_filter_note: dropped > 0 ? `${dropped} rows outside window ±3d omitted (full-range sums above cover the whole export).` : 'All export rows fall within window ±3d.',
      parse_warnings: ev.warnings ? JSON.parse(ev.warnings) : [],
      rows: cap(inWindow, `user_evidence:${ev.kind}:${ev.filename || ev.id}`, notes),
    };
  });

  const pack = {
    store,
    window: {
      exact_start_ts: ts1,
      exact_end_ts: ts2,
      date_start: d1,
      date_end: d2,
      boundary_note:
        'Timestamped tables (activity_log, sync_log, chargebacks) filtered by exact snapshot timestamps. ' +
        'Date-only tables (daily_pnl, bank_transactions, payments) filtered by snapshot DATES — rows on the boundary ' +
        'dates may fall on either side of the exact snapshot second; treat boundary-date rows as ambiguous.',
    },
    deterministic_reconciliation: recon,
    snapshots,
    daily_pnl: dailyPnl,
    ad_spend_daily: adSpendDaily,
    ad_payments: adPayments,
    card_payments_log: cardPayments,
    bank_transactions: bankTxns,
    manual_entries: manualEntries,
    manual_credit_cards: manualCards,
    chargebacks,
    activity_log: activityLog,
    sync_log: syncLog,
    user_submitted_evidence: userEvidence,
    truncation_notes: notes,
  };

  return { pack, truncationNotes: notes };
}

const SYSTEM_PROMPT = `You are a forensic financial reconciliation analyst for a DTC e-commerce holding company.

You are given:
1. A deterministic CFO-to-P&L reconciliation between two balance-sheet snapshots (exact timestamps included). Its identity: delta_equity = net_profit + explained_items + residual. Your job is to explain the RESIDUAL.
2. The complete evidence recorded between the snapshots: both snapshots' full component data (assets/liabilities), daily P&L rows, ad-platform payments, card payment logs, bank transactions (store + global accounts), manual entries, manual credit-card balances, chargebacks, the app's activity log, and sync logs.
3. Possibly user_submitted_evidence: raw exports the user uploaded (Shopify Payments transactions/payouts export, bank statements). These are GROUND TRUTH from the payment processor / bank — they outrank every hand-typed balance in the snapshots. Rows carry normalized fields (ts_utc = exact UTC timestamp to the second when the export had one, amount_cents/fee_cents/net_cents) plus every original column in raw.

Domain facts you must use:
- P&L revenue/fulfillment comes from a 3PL (ShipSourced). Fulfillment for Shopify-platform stores is a BUNDLED per-SKU price (product cost included); some recent days include ESTIMATED fulfillment (fulfillment_est_cents) for orders the 3PL has not billed yet.
- Ad spend accrues daily in the P&L, but cash leaves via card charges (ad_payments) later — timing gaps are normal and the deterministic engine already models them; only flag what it MISSED.
- Snapshot component keys ending _cents are integer cents. Sign convention: every cause you report must be expressed as its contribution to (delta_equity − net_profit), same as the deterministic items — i.e. positive = equity moved MORE than profit explains.
- CRITICAL — units in prose: the evidence is in integer cents, but a human CFO reads your output. In EVERY prose field (verdict, explanation, evidence strings, fix, data_quality_issues, recommended_actions) express ALL amounts in dollars formatted like $1,234.56 — NEVER raw cents. Only the numeric JSON fields amount_cents, residual_cents, and unexplained_remaining_cents stay in integer cents.
- Balance lines fed by hand (manual credit cards, Shopify balance typed in, inventory) are the most common source of residuals: a re-typed balance that mixes real spend with balance corrections breaks the bridge.
- Boundary effects: date-only rows on the two boundary dates may belong to either side of the exact snapshot second.

Method — be rigorous:
1. Recompute the component deltas from the two snapshots and verify the residual figure. If your arithmetic disagrees with the deterministic engine, say so and use your own.
2. Attribute the residual to specific causes. Every cause MUST cite specific evidence rows (table + id/date/amount) and MUST carry a signed cents amount. Causes should sum to approximately the residual.
3. Distinguish: timing (real, self-corrects), capital (owner draw/contribution), data_bug (app wrote wrong number — say which write, when, citing activity/sync logs), double_count (same dollars in two lines), missing_data (evidence you'd need but wasn't recorded).
4. Check the classic traps: manual credit-card line moved without matching card_payments_log entries; Shopify balance/payout moved without matching P&L revenue; fulfillment estimated vs billed double-counted in liabilities; ad invoices counted both as pending liability and as paid cash; P&L rows rewritten by a sync DURING the window (see sync_log/activity_log).
5. Numbers must tie. Do not hand-wave. If something cannot be explained with the given evidence, quantify exactly how much remains unexplained and say precisely what record would be needed.
6. If user_submitted_evidence is present, it is your PRIMARY source — do a full dollar-level trace:
   a. Shopify Payments export: sum charges/refunds/fees/payouts/adjustments by type WITHIN the exact window [exact_start_ts, exact_end_ts] using ts_utc to the SECOND — a row at 12:04:58 belongs before a 12:05:00 snapshot, one at 12:05:03 does not. Reconstruct the true Shopify balance movement: balance_delta = charges − refunds − fees − payouts_sent ± adjustments. Compare against the snapshot's typed-in Shopify balance delta and against P&L revenue — name the exact rows that make up any difference.
   b. Identify payouts IN TRANSIT at each boundary: payout rows whose payout_date/status shows sent-but-not-landed at the snapshot second. That is the pending-pipeline number — state it exactly from the rows, never estimate it.
   c. Bank statement: match every payout row to its bank landing (amount + date proximity); flag payouts that never landed, deposits with no matching payout, and every non-payout bank movement (which must be explained as spend, transfer, or owner capital).
   d. Cross-check the P&L: window revenue per daily_pnl vs charges-net-of-refunds in the export for the same dates. If they disagree, the P&L is wrong — quantify by how much, cite which dates, and say so plainly in the verdict.
   e. Rows outside the exact window (the ±3d slack) exist ONLY to resolve boundary and in-transit questions — never count them inside window totals.

Output STRICT JSON only (no markdown fences, no prose outside JSON):
{
  "verdict": "<1-2 sentence headline: what mainly caused the residual>",
  "confidence": "high" | "medium" | "low",
  "residual_cents": <the residual you verified>,
  "causes": [
    { "title": "...", "amount_cents": <signed int>, "category": "timing|capital|data_bug|double_count|missing_data|unknown",
      "explanation": "...", "evidence": ["table:id date $amt — why it matters", ...], "fix": "concrete action" }
  ],
  "unexplained_remaining_cents": <int>,
  "data_quality_issues": ["..."],
  "recommended_actions": ["ordered, concrete steps"]
}`;

function extractJson(text: string): any | null {
  const cleaned = text.replace(/```json\s*|```\s*/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/** Run the AI investigation for a saved reconciliation. Returns the parsed analysis. */
export async function analyzeReconciliation(db: DB, storeId: string, reconciliationId: string): Promise<AiAnalysis> {
  const row: any = db.prepare('SELECT id, result FROM cfo_reconciliations WHERE id = ?').get(reconciliationId);
  if (!row?.result) throw new Error('Reconciliation not found or has no stored result');
  const recon: ReconResult = JSON.parse(row.result);

  const { pack } = gatherEvidence(db, storeId, recon, reconciliationId);
  const evidenceText = JSON.stringify(pack);
  const nEvidence = (pack.user_submitted_evidence || []).length;

  const client = new Anthropic(); // ANTHROPIC_API_KEY from env

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: FALLBACK_MODEL }],
    output_config: { effort: 'high' },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content:
        `Reconciliation case for store "${pack.store?.name}" — residual to explain: ${recon.residual_cents} cents ` +
        `(window ${recon.period_start_ts} → ${recon.period_end_ts}).` +
        (nEvidence > 0
          ? ` The user disputes prior conclusions and submitted ${nEvidence} ground-truth export(s) in user_submitted_evidence — trace every dollar through them per method step 6.`
          : '') +
        `\n\nFULL EVIDENCE PACK (JSON):\n${evidenceText}`,
    }],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    throw new Error('Model declined the request (refusal stop reason)');
  }

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  const parsed = extractJson(text);
  const analysis: AiAnalysis = parsed && Array.isArray(parsed.causes)
    ? parsed
    : {
        verdict: 'Analysis returned non-JSON output — raw text preserved.',
        confidence: 'low',
        residual_cents: recon.residual_cents,
        causes: [],
        unexplained_remaining_cents: recon.residual_cents,
        data_quality_issues: [],
        recommended_actions: [],
        raw_text: text,
      };

  ensureAiAnalysisTable(db);
  db.prepare(
    `INSERT INTO cfo_ai_analyses (id, reconciliation_id, store_id, model, analysis_json, input_chars)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(reconciliation_id) DO UPDATE SET
       analysis_json = excluded.analysis_json, model = excluded.model,
       input_chars = excluded.input_chars, created_at = datetime('now')`
  ).run(crypto.randomUUID(), reconciliationId, storeId, response.model || MODEL, JSON.stringify(analysis), evidenceText.length);

  return analysis;
}
