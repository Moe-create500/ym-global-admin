# Reconciliation Architecture (see also transaction-categorization-architecture.md)

Layers: RAW (bank_transactions + txn_revisions, DB-unique on provider id) →
IDENTITY (account-identity canonical accounts + account_connections history) →
RELATIONSHIPS (classification_results.related_txn_id pairs; claimed-twin
exclusion; ambiguity → TRANSFER_SUSPECT) → INTERPRETATION (category+store, a
projection that is ALWAYS safe to rebuild; manual rows immutable) →
HEALTH (getFinancialHealth + /api/categorize?attribution=1 coverage).

Full-history run 2026-09-09 (11,099 txns, 10s): 3,622 payout · 604 invoice ·
428 card-payment · 204 transfer · 379 TRANSFER_SUSPECT · 124 manual · 5,660
honest UNKNOWN. Attribution: 96.6% of $10.7M flow store-attributed; 206 txns
($362k) UNATTRIBUTED triage.

Cardinality: 1:1 today (pairs, invoice matches). 1:N payout→components and
N:1 invoices→wire are the P1 relationship-table upgrade (documented, not faked).
