# Financial Security Review — 2026-09-09

| Area | Status | Notes |
|---|---|---|
| Authentication | PASS | HMAC session tokens (30d) + legacy shared secret; middleware gates all /dashboard + /api |
| Authorization (roles) | PASS | admin/employee/client lockdowns in middleware; employee block extended 2026-09-09 to /api/transactions, /api/categorize, /api/health-finance, /dashboard/transactions (was a gap — new routes exposed bank data) |
| Object-level auth (IDOR) | PARTIAL | single-tenant admin app; client roles are whitelist-only (cannot reach financial APIs at all). Per-object store scoping for client roles = P2 |
| Webhook security | PARTIAL | YM_WEBHOOK_SECRET query-key gate + payload size cap added (was: fully unauthenticated — forged payloads could mark connections broken). Plaid JWT signature verification = P1 follow-up |
| Secrets | PASS | env-only (PLAID_*, ANTHROPIC_API_KEY, YM_WEBHOOK_SECRET); access_token stripped from ALL API responses (verified); no secrets in repo |
| API validation | PARTIAL | mutation endpoints validate ids/existence; amounts parsed server-side; no zod layer (P2) |
| SQL safety | PASS | better-sqlite3 prepared statements everywhere; searched: no string-interpolated user input in queries (the one `${like}` is built from constants) |
| XSS | PASS | React auto-escaping; no dangerouslySetInnerHTML on provider data |
| CSRF | PARTIAL | cookie-authed JSON POSTs; SameSite default Lax mitigates; explicit token = P2 |
| Audit log | PARTIAL | account merges + txn_revisions + classification_feedback; category edits carry actor; rule edits not yet audited (P2) |
| Mass actions | PASS | merge = dry-run + explicit apply; categorize = idempotent + MANUAL-protected; no bulk delete endpoints |
| Deletion policy | PASS | accounts soft-state (merged/disconnected); txn deletes only via provider removal (revision-preserved); dup content-twins removed only inside audited merges |
| Public endpoints | PARTIAL | /api/cron/* public by design (idempotent syncs); rate limiting = P2 |
