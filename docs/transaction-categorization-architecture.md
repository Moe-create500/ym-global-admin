# Transaction Categorization Engine — Architecture

**2026-09-09** · `src/lib/categorize/` · consumed via `/api/categorize`

## Pipeline (strict precedence — higher layers always win)

```
transaction
 1. MANUAL lock (custom_category)            conf 1.00  never overridden
 2. transfer / card-payment matching         conf 0.97  paired, excluded from P&L
 3. business context: ad invoices,           conf 0.96–0.98  exact amount+date evidence
    app invoices, payout patterns
 4. EXACT_HISTORY (≥3 verified corrections,  conf 0.96  human knowledge compounds
    ≥4:1 dominance for the merchant)
 5. MERCHANT_RULE (merchant_store_rules,     conf 0.95  direction-guarded;
    pre-existing table reused)                          >1 match → RULE_CONFLICT abstain
 6. MERCHANT_KNOWLEDGE (entity default       conf 0.82–0.93  weighted by legacy
    purpose; identity ≠ category)                       classified-history agreement
 7. SEMANTIC_HISTORY (lexical similarity     conf 0.85  always needs_review
    over verified feedback)
 8. LLM_ASSISTED (optional; env key;         conf ≤0.90 capped below deterministic;
    closed category list; fail-safe)                    always needs_review
 9. UNKNOWN — honest abstention              conf 0     needs_review
```

## Output (per transaction, persisted in `classification_results`)
`category (nullable!) · subcategory · merchant id/name · store_id · method ·
confidence · reason (human sentence) · evidence[] (typed references) ·
needs_review · related_txn_id (pair)`

## Merchant intelligence
`merchant_entities` + `merchant_aliases` (seeded: Meta, Google Ads, Shopify,
Stripe, PayPal, Amazon, Amex, BofA, USPS/UPS/DHL/Shippo, Alibaba…). Identity
and category are separate concepts — Shopify the entity can be a payout,
a bill, or a fee. Learned aliases require **≥3 confirmations** before
resolution trusts them: one correction never becomes a broad silent rule.

## Learning loop
Manual categorization on the Transactions page → `classification_feedback`
(prediction vs correction + features) → locks the txn as MANUAL → future
EXACT_HISTORY/SEMANTIC_HISTORY retrieval. `saveResult` upserts are blocked
against MANUAL rows at the SQL layer.

## LLM layer (`llm.ts`)
Provider config via env only (`ANTHROPIC_API_KEY`, `CATEGORIZE_MODEL`,
default `claude-haiku-4-5-20251001`). 15s timeout, closed category list,
JSON-validated, confidence capped at 0.90, every call cost-tracked in
`ai_calls`, and any failure → abstention (pipeline can never break on AI).
Off by default in batch runs (`allowLlm: false`).

## Real-data performance (60d snapshot, 2026-09-09)
1,244 txns → 800 classified deterministically (404 payout, 218 invoice,
114 card-payment, 42 transfer, 19 merchant, 3 rule) · 444 honest abstentions
· **0 LLM calls** · 14 adversarial tests green.

## Deferred (documented, not forgotten)
Vector/hybrid embeddings retrieval (lexical works today; P2) · PO/supplier
matching (no PO tables in YM yet) · review-queue UI (API exists:
`/api/categorize?review=1`) · alias auto-learning writer (schema ready;
currently seeds + manual only) · blast-radius preview endpoint for new rules.
