# Financial Integrity Invariants (enforced, 2026-09-09)

Each invariant lists WHERE it is enforced. All have tests (npm test — 78 passing).

1. **One profit formula** — finance-core.computePnl; every daily_pnl writer converted. (16 tests)
2. **Refunds reduce profit per revenue-source semantics** — finance-core; source='shopify' never double-subtracts.
3. **Connection state derives from provider evidence ONLY** — connection-state.ts; txn recency is not an input by construction. UNKNOWN is valid. (18 tests)
4. **One real account = one canonical account** — account-identity.ts; name-aware matching, twin masks never guessed, merges idempotent + audited. (12 tests)
5. **Replayed provider events are rejected by the DATABASE** — uq_bank_txn_provider_id, uq_ad_spend_business_key. Proven live. (10 tests)
6. **Source truth is never silently rewritten** — txn_revisions preserves prior state on provider modify/remove.
7. **Manual verdicts are immutable to automation** — saveResult upsert has `WHERE method != 'MANUAL'` at the SQL layer.
8. **Transfers/card payments are one movement, not two P&L events** — engine layer 2 runs before all classification; pairs linked via related_txn_id.
9. **Ambiguity abstains** — >1 transfer candidate → TRANSFER_SUSPECT; >1 matching rule → RULE_CONFLICT; split feedback → no auto-classify. (22 engine tests)
10. **A twin leg settles exactly one movement** — claimed-twin exclusion in the pairing query.
11. **Cross-currency amounts never pair** — currency-aware twin join.
12. **UNKNOWN/UNATTRIBUTED are valid outputs** — category/store stay NULL without evidence; surfaced in health scan + attribution report.
13. **Categorization is idempotent** — same input twice → same verdicts, one result row. (tested)
14. **AI never posts truth** — LLM optional, closed category list, confidence capped 0.90, always needs_review, failure → abstention.
15. **The system reports its own problems** — getFinancialHealth computes issues from evidence only; clean DB → zero issues (tested).
