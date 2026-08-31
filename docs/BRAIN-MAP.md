# 🧠 THE BRAIN — Full System Mind Map

*How `/dashboard/transactions` thinks, what it does, and how every piece connects.*
*State as of 2026-08-31. Files referenced are the single source of truth for each fact.*

---

## The one-glance map (every arrow = a real data dependency)

```mermaid
graph TB

subgraph SENSES["1 · SENSES — every 30 min, autonomous"
]
  PLAID["🏦 Banks (Plaid)\nbalances · transactions\npending→posted→amended→retracted\nSTATEMENTS (bal·due·min)\nlib/plaid.ts · lib/bank-sync.ts"]
  SHOP["🛍 Shopify\npayouts scheduled→transit→landed\nreserves · revenue/store\nlib/incoming-cash.ts"]
  FB["📣 Facebook / Google\nspend per ad/set/campaign\nlive campaign status\ninvoices · unbilled · declines\nlib/sync.ts"]
  SS["📦 ShipSourced\norders+COGS (number+date identity)\nfulfillment billing · A/R\nlib/order-pull.ts · lib/shipsourced.ts"]
  MOE["👤 You\nlogged payments · manual statements\nmerchant rules · confirmations\ncard_payments_log · merchant_store_rules"]
end

subgraph CORTEX["2 · CORTEX — naming every dollar (lib/transactions-intel.ts)"]
  CLASS["Classifier\nWHAT is this txn?\nfb_ads·supplier·payment·transfer·owner_draw"]
  MATCH["Likelihood Matcher\nWHO does it belong to?\nexact amount + learned lag + card\nconfidence-scored, ambiguity→review"]
  PAIR["Payment Pairing\ndebit↔credit = ONE payment\none-sided proof when feed blind\npayer's account → payer's debt drops"]
  LEARN["Learning Layer\nfunding aliases (·2976=Platinum)\nlag curves · YOUR rules (XE=SS stock)\npermanent + auditable"]
  IDENT["Identity / Company Layer\nstore↔SS-client↔ad-acct↔card↔account\nYM ↔ SS never blend\nlib/identity.ts · foundation.ts"]
end

subgraph TRUTHS["3 · TRUTHS — recomputed on every sync"]
  CARD["Per CARD\nfull balance (live)\nREMAINING FOR STMT\n= stmt − payments&credits\n(pennies-exact vs issuer,\ncapped at live balance)\n− sent in flight ⏳\ncomposition = balance exactly"]
  STORE["Per STORE\nowes what, on which cards\nalready paid ✓ (credited)\npayouts landing (dated)\nad burn to protect"]
  CO["Per COMPANY\ncash now / usable\nsafe-to-deploy\nlowest 14d point\ninterco debt (real)\nlib/forward-cash.ts"]
  PROD["Per PRODUCT\nrevenue from line items (net-allocated)\nspend via launch registry\n(campaign/ad-set level)\ntest verdicts + still-running\nlib/product-performance.ts"]
end

subgraph DECIDE["4 · DECISIONS"]
  COVER["Coverage Engine (lib/coverage.ts)\ndue-date order claims cash+payouts first\nONE DOLLAR = ONE PROMISE (invariant)\nmoney after pay-date can't fund it\npay date = due − 2 biz days\nday-by-day paydown plans"]
  VERD["Verdicts\n🟢 FUNDED · 🟡 IF PAYOUTS LAND\n🔴 GAP $X · SENT ⏳ · STMT PAID ✓\nEXPIRED (stale data ≠ debt)\nSCALE/WATCH/KILL?/STOPPED (tests)"]
  RISK["Risks, ranked (lib/brain-insights.ts)\noverdue stmts → cash-below-floor dates\n→ payments NOT TAKEN\n→ failing tests STILL spending\n→ payouts stopped · FB declining"]
  ASK["Ask the Brain (api/brain)\ndeterministic Q&A over facts\n'can I spend $X' = simulation\nnever invents a number"]
end

subgraph POLICE["5 · SELF-POLICING"]
  INV["Invariants every run\ncomposition=balance · shares≤balance\nno pending/posted twins\nno dollar twice · remaining≤stmt\nfail = 🔴 FINANCIAL INTEGRITY ERROR"]
  HEART["Feed heartbeats (source-registry)\nstale source → answer carries caveat\nsilence = failure, never success"]
  HEAL["Self-healing\nretracted txns erase · dup connections retire\nsuperseded pendings die · relinks re-attach"]
  TEST["66-check selftest\nscripts/brain-selftest.ts\nruns vs REAL production data"]
end

subgraph TABS["THE TABS = the questions you ask"]
  CMD["🧠 Command\nwhat should I do?"]
  OPS["⚡ Operations\nwho pays what, funded by whom"]
  BANKTAB["🏦 Banks · 💳 Cards\nwhere money sits · what plastic owes"]
  PAYTAB["Payments\ndid submitted money MOVE\n⏳→✓ / ⚠ NOT TAKEN"]
  RESTAB["👥 Payroll · 📣 Ad Spends\n💰 Incoming · Truth · Ledger"]
end

PLAID --> CLASS
PLAID --> PAIR
PLAID -->|statements| CARD
SHOP --> MATCH
SHOP -->|payout schedule| COVER
FB --> MATCH
FB -->|campaign status| PROD
FB -->|unbilled → funding card| CARD
SS -->|orders/line items| PROD
SS -->|billing| STORE
SS -->|A/R| CO
MOE -->|logged payments| PAIR
MOE -->|rules/confirmations| LEARN
MOE -->|manual statements| CARD

CLASS --> MATCH
MATCH --> LEARN
LEARN --> MATCH
MATCH --> IDENT
PAIR --> CARD
PAIR --> STORE
IDENT --> CO
IDENT --> STORE

CLASS --> CARD
CARD --> COVER
STORE --> COVER
CO --> COVER
SHOP --> CO
PROD --> RISK
CARD --> VERD
COVER --> VERD
COVER --> RISK
CO --> ASK
COVER --> ASK
RISK --> CMD
VERD --> OPS
COVER --> CMD
CARD --> BANKTAB
PAIR --> PAYTAB
PROD --> CMD

INV -.polices.-> CARD
INV -.polices.-> COVER
HEART -.caveats.-> ASK
HEART -.caveats.-> CMD
HEAL -.repairs.-> PLAID
TEST -.verifies.-> INV
```

---

## The same map, branch by branch (with the WHY of each connection)

```
🧠 THE BRAIN
│
├── 1 · SENSES ──────────────── "hear everything" (30-min loop, instrumentation.ts)
│   ├── Banks (Plaid) ─────────┐
│   │   ├─ balances/txns ──────┼─→ feeds CLASSIFIER (every txn gets named)
│   │   ├─ lifecycle: pending→posted→amended→RETRACTED
│   │   │      └─→ feeds SELF-HEALING (bounced payment = phantom erased)
│   │   └─ statements (bal·due·min) ─→ feeds PER-CARD TRUTH directly
│   ├── Shopify payouts/reserves ─→ feeds COVERAGE (dated inflows that fund bills)
│   │                             └→ feeds COMPANY CASH (incoming pipeline)
│   ├── FB/Google spend ─→ feeds MATCHER (invoice↔charge) + PRODUCT ENGINE
│   │   └─ live campaign status ─→ feeds TEST VERDICTS ("still running?")
│   ├── ShipSourced orders/billing ─→ feeds PRODUCT revenue + STORE debts + interco
│   └── YOU ─ logged payments → PAIRING · rules/confirmations → LEARNING
│                                └── every answer you give becomes permanent
│
├── 2 · CORTEX ──────────────── "name every dollar" (transactions-intel.ts)
│   ├── WHAT  (classifier) ──connects──→ WHO (matcher needs the class's lag curve)
│   ├── WHO   (matcher) ←─feeds/fed by─→ LEARNING (aliases, lag, your rules)
│   │      └── evidence chain: exact amount + settlement lag + card match
│   │          → confidence · single-candidate+card = 85% floor · ambiguity = review
│   ├── PAIRING ──connects──→ PER-CARD (payments walk remaining down)
│   │            └─connects──→ PER-STORE (payer's OWN account credits payer's debt)
│   └── IDENTITY/COMPANY ──connects──→ everything (YM↔SS never blend;
│           the same layer that routes SS-usage-on-YM-cards into interco debt)
│
├── 3 · TRUTHS ──────────────── "know the state" (recomputed, never stored stale)
│   ├── PER CARD: live balance ≠ statement ≠ remaining ≠ in-flight — four numbers,
│   │        four meanings, each connected to the exact events behind it
│   │        └── remaining drives COVERAGE; composition drives OWED-BY;
│   │            in-flight (your logged payments) drives SENT ⏳
│   ├── PER STORE: owes/paid/landing/burn ── connects to COVERAGE as the
│   │        funding pools ("Purebite's payout funds Purebite's share first")
│   ├── PER COMPANY: usable cash → safe-to-deploy → lowest-14d-point
│   │        └── connects to ASK-THE-BRAIN ("can I spend $50k" simulates this)
│   └── PER PRODUCT: launch registry (campaign/ad-set exact) + net-allocated
│            line-item revenue → test verdicts → connects to RISKS when burning
│
├── 4 · DECISIONS ───────────── "act on it"
│   ├── COVERAGE: obligations in due order eat cash+dated payouts — one dollar,
│   │        one promise (tested invariant) → emits the PAYMENT CALENDAR
│   │        └── connects to VERDICTS (funded/gap) and CMD (what to do today)
│   ├── VERDICTS: every card/test state is a word with evidence, never a color alone
│   ├── RISKS: ranked by money × urgency — each with WHY + ACTION
│   │        └── only live problems (paused burns don't nag — alarm fatigue kills)
│   └── ASK THE BRAIN: deterministic answers from these truths; no LLM in money path
│
├── 5 · SELF-POLICING ───────── "prove it" (what makes trusting it rational)
│   ├── INVARIANTS: math that must hold, checked every run, loud on failure
│   ├── HEARTBEATS: every feed's freshness → degraded feeds degrade confidence visibly
│   ├── SELF-HEALING: retractions, twins, dup connections, relink re-attachment
│   └── 66-CHECK SELFTEST vs production data — including the permanent
│        ShipSourced-settlement regression ($3,984.91+$3,044.84=$7,029.75→$0)
│
└── TABS ────────────────────── each = one question, answered from the truths above
    🧠 Command → ⚡ Operations → 🏦/💳 Accounts → 👥 Payroll → 📣 Ad Spends
    → 💰 Incoming → Payments (⏳→✓/⚠) → Card Intelligence → Source of Truth → Ledger
```

---

## The five laws the connections obey

1. **One pipeline** — every surface reads the same spine; no view computes privately, no view knows less than the Brain.
2. **One dollar, one promise** — cash/payout allocation is exclusive and tested.
3. **Evidence or silence** — attribution needs proof; no proof = untracked (visible), never a guess.
4. **Stale is stated** — a number backed by a dead feed says so; expired manual data is EXPIRED, not debt.
5. **Your answers become rules** — anything only you can know is asked once, then learned forever.
```
