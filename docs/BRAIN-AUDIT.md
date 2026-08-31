# 🔬 THE BRAIN — Forensic Foundation Audit

*Conducted 2026-08-31 against live production data + full codebase. Method: understand first, prove second, fix third. Every claim below carries its evidence.*

---

## VERDICT

**The foundation is SAFE to build on — with the caveats in §5.**

- 30-day census: **680/680** bank transactions carry an interpretation (100% classified), **0** pending/posted twins, **0** duplicate feed ids, **87.9% of dollars** ($421,557 / $479,315) fully traced — and the UI shows the identical number, proving no drift between audit math and display math.
- The five laws (one pipeline, one dollar one promise, evidence or silence, stale is stated, answers become rules) held under adversarial review, with the exceptions found, fixed, and regression-locked below.

---

## 1 · Source-of-truth matrix (who is allowed to answer what)

| Question | ONLY authoritative source | Verified readers |
|---|---|---|
| What does a card owe / remaining for stmt | `transactions-intel.ts` getPayPlan/getCardClarity | transactions API, brain API, **CFO (fixed this audit — was inline math)** |
| Who owes what on which card | getTruth / getCardIntel composition walk | transactions API |
| Is a submitted payment real | reconcileLoggedPayments | payments tab, risks, in-flight |
| What cash is coming, when | `incoming-cash.ts` | coverage, forward-cash, incoming tab |
| Can a bill be paid / by what | `coverage.ts` getCoveragePlan | command tab, calendar |
| What's safe to deploy (growth) | `forward-cash.ts` safeToDeploy | command tab — **semantically distinct** from cashflow.ts `safe_to_pay_today` (bills-vs-growth; both correct, different questions) |
| Product test verdicts | `product-performance.ts` | dashboard tests strip, risks |
| Integrity of all of the above | `brain-insights.ts` runIntegrityChecks — now 6 checks, runs on every brain GET + every 30-min snapshot | brain API |

**Bypass hunt result:** one real bypass existed (CFO computing card debt as `credit_limit − available`, twice, diverging from the Brain) — eliminated. All other direct SQL in routes is display-only aggregation, which is acceptable.

## 2 · Census evidence (production, read-only, 30d)

| Fact | Number |
|---|---|
| Bank transactions (posted/pending) | 680 (566 / 114) |
| Interpreted (txn_links) | **680 / 680** |
| Stale pending twins / dup feed ids | 0 / 0 |
| Orphan links (dead txn) | **6 — root-caused & fixed** (twin-heal deleted rows, stranded links) |
| Dollar traceability | $421,557 / $479,315 = **87.9%** (matches UI) |
| Card-payment credits paired | 20 / 21 |
| card_payment_sent debits paired | 21 / 29 (unpaired = blind-feed side; one-sided proof covers them) |
| ad_payments duplicates | 0 |

## 3 · Defects — proven, fixed, regression-locked

| # | Defect | Root cause | Fix | Regression lock |
|---|---|---|---|---|
| P0-A | **$281,930 of Marroomi Shopify payouts (200 txns) attributed to ShipSourced** — poisoned company cash pools, incoming matrix, coverage funding | merchant rule `mohamed hussein` (created for the 8/19 owner-pull note) text-matched `INDN:MOHAMED HUSSEIN` inside every Shopify payout deposit on BofA ·2240 | merchant rules now fire on spend-like classes ONLY (never payouts/payments); rule pattern narrowed to `zelle payment from mohamed hussein`; force re-scan re-attributed the payouts | integrity check `company_separation` (inbound credits crossing the YM↔SS wall) — runs every brain GET |
| P0-B | one Amex credit claimed by two $2,000 debits (·7917 personal + ·7878 YM GLOBAL both paired to the same 6/26 Gold-·1009 credit) — double store-credit for one payment | force rescans re-pushed already-paired credits into the pairing pool | pairing pool now excludes already-paired sides; reciprocity heal releases historical duplicate claims (credit's own back-pointer decides the real couple) | selftest: "no transaction claimed as pair by multiple links" |
| 1 | 6 orphan txn_links | twin-heal deletes `bank_transactions` but not their links | orphan sweep every scan (links + dead pair refs) `transactions-intel.ts` | selftest §12 + integrity check `orphan_links` |
| 2 | 8 write-routes never dropped the 60s brain cache (banking sync, plaid exchange, cron sync, CFO writes, ads import, invoices, card-payments, banking assign) | cache added later than routes | `dropBrainCache()` on every financial write | — (structural) |
| 3 | CFO card debt = inline `limit − available`, duplicated twice, divergent from Brain | pre-Brain legacy | reads `getCardClarity` posted+holds, inline only as fallback | source-of-truth matrix |
| 4 | `card_payments_log` accepts exact duplicates (double-submit → double credit) | no business key | 409 on same store+card+date+amount unless `force:true` | selftest: no business-key dupes |
| 5 | False-confidence selftest checks: upcoming7 (`\|\| true` tautology), settlement sum (pure arithmetic), weekend sweep (`rec<=due \|\| rec>=due` tautology), transfer-as-revenue canary (structurally impossible query) | — | all four rewritten as real recomputations against live data | themselves |
| 6 | Integrity suite blind to lineage + company wall | — | added `orphan_links` + `company_separation` checks (run every brain GET / 30-min snapshot) | continuous |

**False positives from the audit agents (verified safe, no action):**
- "ShipSourced re-sync clobbers Shopify revenue" — false: when `source='shopify'` the update branch never touches revenue or source (`sync.ts:194`); protection is permanent.
- "merchant_store_rules / reserves / manual card statements have no write path" — false: assign_group PATCH writes rules, CFO PATCH writes reserves/manual cards, transactions PATCH writes statements.
- Plaid retraction "leaves orphan links" — false: the removed-branch cleans both directions; the real orphan source was twin-heal (#1).

## 4 · Test-coverage truth

`scripts/brain-selftest.ts` — now **71 checks**, all real (the 4 false-confidence ones were rewritten). Strong coverage: card invariants, composition sums, coverage conservation, company cash, settlement regression, product dollar conservation, lineage (new). It runs **manually and pre-deploy only**; the 6 integrity invariants run continuously (every brain GET + 30-min snapshot).

**Known-untested dangers (accepted, documented):** reversal re-matching after a payment bounces, ambiguous same-amount multi-match, Teller last-200 window under extreme volume, statement reversal mid-cycle. None currently reproduce in production data; revisit if any surfaces.

## 5 · Caveats the verdict carries

0. **12 historical duplicate groups in card_payments_log** (Marroomi/Areya/SupplyLaundry/Purebite, mostly 2025–Apr 2026, several undated) — pre-guard manual entries that may be intentional repeat payments or true double-logs. User decision required; the reconciler's not-taken radar bounds the damage.
1. **12.1% of dollars are honestly untracked** — visible in the Uncategorized section, never guessed. That's the system working, but the number should trend down as rules accumulate.
2. **Selftest is not CI** — run `npx tsx scripts/brain-selftest.ts` on the server after every deploy (deploy verification habit).
3. **Blind feeds remain blind** — cards not linked to Teller/Plaid (FB funding cards ·2761 etc.) are covered by one-sided proof only.
4. **Manual statements expire** — handled (EXPIRED verdict, balance-mode fallback), but Plaid-liability consent for BofA is still pending user action at the issuer.

## 6 · Permanent audit tools (new)

```bash
npx tsx scripts/brain-spine-audit.ts [--days 30] [--json] [--company ymgv|shipsourced]
# Full spine health: lifecycle, traceability (with explicit numerator/denominator),
# pairing, card invariants, one-dollar-one-promise, feed freshness.
# Exit 0 = SPINE HOLDS · 1 = warnings (P1) · 2 = violated (P0). Read-only.

npx tsx scripts/brain-trace.ts <txn id | "description" | 3984.91>
# Lineage of any dollar: source → account → class → owner → evidence → pair →
# consumers → freshness. Reuses authoritative services; computes nothing itself.
```

*Companion: [BRAIN-MAP.md](BRAIN-MAP.md) — the architecture these audits police.*
