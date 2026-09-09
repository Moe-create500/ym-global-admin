# YM Global — Financial Transaction Architecture Audit

**Date:** 2026-09-09 · **Auditor:** Claude (evidence-based; every claim verified against code/data this session)
**Context:** Audited across the 2026-09 hardening sessions. NOTE: the legacy Brain engine
(classification/matching/pay-plan, ~4k lines) was removed 2026-09-09 at Moe's direction
(commit 26ad7f3). Items it provided are marked **MISSING (removed)** — they are scheduled
for the canonical-ledger rebuild, not forgotten.

## Layer map (current)

```
Plaid/Teller ──► syncPlaidItems (evidence-recorded, partial-aware) ──► bank_transactions
Shopify ──► shopify-sync ──► cfo_evidence ──► chargebacks / refunds_cents
ShipSourced ──► lib/sync.ts ──► daily_pnl (computePnl canonical)
FB Insights ──► ad_spend ──► daily_pnl.ad_spend_cents
CSV imports ──► orders / daily_pnl / ad_payments
                     │
       account-identity (canonical accounts, merge, connection history)
       connection-state (10-state evidence-only derivation)
       financial-integrity (DB constraints, txn_revisions, health scan)
                     │
       /api/banking · /api/credit-cards · /api/transactions · /api/health-finance
       /api/pnl · /api/cfo · /api/cashflow
```

## Gap matrix

| Capability | Status | Evidence / Notes |
|---|---|---|
| Source ingestion (banks) | **PASS** | plaid.ts cursor sync; sync_runs evidence ledger; partial outcomes |
| Raw data immutability | **PARTIAL** | txn_revisions now preserves prior state on provider modify/remove; full raw-payload storage not kept (deliberate: size) |
| Idempotency (bank txns) | **PASS** | DB UNIQUE on provider txn id + content-twin upgrade; double-sync test byte-identical |
| Idempotency (ad_spend) | **PASS** | DB UNIQUE (store,date,platform,ad_id); verified 0 dupes before adding |
| Idempotency (ad_payments) | **PARTIAL** | UNIQUE(transaction_id) only — re-import with rotated ids possible (P1, audit finding) |
| External identities | **PASS** | provider txn/account/item ids stored |
| Account identity | **PASS** | account-identity.ts: canonical accounts, name-aware matching, twin-mask safety, 12 adversarial tests |
| Duplicate transactions | **PASS** | 4,416 historical dupes removed via account merges; DB constraint prevents recurrence; 260 same-day repeats left (plausibly real, need per-case evidence) |
| Duplicate accounts | **PASS** | merge machinery + pre-insert guard + possible_duplicate parking; 8 historical merges applied locally |
| Pending → posted | **PASS** | ordered removed→modified→added processing + twin upgrade-in-place |
| Modified/removed events | **PASS** | handled + now audited in txn_revisions |
| Refunds | **PARTIAL** | refunds_cents in canonical P&L (per-source semantics); refund↔original *linking* MISSING (removed) |
| Transfers | **MISSING (removed)** | detection/pairing died with Brain; health scan flags unlinked suspects (evidence-only) |
| Credit-card payments | **MISSING (removed)** | pairing died with Brain; statement remaining uses card-feed credits (deterministic, capped by ledger) |
| Intercompany | **MISSING (removed)** | YM↔SS wall was Brain logic; no consolidated elimination anywhere (also pre-existing P&L gap) |
| COGS | **PARTIAL** | canonical P&L fixed phantom product cost; missing COGS still indistinguishable from $0 in daily_pnl (P0 for ledger rebuild); ShipSourced COGS verified per-SKU upstream |
| Shopify payouts | **PARTIAL** | payout evidence in cfo_evidence; payout↔deposit reconciliation was Brain logic (removed) |
| Stripe/PayPal | **MISSING** | no integrations exist in YM (Stripe lives on ShipSourced side) |
| Fees | **PARTIAL** | platform fees computed (canonical); processor-fee breakdown per payout not modeled |
| Chargebacks | **PASS** | dispute sync + rollUpChargebacks on canonical formula |
| Rule engine | **MISSING (removed)** | merchant_store_rules DATA preserved; engine deleted; rebuild must include dry-run/blast-radius per spec |
| Manual overrides | **PARTIAL** | custom_category manual-only (no automation can clobber it — because there is no automation); no old/new/actor audit on category edits (P2) |
| AI classification | **PASS (by absence)** | none — deterministic-only, per spec hierarchy |
| Confidence | **PARTIAL** | connection states + statement derivations explain themselves; txn classification confidence gone with engine |
| Reconciliation | **PARTIAL** | cfo-reconcile (equity vs P&L) survives; bank-vs-ledger continuity not automated |
| Balance reconciliation | **PARTIAL** | verified vs last-known split everywhere; running_balance continuity check not implemented |
| Audit trail | **PARTIAL** | activity_log now used (account merges); txn_revisions added; category edits unaudited |
| Exception management | **PASS (new)** | /api/health-finance + Transactions-page issue chips: reauth, stale, dup-suspects, sync failures, uncategorized $, transfer suspects, consent gaps |
| Store attribution | **PARTIAL** | account→store mapping + Shopify-Balance auto-assign survive; txn-level store attribution was Brain logic |
| Company attribution | **PARTIAL** | bank_accounts.company survives; company lens UIs died with Brain page |
| P&L treatment | **PASS** | ONE canonical computePnl, 16 regression tests, all 20 writers converted |
| Cash-flow treatment | **PARTIAL** | cashflow lib survives; committed/free/coverage model from hardening spec not yet built |
| Sync health | **PASS** | sync_runs + connection-state + per-item evidence + webhooks |
| Stale connections | **PASS** | STALE ≠ disconnected; provider-signals-only; 18 truth-table tests |
| Missing data ≠ zero | **PARTIAL** | balances: PASS (last-known preserved + labeled). COGS/ad-spend gaps in daily_pnl still read as 0 (flagged P0 for ledger rebuild) |
| Money precision | **PASS** | integer cents everywhere (schema-verified, zero float money columns) |
| Concurrency | **PARTIAL** | sync lock exists; DB constraints now backstop races; confirm-vs-sync race documented (P1) |
| DB constraints | **PASS (new)** | UNIQUE bank txn provider id, UNIQUE ad_spend key; identity guards on inserts |
| Test coverage | **PARTIAL** | 56 tests across finance-core / connection-state / account-identity / financial-integrity; no CI gate in deploy.sh yet (P1); golden dataset not built (P1) |
| Observability | **PARTIAL** | sync_runs + source-registry + health scan; no alerting/thresholds (P1) |

## P0 queue (correctness)
1. **Missing ≠ zero for COGS/ad-spend in daily_pnl** — NULL-able columns + sync-status signal (needs migration + writer changes; deferred to ledger rebuild to avoid double migration).
2. **Deterministic transfer + card-payment pairing (engine replacement)** — clean-room module with the invariants as tests FIRST (transfers never touch profit; card payment never a second expense). Health scan flags suspects until then.
3. **Bank-ledger continuity check** — running_balance chain vs transaction sums per account, opening-balance anchored.

## P1 queue
Opening balances/systemization dates · ad_payments composite dedupe key · test gate in deploy.sh · golden dataset · payout↔deposit reconciliation · rule engine rebuild (dry-run, blast-radius, versioning) · category-edit audit · alert thresholds.

## Invariants currently enforced by tests (56 passing)
- One profit formula; refunds reduce profit per revenue-source semantics; margins never NaN
- Connection state derives from provider evidence ONLY; UNKNOWN is a valid answer
- Twin-mask accounts never cross-matched; merges idempotent, lineage-clean, direction-checked
- Replayed provider events rejected BY THE DATABASE; NULL ids stay insertable
- Source modifications/removals preserve prior state; health scan invents nothing on clean data
