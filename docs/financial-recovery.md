# Financial Recovery Procedures

**Golden rule: snapshot before anything.** `sqlite3 dev.db "VACUUM INTO '/tmp/pre-<op>.db'"` (server: stop-free, verified 2026-09-08).

- **Bad deployment** → `git reset --hard <last-good>` + redeploy via ./deploy.sh; DB untouched by deploys (rsync excludes *.db).
- **Bad categorization run** → classification_results is a PROJECTION, never source truth: `DELETE FROM classification_results WHERE method != 'MANUAL'` then re-run /api/categorize. Manual verdicts survive (SQL-protected). Raw bank_transactions unaffected by design.
- **Bad account merge** → merged rows survive with status='merged' + merged_into; activity_log has txns_moved/deduped counts; restore = flip status back + re-point txns via the audit row. Deduped twins are gone from live but recoverable from the pre-merge snapshot (/tmp/dev.db.pre-merge-backup pattern).
- **Provider modify/remove regret** → txn_revisions holds full prior JSON; reinsert from old_json.
- **Bad rule** → rules are read at classify-time only; disable rule (enabled=0), delete non-manual results, re-run. No historical mutation happens at rule-save time.
- **Sync corruption** → bank data re-syncs idempotently from providers (cursor reset per item via plaid_items.cursor=NULL → full replay; UNIQUE constraints + content-twin upgrade make replay safe — proven byte-identical on double-sync).
