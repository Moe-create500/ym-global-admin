// ============================================================================
// LLM FALLBACK — provider-agnostic, structured-output-only, fail-safe.
//
// The model is NOT source truth: it only runs when deterministic layers
// abstain, it must pick from the closed category list (never invent), its
// confidence is capped below deterministic evidence, its output is validated,
// and if it is unavailable/malformed the pipeline simply abstains — the
// transaction stays safely reviewable. Every call is cost-tracked in ai_calls.
//
// Config (env, never hardcoded): ANTHROPIC_API_KEY, CATEGORIZE_MODEL
// (default claude-haiku-4-5-20251001 — cheap triage tier for this job).
// ============================================================================

import type Database from 'better-sqlite3';
import crypto from 'crypto';

export const VALID_CATEGORIES = [
  'Shopify Payout', 'Ad Spend', 'Inventory', 'Fulfillment', 'Loan',
  'Transfer In', 'Transfer Out', 'Payroll', 'Software', 'Taxes',
  'Refund', 'Wire', 'Owner Draw', 'Reinvest', 'Savings',
  'Credit Card Payment', 'Fees', 'Other',
];

export interface LlmVerdict { category: string; confidence: number; reason: string; model: string }

export async function llmClassify(
  db: Database.Database,
  txn: any,
  ctx: { merchant: any; account: any },
): Promise<LlmVerdict | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null; // no provider configured — abstain, never fail
  const model = process.env.CATEGORIZE_MODEL || 'claude-haiku-4-5-20251001';
  const callId = crypto.randomUUID();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: 'You classify ONE bank transaction for an e-commerce holding company. Respond with ONLY a JSON object {"category": string, "confidence": number 0-1, "reason": string}. category MUST be one of the provided list or null. If evidence is insufficient, return {"category": null, "confidence": 0, "reason": "..."}. Never guess.',
        messages: [{
          role: 'user',
          content: JSON.stringify({
            categories: VALID_CATEGORIES,
            transaction: {
              description: txn.description, amount_usd: (txn.amount_cents / 100).toFixed(2),
              direction: txn.amount_cents < 0 ? 'debit' : 'credit', date: txn.date,
              account: ctx.account ? `${ctx.account.institution_name} (${ctx.account.account_type})` : null,
              merchant_resolved: ctx.merchant?.name || null,
            },
          }),
        }],
      }),
    });
    clearTimeout(timer);
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error?.message || `HTTP ${res.status}`);
    const text = d?.content?.[0]?.text || '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    db.prepare('INSERT INTO ai_calls (id, purpose, model, input_tokens, output_tokens, ok) VALUES (?, ?, ?, ?, ?, 1)')
      .run(callId, 'categorize', model, d?.usage?.input_tokens ?? null, d?.usage?.output_tokens ?? null);
    if (!parsed.category || typeof parsed.confidence !== 'number') return null;
    if (!VALID_CATEGORIES.includes(parsed.category)) return null; // model may not invent categories
    return { category: parsed.category, confidence: parsed.confidence, reason: String(parsed.reason || ''), model };
  } catch (e: any) {
    db.prepare('INSERT INTO ai_calls (id, purpose, model, ok, error) VALUES (?, ?, ?, 0, ?)')
      .run(callId, 'categorize', model, String(e?.message || e).slice(0, 200));
    return null; // AI failure NEVER fails the pipeline
  }
}
