# CFO v2 — Phase 1 (feature-flagged overview, scopes, drilldowns, freshness, issues)

Branch `cfo-v2`. Local mode: nothing deployed. Switch: Settings → "CFO Overview (v2)" (stored in `brain_config.cfo_v2`), env `CFO_V2=1`, or `?v2=1` on a request. Off = the CFO page is byte-for-byte the previous one.

## Existing-feature checklist → where it lives now

| Existing feature | Home in v2 | Code |
|---|---|---|
| Live Shopify balance / payout in transit / reserves | Position tab (unchanged) | `api/cfo/route.ts:254-299` |
| Bank accounts per store, card owed | Position tab; also Overview → Cash / Card debt (drilldown lists every account) | `lib/cfo/report.ts cashFigures` |
| Stripe payout balance, A/R clients, carrier owed, client credits (3PL) | Position tab (unchanged) | `api/cfo/route.ts:327-379` |
| Inventory asset (+ editable override) | Position tab | `api/cfo/route.ts:159-211` |
| Loans receivable / payable | Position tab | `api/cfo/route.ts:238-252` (see bug note) |
| Manual assets / liabilities, manual credit cards, reserves | Position tab; double-counted manual rows surface as an Issue | `lib/cfo/issues.ts §6` |
| Manual overrides (`cfo_overrides`) | Position tab | unchanged |
| Shopify anchor (reconciliation gate) | Position tab → bank row "↻ update via reconciliation gate" | `api/cfo/anchor` |
| Save Snapshot (freshness gate, 409 on stale) | Position tab header button | `api/cfo/route.ts POST` |
| Snapshot history, block/unblock | History tab | `page.tsx` snapshots section |
| Old "OVERVIEW CFO'S" snapshot table | kept as-is (pill) on the CFO page; the new Overview supersedes it for daily use | `api/cfo/overview` |
| Money Flow + bridge waterfall + drivers | Money Flow & Reconciliation tab | `ReconciliationPanel` |
| Gap investigation, block end snapshot, resubmit | Money Flow & Reconciliation tab | `ReconciliationPanel` |
| Evidence uploads | Bulk Upload page (unchanged) + chips on the Reconciliation tab | `api/cfo/reconcile/evidence` |
| AI Investigator (deep analysis) | Money Flow & Reconciliation tab; Overview links to it per store | `api/cfo/reconcile/ai` |
| Card charges linked to this store (mark paid) | Position tab | `StoreCardCharges` |
| Payments in flight | Position tab liability + Overview issue when overdue | `lib/payments-in-flight.ts` |
| Per-store P&L (`/api/pnl`) | new P&L tab (monthly statement view of the same data) | `components/cfo/PnlTab.tsx` |

Nothing was deleted; no data was migrated; no bank was reconnected.

## What Phase 1 adds

- **Scopes** (`lib/cfo/scopes.ts`): Everything · All stores · each store · ShipSourced combined · ShipSourced California · ShipSourced China. Legal entity, business unit and warehouse are separate fields on a scope. The two warehouse scopes carry `mapping.status = 'unresolved'` with the exact decisions needed; they never borrow company cash or a P&L.
- **Reporting service** (`lib/cfo/report.ts`): every figure is `{cents|null, kind, asOf, source, note, trace}`. Unknown is `null`, never 0. Stale keeps the last-known value with its timestamp. Aggregates that add values from different dates are flagged `mixedAsOf`.
- **Overview page** (`/dashboard/cfo/overview`): header = scope, period, comparison (prior period, same length), currency (USD, no conversion — no FX table exists), per-source freshness. "Position as of …" and "Performance for …" are separate panels. Business table = Business | Revenue | Net profit | Cash | Net assets | Status | Issues, with gross profit / overhead / card debt / mapping decisions in the expanded row. Unallocated shared costs shown explicitly.
- **Traceability** (`/api/cfo/v2/trace`): every number opens definition, formula, sources with last sync, the included records (same helpers as the overview — a test asserts the drilldown total equals the number clicked), what was excluded, and how to read its kind.
- **Issues** (`lib/cfo/issues.ts`): connections needing action, stale balances, unpaired charges per account, overdue in-flight payments, missing P&L rows, provisional profit, Meta payment feeds gone quiet, profiles without an ad account, manual rows duplicating in-flight detection, reconciliation drift, missing/old snapshots, unresolved mapping decisions, and ShipSourced Billing Duty flags — read with their own identity/status. When that feed is unavailable the issue says "not connected", never zero tickets.
- **Movements rule** (`lib/cfo/movements.ts`): one classifier for card payments / own-account transfers / intercompany transfers / payouts, shared by the overview, issues and drilldown.
- **Tabs** on the existing CFO page (Position / P&L / Money Flow & Reconciliation / History) — the page content is unchanged, only sectioned.

## Reference patterns used (licence-checked)

- midday (AGPL — design only): scope/period/comparison in the URL; drilldown as a sheet keyed on state; per-source "updated N ago" indicators.
- bigcapital (AGPL — pattern only): report rows return current + comparison; "unknown ≠ zero" figure semantics.
- ERPNext (GPL — pattern only): company / business unit / warehouse as separate dimensions.
- Tremor (Apache-2.0): not copied — its copy-paste components now require Tailwind v4; this app is on v3. Table/KPI styling follows the project's own `finance-ui` conventions.
- CopilotKit (MIT): not adopted — ~800 MB of unused runtime and its built-in agent cannot do human-in-the-loop approvals. The existing hand-built investigator stays.

## Tests

`src/lib/cfo/report.test.ts` (10) + existing suites = 136 passing. Covered: scope separation and unresolved mapping; unknown-is-not-zero, stale, mixed dates, partial totals; prior period math; per-store provenance on a fixture; warehouse scopes never invent numbers; **every headline/row figure ties to its trace total** across five scopes; issue kinds incl. no invented amounts and ShipSourced suppression; own-account / intercompany transfers never counted as unallocated charges; flag precedence.

Local smoke against a fresh production snapshot: 19 rows, ~8 ms per scope; API 401 without auth, 404 with the flag off; all three pages render.

## Pre-existing bugs found, not changed (need a go)

1. `loans.type` does not exist → Loans receivable is always $0 and every loan counts as payable (`api/cfo/route.ts:244`).
2. Money Flow "App Costs" tile computes `invoiced − invoiced` (always $0) and "Fulfillment" shows owner draws (`page.tsx:283, 290`).
3. Ad-invoice and app-invoice "balance due" are cumulative since inception, floored at 0 — not period figures.
4. CFO API routes have no session/tenant check (v2 routes do).
5. Snapshot table `CREATE TABLE IF NOT EXISTS manual_balance_items` runs inside GET.

## Data / accounting decisions still requiring review

- Is ShipSourced China a separate legal entity or a warehouse of the same company? (drives eliminations)
- Which ShipSourced costs are China: ESCOR Group monthly, XE/Wise transfers, 1688 purchases?
- YM brands vs third-party ShipSourced clients: no flag in ShipSourced's `Client`; needs a maintained mapping (`Marroomi` is duplicated, `Neeyapure` spelling drifts).
- `Product.unitCost` in ShipSourced: documented as cents, values look like dollars — reconcile before any COGS use.
- Client-owned inventory: only `usProductCostExempt` / `productCostExempt` exist today (client-level); per-product `ProductOwnership` is designed but its table is not migrated.
- FX: China costs are converted at a hard-coded 0.137 per document; no dated rate table anywhere.

## Phase 2 — started 2026-09-15: ShipSourced P&L by fulfilment centre

- **Cost classification** (`src/lib/cfo/ss-costs.ts`): every ledger row paired to ShipSourced gets a fulfilment line (product/COGS, carrier & labels, China agent payments, packaging & supplies, warehouse lease, labor, software, equipment, card fees, marketplace purchase, other) and a centre (California / China / shared). Defaults by merchant rule; workers change either on the Position tab ("Card charges linked to this store") and the choice is remembered per merchant (`ss_cost_rules`). Money movement is never a cost.
- **ShipSourced feeds** (PR branch `feat/integration-billing-flags`): `/api/integration/pnl` — billed revenue + ShipSourced-recorded direct costs per warehouse (US/CN via `Shipment.warehouseId`, carrier-name inference, else "unknown") and settled carrier invoices by lane; `/api/integration/open-orders` — open orders priced per line.
- **Charges workbench** (`src/components/cfo/StoreCharges.tsx`, API `/api/store-charges` GET + bulk PATCH): the Transactions-page filters on the CFO side (search incl. exact amount, date range + presets, card, paid state, amount range, sort) plus fulfilment filters (part incl. "needs review", centre, classified-by), a **by-merchant view** where one change classifies every charge from that merchant and saves the rule, checkbox selection with bulk apply / apply & remember / not-a-cost / mark paid–unpaid / move to store (via `/api/transactions`, same pairing rules), filtered totals, CSV export. 5,000-row window (was 500).
- **P&L composition** (`src/lib/cfo/ss-pnl.ts`): revenue − direct = gross per centre; ledger opex by centre; shared opex allocated by billed-revenue share (50/50 and labelled when revenue is unknown); totals preserved (CA + CN = ledger). Shown on the ShipSourced store's P&L tab and in the Overview's ShipSourced California / China rows. Unknown stays null, never $0.

## Cashflow page rebuilt (2026-09-16)

- **Shopify stores only.** `src/lib/cash-position.ts` builds the position for one Shopify store or all of them from the same sources as the pages that own each number: cash = accounts assigned to the store(s) (Bank Accounts), card charges = unpaid charges paired to the store(s) (CFO "Card charges linked"), payments in flight (`payments-in-flight.ts`), Meta unbilled (`fb_profiles`), subscriptions due in 14 days (subscriptions engine, memoised 5 min), ad burn (daily_pnl). ShipSourced, unassigned and hidden accounts never enter; a non-Shopify store selected in the global bar falls back to all Shopify stores with a note.
- **Unknown ≠ $0.** A store with no assigned bank account shows cash "—", a null calendar position and null safe-to-pay, with the fix stated (assign an account).
- **Never blocks on Shopify.** `/api/cashflow` answers from local data (~50–250 ms) and kicks a background payments sync when a store is >10 min stale; per-source freshness chips (Bank / Shopify / Meta) on the page.
- **Removed:** the AI "payment plan" (`/api/cashflow/ai`, table `cashflow_ai_plans` left in place, unused) and the in-page store selector (the global store bar drives every page).
- Manual liabilities (investor loans typed into `manual_credit_cards`) are shown but excluded from the 7-day total — they have no due date.

## Phase 3 (not started)

Phase 2: warehouse P&L from `BillingCharge ⟕ Shipment.warehouseId ⟕ Warehouse.country` + carrier invoices by `carrierType`, exposed through a new `x-internal-key` endpoint on ShipSourced; posting layer (integer cents, balanced entries, source ids, period lock); allocation rules; eliminations; monthly close states. Phase 3: evidence-based AI briefings over the validated reporting tools.
