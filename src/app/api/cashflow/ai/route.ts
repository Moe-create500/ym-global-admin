import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { buildCashflowProjection } from '@/lib/cashflow';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MODEL = 'claude-fable-5';
const FALLBACK_MODEL = 'claude-opus-4-8';

function ensurePlanTable(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cashflow_ai_plans (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL UNIQUE,
      model TEXT,
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

const SYSTEM_PROMPT = `You are the cash manager for a DTC e-commerce holding company running multiple Shopify stores.

You receive a deterministic cashflow projection: per-store payout landings by date in three tiers
(in_transit = sent, on the rail; scheduled = Shopify queued it; forecast = estimate from recent revenue),
measured payout→bank landing lags, Shopify reserve holdbacks, card balances owed, and recent
ad-spend burn rates. Money fields ending _cents are integer cents.

Your job: a concrete day-by-day payment plan — which card to pay how much on which date — such that
payments are covered by cash that has ACTUALLY landed by that date (confirmed tiers first; use
forecast cash only with an explicit haircut and say so).

Rules:
- Never plan to spend in-transit/scheduled money before its landing date. Weekend landings roll to Monday.
- Ad spend keeps accruing daily onto cards (avg_daily_ad_burn_cents per store) — a card paid to zero
  today is NOT zero next week; project balances forward.
- Prefer paying cards that fund ad spend (keeps ads running) and anything marked overdue/unsettled first.
- Reserves held at Shopify are NOT spendable — exclude them, note when/if they might release.
- Flag any date where planned payments would exceed landed cash (shortfall) and propose a shift.
- In all prose, express amounts as dollars like $1,234.56 — never raw cents. Numeric *_cents JSON fields stay integer cents.

Output STRICT JSON only:
{
  "summary": "<2-3 sentence cash position + plan headline>",
  "confidence": "high" | "medium" | "low",
  "daily_plan": [
    { "date": "YYYY-MM-DD", "expected_landed_cents": <int, confirmed by then>,
      "payments": [ { "store": "...", "card_name": "...", "amount_cents": <int>, "reason": "..." } ],
      "note": "<optional>" }
  ],
  "card_plan": [
    { "store": "...", "card_name": "...", "current_owed_cents": <int>, "projected_owed_by_horizon_cents": <int>,
      "total_recommended_cents": <int>, "priority": "high|medium|low", "reason": "..." }
  ],
  "risks": ["..."],
  "data_gaps": ["what to upload/fix for a tighter plan"]
}`;

// GET /api/cashflow/ai?storeId=... → last saved plan for scope
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('storeId') || 'all';
  const db = getDb();
  ensurePlanTable(db);
  const row: any = db.prepare('SELECT * FROM cashflow_ai_plans WHERE scope = ?').get(scope);
  if (!row) return NextResponse.json({ plan: null });
  return NextResponse.json({ plan: JSON.parse(row.plan_json), model: row.model, created_at: row.created_at });
}

// POST /api/cashflow/ai { storeId? } → generate a payment plan from the live projection
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const storeId = body.storeId || undefined;
  const scope = storeId || 'all';

  const db = getDb();
  const projection = buildCashflowProjection(db, storeId, 14);

  // Recent card payment history gives the model the user's actual payment cadence
  const recentPayments = db.prepare(
    `SELECT s.name AS store, cp.date, cp.category, cp.amount_cents, cp.card_last4
     FROM card_payments_log cp LEFT JOIN stores s ON s.id = cp.store_id
     WHERE cp.date >= date('now', '-30 days') ORDER BY cp.date DESC LIMIT 100`
  ).all();

  const client = new Anthropic();
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: FALLBACK_MODEL }],
      output_config: { effort: 'high' },
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Build the payment plan for scope "${scope}" as of ${projection.generated_at_date}.\n\n` +
          `CASHFLOW PROJECTION (JSON):\n${JSON.stringify(projection)}\n\n` +
          `RECENT CARD PAYMENTS (30d):\n${JSON.stringify(recentPayments)}`,
      }],
    });
    const response = await stream.finalMessage();
    const text = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const cleaned = text.replace(/```json\s*|```\s*/g, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    let plan: any = null;
    if (start !== -1 && end > start) { try { plan = JSON.parse(cleaned.slice(start, end + 1)); } catch { /* raw below */ } }
    if (!plan) plan = { summary: 'Model returned non-JSON output.', confidence: 'low', daily_plan: [], card_plan: [], risks: [], data_gaps: [], raw_text: text };

    ensurePlanTable(db);
    db.prepare(
      `INSERT INTO cashflow_ai_plans (id, scope, model, plan_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET plan_json = excluded.plan_json, model = excluded.model, created_at = datetime('now')`
    ).run(crypto.randomUUID(), scope, response.model || MODEL, JSON.stringify(plan));

    return NextResponse.json({ success: true, plan, projection_date: projection.generated_at_date });
  } catch (err: any) {
    console.error('[cashflow-ai]', err?.message || err);
    return NextResponse.json({ error: err?.message || 'plan generation failed' }, { status: 500 });
  }
}
