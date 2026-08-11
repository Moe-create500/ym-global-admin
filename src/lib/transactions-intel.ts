import type DatabaseType from 'better-sqlite3';

// ── Transactions Intelligence ────────────────────────────────────────────────
// Unified reconciliation across bank accounts, credit cards and invoices
// (Shopify apps, Facebook ads, Google ads). Every bank transaction gets a
// class (what kind of money movement), a store attribution where possible,
// an invoice match where one exists, and card payments get paired with the
// checking-account transaction that funded them ("who paid what").
//
// Sign conventions differ between Teller and Plaid (and changed over time),
// so classification NEVER trusts the sign — only descriptions and account
// type. Aggregations use ABS(amount_cents).

export type TxnClass =
  | 'fb_ads' | 'google_ads' | 'shopify_app' | 'shopify_payout'
  | 'card_payment' | 'card_payment_sent' | 'transfer'
  | 'interest_fee' | 'supplier' | 'software' | 'personal' | 'other';

export function ensureTxnIntelTables(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS txn_links (
    txn_id TEXT PRIMARY KEY,
    class TEXT NOT NULL DEFAULT 'other',
    store_id TEXT,
    store_source TEXT,
    entity_type TEXT,
    entity_id TEXT,
    pair_txn_id TEXT,
    confidence TEXT NOT NULL DEFAULT 'auto',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_txn_links_class ON txn_links(class)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_txn_links_store ON txn_links(store_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON bank_transactions(date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bank_txn_acct_date ON bank_transactions(bank_account_id, date)`);
  // Match confidence: score (0..1), and the evidence JSON explaining WHY the
  // match was made (dates, lag, card, candidate count) — the audit trail of
  // every likelihood decision.
  const cols: any[] = db.prepare('PRAGMA table_info(txn_links)').all();
  if (!cols.find((c: any) => c.name === 'match_score')) db.exec('ALTER TABLE txn_links ADD COLUMN match_score REAL');
  if (!cols.find((c: any) => c.name === 'match_evidence')) db.exec('ALTER TABLE txn_links ADD COLUMN match_evidence TEXT');
  // One-off charges billed to a store's books (P&L other costs) — timestamped
  // so a transaction can never be billed twice.
  if (!cols.find((c: any) => c.name === 'billed_store_at')) db.exec('ALTER TABLE txn_links ADD COLUMN billed_store_at TEXT');
  // Funding-card aliases: Amex issues sub-cards (·2976, ·9275…) whose charges
  // roll up into an account with a DIFFERENT last4 (Platinum ·1009). Invoices
  // carry the sub-card number, bank feeds carry the account number — without
  // this map every card comparison is a false mismatch.
  db.exec(`CREATE TABLE IF NOT EXISTS fb_funding_cards (
    last4 TEXT PRIMARY KEY,
    bank_account_id TEXT NOT NULL,
    learned_from TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

/** last4 → bank_account_id for funding sub-cards (only aliases whose target
 *  account is still active). */
export function getFundingCardMap(db: DatabaseType.Database): Map<string, string> {
  const rows: any[] = db.prepare(`
    SELECT f.last4, f.bank_account_id FROM fb_funding_cards f
    JOIN bank_accounts a ON a.id = f.bank_account_id AND a.status = 'active'
  `).all();
  return new Map(rows.map(r => [r.last4, r.bank_account_id]));
}

/** Evidence-based alias learning: a funding last4 that matches NO bank account
 *  gets attributed to the account whose ad-platform charges mirror its
 *  invoices (exact amount, settlement-window lag). Requires ≥3 distinct
 *  matched amounts and ≥80% concentration on one account — ambiguity learns
 *  nothing. Safe to re-run; existing aliases are kept. */
export function learnFundingCards(db: DatabaseType.Database): number {
  ensureTxnIntelTables(db);
  const accountL4 = new Set(
    (db.prepare(`SELECT last_four FROM bank_accounts WHERE status = 'active'`).all() as any[])
      .map(r => r.last_four).filter(Boolean)
  );
  const known = new Set((db.prepare('SELECT last4 FROM fb_funding_cards').all() as any[]).map(r => r.last4));
  const invoices: any[] = db.prepare(`
    SELECT card_last4, date, amount_cents FROM ad_payments
    WHERE card_last4 IS NOT NULL AND card_last4 != '' AND date >= date('now', '-120 days')
  `).all();
  const charges: any[] = db.prepare(`
    SELECT t.bank_account_id, t.date, ABS(t.amount_cents) cents
    FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE a.account_type = 'credit' AND a.status = 'active' AND t.status = 'posted'
      AND t.date >= date('now', '-125 days')
      AND (lower(t.description) LIKE '%facebk%' OR lower(t.description) LIKE '%facebook%' OR lower(t.description) LIKE '%google%')
  `).all();
  const chargeIdx = new Map<number, any[]>();
  for (const c of charges) {
    if (!chargeIdx.has(c.cents)) chargeIdx.set(c.cents, []);
    chargeIdx.get(c.cents)!.push(c);
  }
  // votes[last4][account_id] = Set of matched amounts (distinct-amount evidence)
  const votes = new Map<string, Map<string, Set<number>>>();
  for (const inv of invoices) {
    if (accountL4.has(inv.card_last4) || known.has(inv.card_last4)) continue;
    for (const c of chargeIdx.get(Math.abs(inv.amount_cents)) || []) {
      const lag = (new Date(c.date + 'T12:00:00Z').getTime() - new Date(inv.date + 'T12:00:00Z').getTime()) / 86400000;
      if (lag < -1 || lag > 5) continue;
      if (!votes.has(inv.card_last4)) votes.set(inv.card_last4, new Map());
      const byAcct = votes.get(inv.card_last4)!;
      if (!byAcct.has(c.bank_account_id)) byAcct.set(c.bank_account_id, new Set());
      byAcct.get(c.bank_account_id)!.add(Math.abs(inv.amount_cents));
    }
  }
  const ins = db.prepare(`INSERT OR IGNORE INTO fb_funding_cards (last4, bank_account_id, learned_from) VALUES (?, ?, ?)`);
  let learned = 0;
  for (const [l4, byAcct] of votes) {
    const ranked = Array.from(byAcct.entries()).sort((a, b) => b[1].size - a[1].size);
    const total = ranked.reduce((s, [, set]) => s + set.size, 0);
    const [acctId, set] = ranked[0];
    if (set.size >= 3 && set.size / total >= 0.8) {
      ins.run(l4, acctId, `auto: ${set.size} amount matches (${Math.round(100 * set.size / total)}% one account)`);
      learned++;
    }
  }
  return learned;
}

// ── Learned lag model ────────────────────────────────────────────────────────
// The system learns how many days an invoice typically takes to post on the
// card FROM ITS OWN CONFIRMED MATCHES, per platform. Dates rarely line up to
// the dot (FB bills 08/10, Amex posts 08/11-08/12) — so date proximity is a
// scored curve, not a hard cutoff. Laplace-smoothed over a sane prior.
const PRIOR_LAG: Record<number, number> = { 0: 8, 1: 6, 2: 4, 3: 2, [-1]: 2, 4: 1, 5: 1 };

function learnLagCurves(db: DatabaseType.Database): Map<string, Map<number, number>> {
  const rows: any[] = db.prepare(`
    SELECT l.class, CAST(julianday(t.date) - julianday(ap.date) AS INTEGER) AS lag
    FROM txn_links l
    JOIN bank_transactions t ON t.id = l.txn_id
    JOIN ad_payments ap ON ap.id = l.entity_id
    WHERE l.entity_type = 'ad_payment' AND l.entity_id IS NOT NULL
  `).all();
  const curves = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (!curves.has(r.class)) curves.set(r.class, new Map());
    const c = curves.get(r.class)!;
    c.set(r.lag, (c.get(r.lag) || 0) + 1);
  }
  return curves;
}

/** 0..1 — how typical this lag is for this platform, from learned history. */
function lagScore(curves: Map<string, Map<number, number>>, cls: string, lagDays: number): number {
  const learned = curves.get(cls);
  const counts = new Map<number, number>(Object.entries(PRIOR_LAG).map(([k, v]) => [Number(k), v]));
  if (learned) for (const [lag, n] of learned) counts.set(lag, (counts.get(lag) || 0) + n);
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const at = counts.get(lagDays) || 0;
  const peak = Math.max(...counts.values());
  if (!total || !peak) return 0;
  // Normalize against the modal lag so "the most typical delay" scores 1.0
  return at / peak;
}

// Ordered: first match wins. Card-payment rules come before merchant rules so
// "ONLINE PAYMENT FROM CHK 7" never lands in a merchant bucket.
const CREDIT_RULES: Array<[RegExp, TxnClass]> = [
  [/payment - thank you|online payment from chk|autopay payment|payment received/i, 'card_payment'],
  [/interest charge|late fee|annual fee|membership fee|finance charge/i, 'interest_fee'],
  [/facebook|facebk|meta platforms|metaplatforms/i, 'fb_ads'],
  [/cc@google\.com|google *ads|googleads|google llc ads/i, 'google_ads'],
  [/shopify/i, 'shopify_app'],
  [/chargeflow|klaviyo|highlevel|aftership|zendesk|gorgias|triplewhale|northbeam/i, 'shopify_app'],
  [/openai|claude\.ai|anthropic|higgsfield|fal features|midjourney|canva|elevenlabs|apple\.com\/bill|adobe|figma|notion|slack|zoom\.us|godaddy|namecheap|vercel|aws|amazon web serv/i, 'software'],
  [/doordash|dashpass|uber|walmart|7-eleven|instacart|starbucks|chipotle|mcdonald|boatsetter|airbnb|hotel|delta air|united air|shell oil|chevron|costco|target\b|aplpay/i, 'personal'],
];

const DEPOSITORY_RULES: Array<[RegExp, TxnClass]> = [
  [/shopify.*(des:|id:|payout|transfer)|shopify payments payout|ach credit shopify/i, 'shopify_payout'],
  [/american express des:ach pmt|amex epayment|ach hold american express|payment to crd|crd epay|bank of america credit card bill|online banking payment|payment to acct #\d+/i, 'card_payment_sent'],
  [/online banking transfer|online transfer (to|from)|transfer (to|from) (chk|sav)/i, 'transfer'],
  [/wise us inc|alibaba|1688|payoneer/i, 'supplier'],
  [/facebook|facebk/i, 'fb_ads'],
  [/cc@google\.com/i, 'google_ads'],
];

export function classifyDescription(description: string, accountType: string): TxnClass {
  const rules = accountType === 'credit' ? CREDIT_RULES : DEPOSITORY_RULES;
  for (const [re, cls] of rules) if (re.test(description)) return cls;
  return 'other';
}

interface ScanStats {
  scanned: number; classified: number; storeAttributed: number;
  invoiceMatched: number; paymentsPaired: number;
}

export function runTransactionScan(db: DatabaseType.Database, opts: { days?: number; force?: boolean } = {}): ScanStats {
  ensureTxnIntelTables(db);
  const days = Math.min(Math.max(opts.days || 365, 7), 1100);
  const stats: ScanStats = { scanned: 0, classified: 0, storeAttributed: 0, invoiceMatched: 0, paymentsPaired: 0 };

  const txns: any[] = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, t.bank_account_id,
           a.account_type, a.store_id AS account_store_id, a.is_global, a.last_four, a.account_name,
           l.txn_id AS linked, l.confidence AS link_confidence
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id
    LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE t.date >= date('now', ?)
  `).all(`-${days} days`);
  stats.scanned = txns.length;

  // Lookup maps built once — the scan itself is pure in-memory matching.
  const stores: any[] = db.prepare('SELECT id, name FROM stores').all();
  // Word-boundary regex per store: "Aymen" must NOT match inside "PAYMENTS".
  const storeNameMap = stores
    .map(s => ({ id: s.id, re: new RegExp(`\\b${String(s.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') }))
    .filter((s, i) => String(stores[i].name).length >= 4);

  // Ground truth for payout attribution: each store's Shopify payout ledger
  // (synced nightly from the Shopify API into cfo_evidence). A bank deposit
  // matching a ledger payout's exact amount within ±3 days belongs to that
  // store — no guessing from account labels.
  const payoutIdx = new Map<number, Array<{ storeId: string; date: string }>>();
  {
    const seen = new Set<string>();
    for (const ev of db.prepare(`SELECT store_id, rows_json FROM cfo_evidence WHERE kind = 'shopify_payouts'`).all() as any[]) {
      let rows: any[] = [];
      try { rows = JSON.parse(ev.rows_json || '[]'); } catch { continue; }
      for (const r of rows) {
        const cents = Math.abs(r.net_cents ?? r.amount_cents ?? 0);
        const date = r.payout_date || r.date;
        if (!cents || !date) continue;
        const dk = `${ev.store_id}|${r.reference || ''}|${date}|${cents}`;
        if (seen.has(dk)) continue;
        seen.add(dk);
        if (!payoutIdx.has(cents)) payoutIdx.set(cents, []);
        payoutIdx.get(cents)!.push({ storeId: ev.store_id, date });
      }
    }
  }

  // FB funding card → store (only when the card maps to exactly one store)
  const fbCardStores = new Map<string, Set<string>>();
  for (const p of db.prepare(`SELECT store_id, primary_card_last4, working_card_last4 FROM fb_profiles WHERE is_active = 1`).all() as any[]) {
    for (const l4 of [p.primary_card_last4, p.working_card_last4]) {
      if (!l4) continue;
      if (!fbCardStores.has(l4)) fbCardStores.set(l4, new Set());
      fbCardStores.get(l4)!.add(p.store_id);
    }
  }

  // Invoice indexes: amount|last4 → candidate rows (date-checked at match time)
  const adInvoices: any[] = db.prepare(`SELECT id, store_id, platform, date, card_last4, amount_cents FROM ad_payments WHERE date >= date('now', ?)`).all(`-${days + 10} days`);
  const shopInvoices: any[] = db.prepare(`SELECT id, store_id, date, card_last4, total_cents FROM shopify_invoices WHERE date >= date('now', ?)`).all(`-${days + 10} days`);
  const adIdx = new Map<string, any[]>();
  for (const inv of adInvoices) {
    const k = `${Math.abs(inv.amount_cents)}`;
    if (!adIdx.has(k)) adIdx.set(k, []);
    adIdx.get(k)!.push(inv);
  }
  const shopIdx = new Map<string, any[]>();
  for (const inv of shopInvoices) {
    const k = `${Math.abs(inv.total_cents)}`;
    if (!shopIdx.has(k)) shopIdx.set(k, []);
    shopIdx.get(k)!.push(inv);
  }
  const daysApart = (a: string, b: string) => Math.abs((new Date(a + 'T12:00:00Z').getTime() - new Date(b + 'T12:00:00Z').getTime()) / 86400000);

  const upsert = db.prepare(`INSERT INTO txn_links (txn_id, class, store_id, store_source, entity_type, entity_id, pair_txn_id, confidence, match_score, match_evidence, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(txn_id) DO UPDATE SET class = excluded.class, store_id = excluded.store_id, store_source = excluded.store_source,
      entity_type = excluded.entity_type, entity_id = excluded.entity_id,
      pair_txn_id = COALESCE(excluded.pair_txn_id, txn_links.pair_txn_id), confidence = excluded.confidence,
      match_score = excluded.match_score, match_evidence = excluded.match_evidence, updated_at = datetime('now')`);

  // Likelihood curves learned from this system's own confirmed matches
  const lagCurves = learnLagCurves(db);

  // Funding sub-card aliases (·2976 → Platinum account): learn new ones from
  // this window's evidence, then load the full map for card comparisons.
  learnFundingCards(db);
  const fundingMap = getFundingCardMap(db);

  /** Score one invoice candidate against a bank txn: date-lag typicality is
   *  the dominant signal, card last-4 confirms or kills, exact amount is the
   *  entry ticket (already filtered). Returns 0..1. */
  const scoreCandidate = (cls: string, txn: any, inv: any): { score: number; lag: number; cardMatch: boolean } => {
    const lag = Math.round((new Date(txn.date + 'T12:00:00Z').getTime() - new Date(inv.date + 'T12:00:00Z').getTime()) / 86400000);
    if (lag < -2 || lag > 8) return { score: 0, lag, cardMatch: false }; // outside any plausible settlement window
    // Lag typicality, floored inside the normal settlement band: an unusual-
    // but-plausible lag lowers confidence, it doesn't disqualify.
    const ls = Math.max(lagScore(lagCurves, cls, lag), lag >= -1 && lag <= 5 ? 0.3 : 0.1);
    let cardScore: number;
    if (inv.card_last4 && txn.last_four) {
      // Direct last4 match, OR the invoice's funding sub-card is aliased to
      // this txn's account (Amex sub-cards post under the account number)
      const aliased = fundingMap.get(inv.card_last4) === txn.bank_account_id;
      cardScore = (inv.card_last4 === txn.last_four || aliased) ? 1 : -1; // mismatch = hard kill
    } else cardScore = 0.5; // one side unknown — neutral
    if (cardScore < 0) return { score: 0, lag, cardMatch: false };
    return { score: 0.65 * ls + 0.35 * cardScore, lag, cardMatch: cardScore === 1 };
  };

  const cardPayments: any[] = [];   // received on a credit card
  const paymentsSent: any[] = [];   // sent from a checking account

  db.transaction(() => {
    for (const t of txns) {
      // Manual assignments are never overwritten, even on force re-scans.
      if (t.linked && t.link_confidence === 'manual') continue;
      if (t.linked && !opts.force) {
        // already auto-linked — still collect for payment pairing
        const existing: any = db.prepare('SELECT class, pair_txn_id FROM txn_links WHERE txn_id = ?').get(t.id);
        if (existing?.class === 'card_payment' && !existing.pair_txn_id) cardPayments.push(t);
        if (existing?.class === 'card_payment_sent' && !existing.pair_txn_id) paymentsSent.push(t);
        continue;
      }

      const desc = String(t.description || '');
      const cls = classifyDescription(desc, t.account_type);
      stats.classified++;

      let storeId: string | null = null;
      let storeSource: string | null = null;
      let entityType: string | null = null;
      let entityId: string | null = null;
      let matchScore: number | null = null;
      let matchEvidence: string | null = null;
      const amt = Math.abs(t.amount_cents);

      // 1. Invoice match — LIKELIHOOD-SCORED, not binary. Exact amount is the
      // entry ticket; then candidates are ranked by how typical the date lag
      // is (learned from confirmed history) + card last-4 agreement. The best
      // wins if it clearly beats the runner-up; a true tie is recorded as
      // 'review' with the evidence, instead of a silent abstain.
      if (cls === 'fb_ads' || cls === 'google_ads' || cls === 'shopify_app') {
        const isAd = cls !== 'shopify_app';
        const platform = cls === 'fb_ads' ? 'facebook' : 'google';
        const pool = isAd
          ? (adIdx.get(`${amt}`) || []).filter(i => i.platform === platform)
          : (shopIdx.get(`${amt}`) || []);
        const scored = pool
          .map(inv => ({ inv, ...scoreCandidate(cls, t, inv) }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score);
        if (scored.length) {
          const best = scored[0];
          const second = scored[1];
          const margin = second ? best.score - second.score : 1;
          // Uniqueness is itself evidence: ONE candidate at this exact amount
          // with the card confirmed = there is nothing else it could be.
          if (scored.length === 1 && best.cardMatch) best.score = Math.max(best.score, 0.85);
          else if (scored.length === 1 && best.score > 0) best.score = Math.max(best.score, 0.55);
          const evidence = {
            invoiceDate: best.inv.date, txnDate: t.date, lagDays: best.lag,
            card: best.inv.card_last4 && t.last_four
              ? (best.inv.card_last4 === t.last_four ? 'match'
                : fundingMap.get(best.inv.card_last4) === t.bank_account_id ? 'match_via_funding_alias' : 'unknown')
              : 'partial',
            candidates: scored.length, score: Math.round(best.score * 100) / 100,
          };
          // Accept: confident score AND clear separation from the runner-up
          if (best.score >= 0.4 && (scored.length === 1 || margin >= 0.12)) {
            storeId = best.inv.store_id; storeSource = 'invoice';
            entityType = isAd ? 'ad_payment' : 'shopify_invoice';
            entityId = best.inv.id;
            matchScore = best.score;
            matchEvidence = JSON.stringify(evidence);
            stats.invoiceMatched++;
          } else {
            // Genuine ambiguity — surface it for a human instead of guessing
            matchScore = best.score;
            matchEvidence = JSON.stringify({ ...evidence, review: true, runnerUpScore: second ? Math.round(second.score * 100) / 100 : null });
          }
        }
      }

      // 2. payout ledger match — the strongest signal for payout deposits.
      // Only accept when every candidate ledger payout agrees on the store.
      if (!storeId && cls === 'shopify_payout') {
        const cands = (payoutIdx.get(amt) || []).filter(pmt => daysApart(pmt.date, t.date) <= 3);
        const storeSet = new Set(cands.map(pmt => pmt.storeId));
        if (storeSet.size === 1) {
          storeId = [...storeSet][0]; storeSource = 'payout_ledger';
          stats.invoiceMatched++;
        }
      }

      // 3. store name as a whole word in the description (payout INDN/ID carry it)
      if (!storeId) {
        const hit = storeNameMap.find(s => s.re.test(desc));
        if (hit) { storeId = hit.id; storeSource = 'description'; }
      }

      // 4. the account itself belongs to a store — checking accounts only,
      // and only when the ACCOUNT NAME itself names the store (self-evident
      // ownership like "PUREBITE ··5653"). Shared accounts ("Main payout
      // account", "STORE CASHFLOW") prove nothing about individual deposits.
      if (!storeId && t.account_store_id && !t.is_global && t.account_type !== 'credit') {
        const owner = storeNameMap.find(s => s.id === t.account_store_id);
        if (owner && owner.re.test(String(t.account_name || ''))) {
          storeId = t.account_store_id; storeSource = 'account';
        }
      }

      // 5. FB funding-card map, only when unambiguous
      if (!storeId && cls === 'fb_ads' && t.last_four) {
        const set = fbCardStores.get(t.last_four);
        if (set && set.size === 1) { storeId = [...set][0]; storeSource = 'fb_card'; }
      }

      if (storeId) stats.storeAttributed++;
      upsert.run(t.id, cls, storeId, storeSource, entityType, entityId, null, 'auto', matchScore, matchEvidence);

      if (cls === 'card_payment') cardPayments.push(t);
      if (cls === 'card_payment_sent') paymentsSent.push(t);
    }

    // ── Pair card payments with the checking transaction that funded them ──
    // Exact ABS amount, closest date within 6 days, each side used once.
    const setPair = db.prepare(`UPDATE txn_links SET pair_txn_id = ?, updated_at = datetime('now') WHERE txn_id = ?`);
    const usedSent = new Set<string>();
    for (const cp of cardPayments) {
      const amt = Math.abs(cp.amount_cents);
      let best: any = null, bestGap = 7;
      for (const ps of paymentsSent) {
        if (usedSent.has(ps.id) || Math.abs(ps.amount_cents) !== amt) continue;
        const gap = daysApart(cp.date, ps.date);
        if (gap <= 6 && gap < bestGap) { best = ps; bestGap = gap; }
      }
      if (best) {
        usedSent.add(best.id);
        setPair.run(best.id, cp.id);
        setPair.run(cp.id, best.id);
        stats.paymentsPaired++;
      }
    }
  })();

  return stats;
}

// ── Read views ───────────────────────────────────────────────────────────────

export function getLedger(db: DatabaseType.Database, f: {
  accountId?: string; storeId?: string; cls?: string; q?: string;
  unattributed?: boolean; days?: number; limit?: number; offset?: number;
}) {
  ensureTxnIntelTables(db);
  const where: string[] = [`t.date >= date('now', ?)`];
  const params: any[] = [`-${Math.min(f.days || 90, 1100)} days`];
  if (f.accountId) { where.push('t.bank_account_id = ?'); params.push(f.accountId); }
  if (f.storeId) { where.push('l.store_id = ?'); params.push(f.storeId); }
  if (f.cls) { where.push('l.class = ?'); params.push(f.cls); }
  if (f.q) { where.push('t.description LIKE ?'); params.push(`%${f.q}%`); }
  if (f.unattributed) where.push('l.store_id IS NULL');
  const limit = Math.min(f.limit || 200, 500);
  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, t.bank_account_id,
           a.institution_name, a.account_name, a.account_type, a.last_four,
           l.class, l.store_id, l.store_source, l.entity_type, l.pair_txn_id, l.confidence,
           l.match_score, l.match_evidence, l.billed_store_at,
           s.name AS store_name
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id
    LEFT JOIN txn_links l ON l.txn_id = t.id
    LEFT JOIN stores s ON s.id = l.store_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.date DESC, t.id DESC LIMIT ${limit} OFFSET ${Math.max(f.offset || 0, 0)}
  `).all(...params);
  const total: any = db.prepare(`
    SELECT COUNT(*) AS n FROM bank_transactions t LEFT JOIN txn_links l ON l.txn_id = t.id
    JOIN bank_accounts a ON a.id = t.bank_account_id WHERE ${where.join(' AND ')}
  `).get(...params);
  return { rows, total: total?.n || 0 };
}

/** Per-card debt intelligence: what drove the balance and who paid it down. */
export function getCardIntel(db: DatabaseType.Database, days: number) {
  ensureTxnIntelTables(db);
  const d = `-${Math.min(days || 30, 365)} days`;
  const cards: any[] = db.prepare(`
    SELECT id, institution_name, account_name, last_four, provider, status,
           balance_ledger_cents, credit_limit_cents, bank_data_as_of
    FROM bank_accounts WHERE account_type = 'credit' AND status = 'active'
    ORDER BY balance_ledger_cents DESC
  `).all();
  const byClass = db.prepare(`
    SELECT l.class, COUNT(*) n, SUM(ABS(t.amount_cents)) cents
    FROM bank_transactions t JOIN txn_links l ON l.txn_id = t.id
    WHERE t.bank_account_id = ? AND t.date >= date('now', ?) AND l.class NOT IN ('card_payment')
    GROUP BY l.class ORDER BY cents DESC
  `);
  const byStore = db.prepare(`
    SELECT COALESCE(s.name, '(unattributed)') store, SUM(ABS(t.amount_cents)) cents
    FROM bank_transactions t JOIN txn_links l ON l.txn_id = t.id
    LEFT JOIN stores s ON s.id = l.store_id
    WHERE t.bank_account_id = ? AND t.date >= date('now', ?) AND l.class NOT IN ('card_payment')
    GROUP BY s.name ORDER BY cents DESC LIMIT 8
  `);
  const topMerchants = db.prepare(`
    SELECT substr(t.description, 1, 28) merchant, COUNT(*) n, SUM(ABS(t.amount_cents)) cents
    FROM bank_transactions t JOIN txn_links l ON l.txn_id = t.id
    WHERE t.bank_account_id = ? AND t.date >= date('now', ?) AND l.class NOT IN ('card_payment')
    GROUP BY substr(t.description, 1, 18) ORDER BY cents DESC LIMIT 6
  `);
  const payments = db.prepare(`
    SELECT t.id, t.date, ABS(t.amount_cents) cents, l.pair_txn_id,
           pa.account_name AS from_account, pa.last_four AS from_last4, pa.institution_name AS from_institution
    FROM bank_transactions t JOIN txn_links l ON l.txn_id = t.id
    LEFT JOIN bank_transactions pt ON pt.id = l.pair_txn_id
    LEFT JOIN bank_accounts pa ON pa.id = pt.bank_account_id
    WHERE t.bank_account_id = ? AND t.date >= date('now', ?) AND l.class = 'card_payment'
    ORDER BY t.date DESC LIMIT 12
  `);
  return cards.map(c => ({
    ...c,
    drivers: byClass.all(c.id, d),
    byStore: byStore.all(c.id, d),
    topMerchants: topMerchants.all(c.id, d),
    payments: payments.all(c.id, d),
  }));
}

/** Card clarity — the "why is there debt and what clears it" layer.
 *  Per card: posted debt + pending holds + FB unbilled spend routed to it
 *  (fb_profiles funding-card mapping) − payments in flight = to clear.
 *  Globally: FB owed balances NOT mapped to any known card (configuration
 *  gaps to fix), sent payments that never landed, and cash on hand. */
export function getCardClarity(db: DatabaseType.Database) {
  ensureTxnIntelTables(db);
  const cards: any[] = db.prepare(`
    SELECT id, institution_name, account_name, last_four, provider,
           balance_ledger_cents, credit_limit_cents, bank_data_as_of
    FROM bank_accounts WHERE account_type = 'credit' AND status = 'active'
  `).all();

  // Pending activity per card, split into holds (charges) vs payments landing.
  // 14-day window: Teller leaves superseded pending rows behind forever (some
  // date back months) — those are artifacts, not live holds, and counting them
  // would wildly overstate "to clear".
  const pendingQ = db.prepare(`
    SELECT SUM(CASE WHEN COALESCE(l.class,'') != 'card_payment' THEN ABS(t.amount_cents) ELSE 0 END) holds_cents,
           SUM(CASE WHEN COALESCE(l.class,'') != 'card_payment' THEN 1 ELSE 0 END) holds_n,
           SUM(CASE WHEN l.class = 'card_payment' THEN ABS(t.amount_cents) ELSE 0 END) landing_cents
    FROM bank_transactions t LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE t.bank_account_id = ? AND t.status = 'pending' AND t.date >= date('now', '-14 days')
  `);

  // FB unbilled balances routed to each card via the funding-card last4
  const profiles: any[] = db.prepare(`
    SELECT p.id, p.profile_name, s.name AS store_name, p.balance_cents,
           p.primary_card_last4, p.working_card_last4, p.primary_card_declining, p.last_sync_at
    FROM fb_profiles p JOIN stores s ON s.id = p.store_id
    WHERE p.is_active = 1 AND (p.balance_cents > 0 OR p.primary_card_declining = 1)
  `).all();
  // Sub-card aliases: a funding last4 (·2976) that posts under a different
  // account number (·1009) still routes to that card, not to "unmapped".
  // Keyed by account ID — two cards can share a last4 (Gold/Platinum ·1009).
  const fundingMap = getFundingCardMap(db);
  const fbByCard = new Map<string, any[]>();
  const unmappedFb: any[] = [];
  for (const p of profiles) {
    const l4 = p.primary_card_last4 || p.working_card_last4;
    const direct = l4 ? cards.filter(c => c.last_four === l4).map(c => c.id) : [];
    const targets = direct.length ? direct : (l4 && fundingMap.has(l4) ? [fundingMap.get(l4)!] : []);
    if (targets.length) {
      for (const cid of targets) {
        if (!fbByCard.has(cid)) fbByCard.set(cid, []);
        fbByCard.get(cid)!.push(p);
      }
    } else if (p.balance_cents > 0) {
      unmappedFb.push(p); // owed to FB but the funding card isn't a linked bank card
    }
  }

  // Payments that left a checking account but never paired with a card credit
  const inFlight: any[] = db.prepare(`
    SELECT t.id, t.date, ABS(t.amount_cents) cents, t.description,
           a.account_name AS from_account, a.last_four AS from_last4
    FROM bank_transactions t
    JOIN txn_links l ON l.txn_id = t.id AND l.class = 'card_payment_sent' AND l.pair_txn_id IS NULL
    JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE t.date >= date('now', '-10 days')
    ORDER BY t.date DESC LIMIT 20
  `).all();

  // Cash on hand across active checking/savings — what's available to clean with
  const cash: any = db.prepare(`
    SELECT SUM(COALESCE(balance_available_cents, balance_ledger_cents, 0)) cents
    FROM bank_accounts WHERE account_type != 'credit' AND status = 'active' AND COALESCE(cfo_hidden, 0) = 0
  `).get();

  const perCard = cards.map(c => {
    const pending: any = pendingQ.get(c.id) || {};
    const fb = fbByCard.get(c.id) || [];
    const fbOwedCents = fb.reduce((s, p) => s + (p.balance_cents || 0), 0);
    const declining = fb.some(p => p.primary_card_declining);
    const posted = Math.abs(c.balance_ledger_cents || 0);
    const holds = pending.holds_cents || 0;
    const landing = pending.landing_cents || 0;
    return {
      id: c.id,
      postedCents: posted,
      pendingHoldsCents: holds,
      pendingHoldsN: pending.holds_n || 0,
      paymentsLandingCents: landing,
      fbOwedCents,
      fbProfiles: fb.map(p => ({
        name: p.profile_name, store: p.store_name, owedCents: p.balance_cents || 0,
        declining: !!p.primary_card_declining, lastSyncAt: p.last_sync_at,
      })),
      declining,
      // what it takes to zero this card once everything lands
      toClearCents: Math.max(0, posted + holds + fbOwedCents - landing),
      utilizationPct: c.credit_limit_cents > 0 ? Math.round(100 * (posted + holds) / c.credit_limit_cents) : null,
    };
  });

  return {
    perCard: Object.fromEntries(perCard.map(c => [c.id, c])),
    unmappedFb: unmappedFb.map(p => ({
      name: p.profile_name, store: p.store_name, owedCents: p.balance_cents || 0,
      card_last4: p.primary_card_last4 || p.working_card_last4 || null,
      declining: !!p.primary_card_declining,
    })),
    unmappedFbCents: unmappedFb.reduce((s, p) => s + (p.balance_cents || 0), 0),
    inFlight,
    inFlightCents: inFlight.reduce((s: number, p: any) => s + p.cents, 0),
    cashAvailableCents: cash?.cents || 0,
    totalFbOwedCents: profiles.reduce((s, p) => s + (p.balance_cents || 0), 0),
  };
}

/** Strict source-of-truth decomposition.
 *  A) Card balance composition: charges newest-first until they sum to the
 *     posted balance — the exact unpaid charges behind each total, grouped by
 *     class and store, with any un-coverable remainder shown as a gap (data
 *     honesty: history that can't explain a balance says so).
 *  B) Ad spend lifecycle per store: accrued (Insights) → billed (Meta
 *     invoices) → riding unpaid on a card → settled, plus FB's own unbilled
 *     balance and the accrued-vs-billed reconciliation gap. */
export function getTruth(db: DatabaseType.Database, days: number) {
  ensureTxnIntelTables(db);
  const d = `-${Math.min(Math.max(days || 90, 30), 365)} days`;

  const cards: any[] = db.prepare(`
    SELECT id, institution_name, account_name, last_four, balance_ledger_cents, bank_data_as_of
    FROM bank_accounts WHERE account_type = 'credit' AND status = 'active'
    ORDER BY ABS(balance_ledger_cents) DESC
  `).all();

  const chargesQ = db.prepare(`
    SELECT t.id, t.date, t.description, ABS(t.amount_cents) cents,
           COALESCE(l.class, 'other') class, l.store_id, s.name AS store_name
    FROM bank_transactions t
    LEFT JOIN txn_links l ON l.txn_id = t.id
    LEFT JOIN stores s ON s.id = l.store_id
    WHERE t.bank_account_id = ? AND t.status != 'pending'
      AND COALESCE(l.class, 'other') NOT IN ('card_payment')
      AND t.date >= date('now', '-540 days')
    ORDER BY t.date DESC, t.id DESC
  `);

  // FB charges that are part of an unpaid balance, per store — filled in below
  const fbUnpaidByStore = new Map<string, number>();

  const composition = cards.map(c => {
    const posted = Math.abs(c.balance_ledger_cents || 0);
    const rows: any[] = chargesQ.all(c.id);
    const included: any[] = [];
    let acc = 0;
    for (const r of rows) {
      if (acc >= posted) break;
      // Partial inclusion for the oldest charge that crosses the boundary —
      // strictness over neatness: only the still-unpaid portion counts.
      const take = Math.min(r.cents, posted - acc);
      acc += take;
      included.push({ ...r, unpaidCents: take });
      if (r.class === 'fb_ads') {
        const key = r.store_name || '(unattributed)';
        fbUnpaidByStore.set(key, (fbUnpaidByStore.get(key) || 0) + take);
      }
    }
    const remainder = Math.max(0, posted - acc); // balance history can't explain
    const byGroup = new Map<string, { class: string; store: string; cents: number; n: number }>();
    for (const r of included) {
      const store = r.store_name || '(unattributed)';
      const k = `${r.class}|${store}`;
      if (!byGroup.has(k)) byGroup.set(k, { class: r.class, store, cents: 0, n: 0 });
      const g = byGroup.get(k)!;
      g.cents += r.unpaidCents; g.n++;
    }
    return {
      id: c.id, institution: c.institution_name, name: c.account_name, last4: c.last_four,
      asOf: c.bank_data_as_of, postedCents: posted,
      groups: [...byGroup.values()].sort((a, b) => b.cents - a.cents),
      oldestUnpaidDate: included.length ? included[included.length - 1].date : null,
      unexplainedCents: remainder,
      explainedPct: posted > 0 ? Math.round(100 * acc / posted) : 100,
    };
  });

  // B) Ad spend lifecycle per store (facebook)
  const accrued: any[] = db.prepare(`
    SELECT a.store_id, s.name AS store, SUM(a.spend_cents) cents
    FROM ad_spend a JOIN stores s ON s.id = a.store_id
    WHERE a.platform = 'facebook' AND a.date >= date('now', ?)
    GROUP BY a.store_id
  `).all(d);
  const billed: any[] = db.prepare(`
    SELECT p.store_id, s.name AS store, SUM(p.amount_cents) cents, COUNT(*) n
    FROM ad_payments p JOIN stores s ON s.id = p.store_id
    WHERE p.platform = 'facebook' AND p.date >= date('now', ?)
    GROUP BY p.store_id
  `).all(d);
  const bankSeen: any[] = db.prepare(`
    SELECT COALESCE(s.name, '(unattributed)') store, SUM(ABS(t.amount_cents)) cents
    FROM bank_transactions t
    JOIN txn_links l ON l.txn_id = t.id AND l.class = 'fb_ads'
    LEFT JOIN stores s ON s.id = l.store_id
    WHERE t.date >= date('now', ?)
    GROUP BY s.name
  `).all(d);
  const unbilled: any[] = db.prepare(`
    SELECT s.name AS store, SUM(p.balance_cents) cents
    FROM fb_profiles p JOIN stores s ON s.id = p.store_id
    WHERE p.is_active = 1 AND p.balance_cents > 0
    GROUP BY s.name
  `).all();

  const storeNames = new Set<string>([
    ...accrued.map(r => r.store), ...billed.map(r => r.store),
    ...bankSeen.map(r => r.store), ...unbilled.map(r => r.store),
    ...fbUnpaidByStore.keys(),
  ]);
  const idx = (rows: any[]) => new Map(rows.map(r => [r.store, r.cents || 0]));
  const accIdx = idx(accrued), billIdx = idx(billed), bankIdx = idx(bankSeen), unbIdx = idx(unbilled);

  const adTruth = [...storeNames].map(store => {
    const acc = accIdx.get(store) || 0;
    const bill = billIdx.get(store) || 0;
    const bank = bankIdx.get(store) || 0;
    const unb = unbIdx.get(store) || 0;
    const ridingUnpaid = fbUnpaidByStore.get(store) || 0;
    return {
      store,
      accruedCents: acc,            // spend that happened (Insights)
      billedCents: bill,            // Meta invoiced it
      bankSeenCents: bank,          // the charge is visible on a linked card/bank
      unbilledCents: unb,           // FB is still going to charge this
      ridingUnpaidCents: ridingUnpaid, // billed, on a card, card not paid down past it
      settledCents: Math.max(0, bank - ridingUnpaid), // on a card AND covered by payments
      // accrued should ≈ billed + unbilled; anything else is a data/config gap
      gapCents: acc - bill - unb,
      billedNotSeenCents: Math.max(0, bill - bank), // invoiced but invisible in banking → unlinked card
    };
  }).filter(r => r.accruedCents || r.billedCents || r.bankSeenCents || r.unbilledCents)
    .sort((a, b) => b.accruedCents - a.accruedCents);

  return { composition, adTruth, windowDays: Math.min(Math.max(days || 90, 30), 365) };
}

/** All card payments in the window, with the funding account when paired. */
export function getPaymentsView(db: DatabaseType.Database, days: number) {
  ensureTxnIntelTables(db);
  const d = `-${Math.min(days || 60, 365)} days`;
  return db.prepare(`
    SELECT t.id, t.date, ABS(t.amount_cents) cents,
           ca.institution_name card_institution, ca.account_name card_name, ca.last_four card_last4,
           l.pair_txn_id, pa.account_name from_account, pa.last_four from_last4
    FROM bank_transactions t
    JOIN txn_links l ON l.txn_id = t.id AND l.class = 'card_payment'
    JOIN bank_accounts ca ON ca.id = t.bank_account_id
    LEFT JOIN bank_transactions pt ON pt.id = l.pair_txn_id
    LEFT JOIN bank_accounts pa ON pa.id = pt.bank_account_id
    WHERE t.date >= date('now', ?)
    ORDER BY t.date DESC LIMIT 200
  `).all(d);
}

/** Pay Cards decision engine — WHICH cards can be paid, funded by WHAT.
 *  Combines three truths:
 *   · card debt + who built it (balance composition by store, from getTruth)
 *   · live cashflow per store (landed / in-transit / scheduled, from the
 *     Shopify payout projection) + global cash and the ad-burn safety buffer
 *   · card priority (FB-declining first — ads die without it — then
 *     utilization, then size)
 *  Output per card: PAY NOW $X (from today's safe envelope), the date the
 *  rest becomes payable as landings arrive, and whether the stores that OWE
 *  the card have the cashflow to cover their share. */
/** Payroll pool — obligations with hard dates, entered by Moe. Payroll gets
 *  paid before cards: items due within 7 days come straight off the safe
 *  envelope before any card funding is recommended. */
export function ensurePayrollTable(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS payroll_items (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    store_id TEXT,
    recurrence TEXT NOT NULL DEFAULT 'once',
    paid_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
}

export function ensureCardStatements(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS card_statements (
    bank_account_id TEXT PRIMARY KEY,
    statement_balance_cents INTEGER,
    statement_date TEXT,
    due_date TEXT,
    min_payment_cents INTEGER,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
}

export function getPayPlan(db: DatabaseType.Database) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildCashflowProjection } = require('./cashflow');
  ensureCardStatements(db);
  ensurePayrollTable(db);
  const projection = buildCashflowProjection(db);
  const clarity = getCardClarity(db);
  const truth = getTruth(db, 90);
  const statements = new Map<string, any>(
    (db.prepare('SELECT * FROM card_statements').all() as any[]).map(s => [s.bank_account_id, s])
  );

  // Per-store near-term cashflow: money that is real (landed today, paid out,
  // or date-committed by Shopify). Projected shown separately — softer.
  const storeFlow = new Map<string, { committed: number; projected: number }>();
  for (const s of projection.stores) {
    storeFlow.set(s.store_name, {
      committed: (s.landed_today_cents || 0) + s.in_transit_cents + s.scheduled_cents,
      projected: s.projected_cents || 0,
    });
  }

  // Card debt composition by store (from the truth walk)
  const compByCardId = new Map(truth.composition.map((c: any) => [c.id, c]));

  const cardsMeta: any[] = db.prepare(`
    SELECT id, institution_name, account_name, last_four
    FROM bank_accounts WHERE account_type = 'credit' AND status = 'active'
  `).all();

  const cards = cardsMeta.map(meta => {
    const cl = clarity.perCard[meta.id];
    const comp: any = compByCardId.get(meta.id);
    if (!cl || cl.toClearCents <= 0) return null;
    // Store shares of this card's unpaid balance
    const shares = new Map<string, number>();
    for (const g of comp?.groups || []) shares.set(g.store, (shares.get(g.store) || 0) + g.cents);
    const owners = [...shares.entries()]
      .map(([store, cents]) => {
        const flow = storeFlow.get(store);
        return {
          store, owesCents: cents,
          storeCommittedCents: flow?.committed ?? null,   // null = store not in payout projection
          storeProjectedCents: flow?.projected ?? null,
          covered: flow ? flow.committed >= cents : null, // that store's real cashflow covers its share
        };
      })
      .sort((a, b) => b.owesCents - a.owesCents);
    const utilization = cl.utilizationPct ?? 0;
    const stmt = statements.get(meta.id);
    const dueDate = stmt?.due_date || null;
    const daysToDue = dueDate
      ? Math.round((new Date(dueDate + 'T12:00:00Z').getTime() - new Date(projection.generated_at_date + 'T12:00:00Z').getTime()) / 86400000)
      : null;
    return {
      id: meta.id,
      name: `${meta.institution_name} ${meta.account_name}`,
      last4: meta.last_four,
      postedCents: cl.postedCents,
      toClearCents: cl.toClearCents,
      pendingHoldsCents: cl.pendingHoldsCents,
      paymentsLandingCents: cl.paymentsLandingCents,
      fbOwedCents: cl.fbOwedCents,
      declining: cl.declining,
      utilization,
      owners,
      unexplainedCents: comp?.unexplainedCents || 0,
      // Statement reality — what must actually be paid, and by when. No
      // statement entered = the need is unknown; the UI asks for it rather
      // than inventing a number.
      stmtBalanceCents: stmt?.statement_balance_cents ?? null,
      stmtDate: stmt?.statement_date || null,
      dueDate,
      daysToDue,
      minPaymentCents: stmt?.min_payment_cents ?? null,
    };
  }).filter(Boolean) as any[];

  // Order of operations: declining first (ads die), then earliest due date
  // (undated cards after dated ones), then highest utilization.
  cards.sort((a, b) =>
    (a.declining ? 0 : 1) - (b.declining ? 0 : 1)
    || (a.daysToDue ?? 9999) - (b.daysToDue ?? 9999)
    || (b.utilization || 0) - (a.utilization || 0));

  // ── FUNDING — every recommended dollar has an identified owner ──
  // 1. Stores that put the debt on the card pay first, from their own free
  //    cashflow (committed landings − 7d of their own ads), capped at their share.
  // 2. Only the untraced remainder draws from company shared cash (cash − 7d
  //    total ad burn). No blind pooling.
  const burnPerStore = new Map<string, number>(projection.stores.map((s: any) => [s.store_name, s.avg_daily_ad_burn_cents || 0]));
  const storeFreePool = new Map<string, number>();
  for (const [name, flow] of storeFlow) {
    storeFreePool.set(name, Math.max(0, flow.committed - (burnPerStore.get(name) || 0) * 7));
  }
  // Payroll first: unpaid items due within 7 days come off the safe envelope
  // BEFORE any card gets a dollar. Hard dates beat revolving debt.
  const payrollItems: any[] = db.prepare(`
    SELECT p.*, s.name AS store_name FROM payroll_items p
    LEFT JOIN stores s ON s.id = p.store_id
    WHERE p.paid_at IS NULL AND p.due_date <= date('now', '+45 days')
    ORDER BY p.due_date ASC
  `).all();
  const payrollDue7 = payrollItems
    .filter(p => p.due_date <= projection.calendar[Math.min(7, projection.calendar.length - 1)]?.date)
    .reduce((s, p) => s + p.amount_cents, 0);
  let companyPool = Math.max(0, projection.position.safe_to_pay_today_cents - payrollDue7);

  // Ad engine live state: what's actually spending right now
  const today = projection.generated_at_date;
  let campaignsToday: any = db.prepare(
    `SELECT COUNT(DISTINCT campaign_id) n, COALESCE(SUM(spend_cents), 0) cents, MAX(date) date FROM ad_spend WHERE date = ?`
  ).get(today);
  if (!campaignsToday?.cents) {
    campaignsToday = db.prepare(
      `SELECT COUNT(DISTINCT campaign_id) n, COALESCE(SUM(spend_cents), 0) cents, MAX(date) date FROM ad_spend WHERE date = date(?, '-1 day')`
    ).get(today);
  }

  // Shopify app billing per card+store (last 30d = the recurring monthly load)
  const shopifyByCard = new Map<string, { store: string; cents: number }[]>();
  for (const r of db.prepare(`
    SELECT i.card_last4, s.name AS store, SUM(i.total_cents) cents
    FROM shopify_invoices i JOIN stores s ON s.id = i.store_id
    WHERE i.date >= date('now', '-30 days') AND i.card_last4 IS NOT NULL AND i.card_last4 != ''
    GROUP BY i.card_last4, s.name ORDER BY cents DESC
  `).all() as any[]) {
    if (!shopifyByCard.has(r.card_last4)) shopifyByCard.set(r.card_last4, []);
    shopifyByCard.get(r.card_last4)!.push({ store: r.store, cents: r.cents });
  }

  for (const c of cards) {
    // The WHY: what feeds this card's balance, from every data pool
    const cl2 = clarity.perCard[c.id];
    c.why = {
      tracedStores: c.owners.filter((o: any) => o.store !== '(unattributed)'),
      fbAccounts: cl2?.fbProfiles || [],                    // FB unbilled, per ad account + store
      shopifyMonthly: shopifyByCard.get(c.last4) || [],     // app billing hitting this card, per store
      untracedCents: (c.owners.find((o: any) => o.store === '(unattributed)')?.owesCents || 0) + (c.unexplainedCents || 0),
    };
  }

  for (const c of cards) {
    const hasStatement = c.stmtBalanceCents != null;
    // No statement = the amount due is UNKNOWN. The card draws nothing from
    // anyone's pool until the statement is entered — money is never allocated
    // against an invented number.
    if (!hasStatement) {
      c.hasStatement = false;
      c.needCents = null;
      c.payNowCents = 0;
      c.funding = [];
      c.shortCents = 0;
      c.minCovered = null;
      c.verdict = 'no_statement';
      continue;
    }
    const need = c.stmtBalanceCents;
    let remaining = need;
    const funding: { source: string; cents: number }[] = [];
    for (const o of c.owners) {
      if (o.store === '(unattributed)' || remaining <= 0) continue;
      const pool = storeFreePool.get(o.store) || 0;
      const take = Math.min(pool, o.owesCents, remaining);
      if (take > 0) {
        funding.push({ source: o.store, cents: take });
        storeFreePool.set(o.store, pool - take);
        remaining -= take;
      }
    }
    if (remaining > 0 && companyPool > 0) {
      const take = Math.min(companyPool, remaining);
      funding.push({ source: 'company', cents: take });
      companyPool -= take;
      remaining -= take;
    }
    c.hasStatement = hasStatement;
    c.needCents = need;
    c.payNowCents = need - remaining;
    c.funding = funding;
    c.shortCents = remaining;
    c.minCovered = c.minPaymentCents != null ? c.payNowCents >= c.minPaymentCents : null;
    c.verdict = !hasStatement ? 'no_statement'
      : c.payNowCents >= need ? 'pay_full'
      : c.payNowCents > 0 ? 'pay_partial'
      : 'not_funded';
  }

  // ── STORE-FIRST VIEW — each store owns its balances and pays them from its
  // own cashflow. Per store: what it owes on which cards, its committed
  // landings this week, its own ad burn to protect, and the verdict.
  const storeAgg = new Map<string, { owed: { cardName: string; last4: string; cents: number; declining: boolean }[]; owedTotal: number }>();
  for (const c of cards) {
    for (const o of c.owners) {
      if (o.store === '(unattributed)') continue;
      if (!storeAgg.has(o.store)) storeAgg.set(o.store, { owed: [], owedTotal: 0 });
      const agg = storeAgg.get(o.store)!;
      agg.owed.push({ cardName: c.name, last4: c.last4, cents: o.owesCents, declining: c.declining });
      agg.owedTotal += o.owesCents;
    }
  }
  const burnByStore = new Map<string, number>(projection.stores.map((s: any) => [s.store_name, s.avg_daily_ad_burn_cents || 0]));

  const storePlans = [...storeAgg.entries()].map(([store, agg]) => {
    const flow = storeFlow.get(store);
    const committed = flow?.committed ?? 0;
    const projected = flow?.projected ?? 0;
    const burn7 = (burnByStore.get(store) || 0) * 7;
    // The store's own payable envelope: its committed landings minus a week of
    // its own ad spend. Its money, its ads, its debts.
    const envelopeStore = Math.max(0, committed - burn7);
    const canPay = Math.min(agg.owedTotal, envelopeStore);
    const short = agg.owedTotal - canPay;
    return {
      store,
      owed: agg.owed.sort((a, b) => (a.declining ? -1 : 0) - (b.declining ? -1 : 0) || b.cents - a.cents),
      owedTotal: agg.owedTotal,
      committedCents: committed,
      projectedCents: projected,
      burn7Cents: burn7,
      hasFeed: !!flow,
      canPayCents: canPay,
      shortCents: short,
      verdict: !flow ? 'no_feed'
        : canPay >= agg.owedTotal ? 'covers'
        : canPay > 0 ? 'partial'
        : committed > 0 ? 'ads_eat_it' : 'no_cashflow',
    };
  }).sort((a, b) => b.owedTotal - a.owedTotal);

  // Debt no store can be charged with (unattributed + pre-history) — the
  // company carries it from the shared cash pool.
  const tracedTotal = storePlans.reduce((s, x) => s + x.owedTotal, 0);
  const debtTotal = cards.reduce((s, c) => s + c.postedCents, 0);

  return {
    generatedAt: projection.generated_at_date,
    position: projection.position,
    envelopeCents: projection.position.safe_to_pay_today_cents,
    allocatedCents: cards.reduce((s: number, c: any) => s + (c.payNowCents || 0), 0),
    payroll: {
      items: payrollItems,
      due7Cents: payrollDue7,
      due30Cents: payrollItems.filter(p => p.due_date <= projection.calendar[projection.calendar.length - 1]?.date || true).reduce((s, p) => s + p.amount_cents, 0),
    },
    campaignsToday,
    cards,
    storePlans,
    company: {
      untracedCents: Math.max(0, debtTotal - tracedTotal),
      cashCents: projection.position.cash_available_cents,
      safeTodayCents: projection.position.safe_to_pay_today_cents,
      debtTotalCents: debtTotal,
    },
  };
}

/** Reconcile manually-logged card payments (card_payments_log) against real
 *  bank debits: WHICH account the money actually left, and whether the card
 *  issuer has even taken it yet. One-to-one greedy matching — exact amount,
 *  debit classed card_payment_sent (or transfer), dated logged−3 … logged+10
 *  days, closest date wins, each bank debit consumed once. Statuses:
 *    confirmed — posted bank debit found (account + date returned)
 *    pending   — matching debit exists but hasn't settled (issuer initiated)
 *    too_recent— logged <4 days ago, debit may not have appeared yet
 *    not_taken — no debit within window and enough time has passed */
export function reconcileLoggedPayments(db: DatabaseType.Database, days = 120) {
  ensureTxnIntelTables(db);
  const logs: any[] = db.prepare(`
    SELECT cp.id, cp.date, cp.amount_cents, cp.card_last4
    FROM card_payments_log cp
    WHERE cp.date >= date('now', ?) AND cp.date != 'N/A'
    ORDER BY cp.date DESC
  `).all(`-${days} days`);
  const debits: any[] = db.prepare(`
    SELECT t.id, t.date, ABS(t.amount_cents) cents, t.status, t.description,
           a.account_name, a.last_four AS bank_last4
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.account_type != 'credit'
    JOIN txn_links l ON l.txn_id = t.id AND l.class IN ('card_payment_sent', 'transfer')
    WHERE t.amount_cents < 0 AND t.date >= date('now', ?)
  `).all(`-${days + 15} days`);

  const byAmount = new Map<number, any[]>();
  for (const d of debits) {
    if (!byAmount.has(d.cents)) byAmount.set(d.cents, []);
    byAmount.get(d.cents)!.push(d);
  }
  const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000);
  const today = new Date().toISOString().slice(0, 10);
  const used = new Set<string>();
  const out = new Map<string, any>();

  // Closest-date-first assignment across ALL logs so twins ($5k × 4) resolve fairly
  const candidatePairs: { logId: string; debit: any; gap: number }[] = [];
  for (const lg of logs) {
    for (const d of byAmount.get(Math.abs(lg.amount_cents)) || []) {
      const lag = daysBetween(lg.date, d.date); // debit relative to logged date
      if (lag < -3 || lag > 10) continue;
      candidatePairs.push({ logId: lg.id, debit: d, gap: Math.abs(lag) });
    }
  }
  // POSTED debits always beat pending ones: BofA shows each ACH payment twice
  // (an "ACH HOLD" row Teller leaves pending forever + the real posted row).
  // Matching the hold made settled payments read "debit pending" for weeks.
  // A pending row only matches when no posted candidate exists for that log.
  candidatePairs.sort((a, b) =>
    (a.debit.status === 'pending' ? 1 : 0) - (b.debit.status === 'pending' ? 1 : 0)
    || a.gap - b.gap);
  for (const p of candidatePairs) {
    if (out.has(p.logId) || used.has(p.debit.id)) continue;
    used.add(p.debit.id);
    out.set(p.logId, {
      status: p.debit.status === 'pending' ? 'pending' : 'confirmed',
      bankAccount: p.debit.account_name,
      bankLast4: p.debit.bank_last4,
      bankDate: p.debit.date,
    });
  }
  for (const lg of logs) {
    if (out.has(lg.id)) continue;
    const age = daysBetween(lg.date, today);
    out.set(lg.id, { status: age < 4 ? 'too_recent' : 'not_taken' });
  }
  return Object.fromEntries(out);
}

/** Live system-health score — measures how fed the intelligence actually is,
 *  and prices every blocker in points so the path to 10/10 is a burn-down,
 *  not a guess. Weights favor dollar-attribution (the thing decisions ride on). */
export function getSystemHealth(db: DatabaseType.Database) {
  ensureTxnIntelTables(db);
  ensureCardStatements(db);

  // Credit-card feed freshness
  const cards: any[] = db.prepare(`
    SELECT a.id, a.last_four, a.account_name, COALESCE(a.provider,'teller') provider,
           a.balance_updated_at, a.last_sync_error,
           (SELECT MAX(t.date) FROM bank_transactions t WHERE t.bank_account_id = a.id) last_txn,
           (SELECT COUNT(*) FROM bank_transactions t WHERE t.bank_account_id = a.id AND t.date >= date('now','-90 days')) txns90
    FROM bank_accounts a WHERE a.account_type = 'credit' AND a.status = 'active'
  `).all();
  const now = Date.now();
  const feedRows = cards.map(c => {
    const balAge = c.balance_updated_at ? (now - new Date(String(c.balance_updated_at).replace(' ', 'T') + 'Z').getTime()) / 86400000 : 999;
    const txnAge = c.last_txn ? (now - new Date(c.last_txn + 'T00:00:00Z').getTime()) / 86400000 : 999;
    // A feed is only LIVE if both balances and transactions are moving
    const status = c.last_sync_error ? 'broken' : balAge <= 2 && txnAge <= 10 && c.txns90 > 10 ? 'live' : balAge <= 2 ? 'partial' : 'stale';
    return { last4: c.last_four, name: c.account_name, provider: c.provider, status, balAgeDays: Math.round(balAge), txns90: c.txns90, error: c.last_sync_error || null };
  });
  const feedScore = feedRows.length ? feedRows.filter(f => f.status === 'live').length / feedRows.length : 0;

  // Dollar-weighted store attribution on card charges, 90d
  const attr: any = db.prepare(`
    SELECT SUM(CASE WHEN l.store_id IS NOT NULL THEN ABS(t.amount_cents) ELSE 0 END) attributed,
           SUM(ABS(t.amount_cents)) total
    FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
    LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE a.account_type = 'credit' AND t.date >= date('now','-90 days')
      AND COALESCE(l.class,'') NOT IN ('card_payment')
  `).get();
  const attrScore = attr?.total ? (attr.attributed || 0) / attr.total : 0;

  // Statements entered
  const stmtCount = (db.prepare('SELECT COUNT(*) n FROM card_statements WHERE statement_balance_cents IS NOT NULL').get() as any)?.n || 0;
  const stmtScore = cards.length ? Math.min(1, stmtCount / cards.length) : 0;

  // Payments sent that confirmed landing (30d, dollar-weighted)
  const pair: any = db.prepare(`
    SELECT SUM(CASE WHEN l.pair_txn_id IS NOT NULL THEN ABS(t.amount_cents) ELSE 0 END) paired,
           SUM(ABS(t.amount_cents)) total
    FROM bank_transactions t JOIN txn_links l ON l.txn_id = t.id AND l.class = 'card_payment_sent'
    WHERE t.date >= date('now','-30 days')
  `).get();
  const pairScore = pair?.total ? (pair.paired || 0) / pair.total : 1;

  // FB funding cards linked in banking
  const linkedLast4s = new Set(cards.map(c => c.last_four).filter(Boolean));
  const fundingCards = new Set<string>();
  for (const p of db.prepare(`SELECT primary_card_last4, working_card_last4 FROM fb_profiles WHERE is_active = 1 AND balance_cents > 0`).all() as any[]) {
    const l4 = p.primary_card_last4 || p.working_card_last4;
    if (l4) fundingCards.add(l4);
  }
  const fbLinked = [...fundingCards].filter(l4 => linkedLast4s.has(l4)).length;
  const fbLinkScore = fundingCards.size ? fbLinked / fundingCards.size : 1;

  const W = { attr: 0.30, feed: 0.25, stmt: 0.15, pair: 0.15, fb: 0.15 };
  const compute = (s: { attr: number; feed: number; stmt: number; pair: number; fb: number }) =>
    Math.round(100 * (W.attr * s.attr + W.feed * s.feed + W.stmt * s.stmt + W.pair * s.pair + W.fb * s.fb)) / 10;
  const parts = { attr: attrScore, feed: feedScore, stmt: stmtScore, pair: pairScore, fb: fbLinkScore };
  const score = compute(parts);
  const pts = (k: keyof typeof parts) => Math.round((compute({ ...parts, [k]: 1 }) - score) * 10) / 10;

  const brokenFeeds = feedRows.filter(f => f.status !== 'live');
  const blockers = [
    ...(brokenFeeds.length ? [{
      owner: 'YOU', pts: pts('feed') + pts('pair'), // fixing feeds also confirms payments
      label: `Reconnect ${brokenFeeds.length} card feed${brokenFeeds.length > 1 ? 's' : ''}`,
      detail: brokenFeeds.map(f => `··${f.last4} (${f.provider}${f.error ? ' — login required' : f.status === 'partial' ? ' — balances only, no txns' : ` — ${f.balAgeDays}d stale`})`).join(' · '),
      action: 'Banking → reconnect the Teller Amex enrollment AND the Plaid American Express item',
    }] : []),
    ...(fundingCards.size - fbLinked > 0 ? [{
      owner: 'YOU', pts: pts('fb') + pts('attr'), // linking is also what unlocks attribution
      label: `Link ${fundingCards.size - fbLinked} FB funding card${fundingCards.size - fbLinked > 1 ? 's' : ''}`,
      detail: [...fundingCards].filter(l4 => !linkedLast4s.has(l4)).map(l4 => `··${l4}`).join(' '),
      action: 'Banking → Connect Card for each — turns untraced FB spend into per-store truth',
    }] : []),
    ...(stmtCount < cards.length ? [{
      owner: 'YOU', pts: pts('stmt'),
      label: `Enter ${cards.length - stmtCount} card statement${cards.length - stmtCount > 1 ? 's' : ''}`,
      detail: `${stmtCount}/${cards.length} entered`,
      action: 'Operations → click "set" in the STMT BAL column per card',
    }] : []),
  ].sort((a, b) => b.pts - a.pts);

  // Hard warnings — data feeds that are DEAD (not just incomplete). These
  // don't lower the score gradually; they mean current numbers are wrong.
  const warnings: { label: string; detail: string }[] = [];
  const adFresh: any = db.prepare(`SELECT MAX(date) latest FROM ad_spend`).get();
  const adAgeDays = adFresh?.latest ? Math.round((now - new Date(adFresh.latest + 'T00:00:00Z').getTime()) / 86400000) : 999;
  if (adAgeDays >= 2) {
    warnings.push({
      label: `AD SPEND BLIND ${adAgeDays}d`,
      detail: `No FB insights since ${adFresh?.latest} — tokens dead (reconnect Facebook Accounts). Campaigns keep spending; the burn math is understating reality.`,
    });
  }
  const fbSync: any = db.prepare(`SELECT MAX(last_sync_at) latest FROM fb_profiles WHERE is_active = 1`).get();
  if (fbSync?.latest && now - new Date(String(fbSync.latest).replace(' ', 'T') + 'Z').getTime() > 3 * 3600_000) {
    warnings.push({ label: 'FB SYNC STALLED', detail: `Last successful FB profile sync ${String(fbSync.latest).slice(0, 16)} — check tokens / sync loop.` });
  }

  return {
    score,
    warnings,
    components: {
      dollarAttribution: { score: Math.round(attrScore * 100), attributedCents: attr?.attributed || 0, totalCents: attr?.total || 0 },
      cardFeeds: { score: Math.round(feedScore * 100), rows: feedRows },
      statements: { score: Math.round(stmtScore * 100), entered: stmtCount, total: cards.length },
      paymentsConfirmed: { score: Math.round(pairScore * 100), unpairedCents: (pair?.total || 0) - (pair?.paired || 0) },
      fbCardsLinked: { score: Math.round(fbLinkScore * 100), linked: fbLinked, total: fundingCards.size },
    },
    blockers,
  };
}

export function getSummary(db: DatabaseType.Database) {
  ensureTxnIntelTables(db);
  const debt: any = db.prepare(`SELECT SUM(balance_ledger_cents) cents FROM bank_accounts WHERE account_type = 'credit' AND status = 'active' AND provider = 'plaid'`).get();
  const cls30 = db.prepare(`
    SELECT l.class, SUM(ABS(t.amount_cents)) cents FROM bank_transactions t
    JOIN txn_links l ON l.txn_id = t.id
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.account_type = 'credit'
    WHERE t.date >= date('now', '-30 days') AND l.class NOT IN ('card_payment')
    GROUP BY l.class ORDER BY cents DESC
  `).all();
  const paid30: any = db.prepare(`
    SELECT SUM(ABS(t.amount_cents)) cents FROM bank_transactions t
    JOIN txn_links l ON l.txn_id = t.id AND l.class = 'card_payment'
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.account_type = 'credit'
    WHERE t.date >= date('now', '-30 days')
  `).get();
  const coverage: any = db.prepare(`
    SELECT COUNT(*) total, SUM(CASE WHEN l.txn_id IS NOT NULL THEN 1 ELSE 0 END) linked,
           SUM(CASE WHEN l.store_id IS NOT NULL THEN 1 ELSE 0 END) attributed
    FROM bank_transactions t LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE t.date >= date('now', '-90 days')
  `).get();
  const lastScan: any = db.prepare(`SELECT MAX(updated_at) at FROM txn_links`).get();
  const bankFresh: any = db.prepare(`SELECT MIN(balance_updated_at) oldest, MAX(balance_updated_at) newest FROM bank_accounts WHERE status = 'active'`).get();
  return {
    totalCardDebtCents: debt?.cents || 0, chargesByClass30d: cls30, cardPaid30dCents: paid30?.cents || 0,
    coverage, lastScanAt: lastScan?.at || null,
    bankFreshestAt: bankFresh?.newest || null, bankOldestAt: bankFresh?.oldest || null,
  };
}
