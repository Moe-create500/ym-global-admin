# CFO Monthly — Architecture (2026-09-09)

**Nothing existing changed.** /dashboard/cfo (balance sheet, snapshots, cfo-reconcile), /api/cfo, daily_pnl, computePnl, categorization precedence — all untouched. CFO Monthly is a READ-ONLY analytical lens.

- `src/lib/cfo-monthly.ts` → `getMonthlyStoreReport(db, 'YYYY-MM')`
- `/api/cfo/monthly?month=` · page `/dashboard/cfo/monthly` (sidebar: CFO Monthly)

**Definitions (no new accounting invented):**
- Store expenses = attributed P&L-impacting debits; transfers/card payments/payouts EXCLUDED (settlements, P&L $0 — double-count impossible by construction)
- The charge on the card is the expense; the payment line shows separately marked "P&L $0"
- Card allocation = per-card charges split by PROVEN classification_results attribution; unproven = ⚠ Unattributed (never guessed)
- Headline revenue/net = SUM(daily_pnl) as-is — the ONE existing truth
- Month = transaction date prefix (existing date semantics; TEXT YYYY-MM-DD, no tz math)

**Consistency invariant (verified on real Aug 2026 data):** Σ store rows == totals.expense == attributed + unattributed, exact to the cent.

**States:** loading = skeletons (never $0); API failure = explicit red banner ("unavailable ≠ zero"); MoM % per store vs prior month.

**Deliberately deferred:** month close/locking, CFO↔P&L per-line variance drill, invoice-linked drawer inside this page (evidence lives in Transactions), export.
