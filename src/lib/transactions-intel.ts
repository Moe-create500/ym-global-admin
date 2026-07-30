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
  [/american express des:ach pmt|amex epayment|ach hold american express|payment to crd|crd epay|bank of america credit card bill|online banking payment/i, 'card_payment_sent'],
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

  /** Score one invoice candidate against a bank txn: date-lag typicality is
   *  the dominant signal, card last-4 confirms or kills, exact amount is the
   *  entry ticket (already filtered). Returns 0..1. */
  const scoreCandidate = (cls: string, txn: any, inv: any): { score: number; lag: number } => {
    const lag = Math.round((new Date(txn.date + 'T12:00:00Z').getTime() - new Date(inv.date + 'T12:00:00Z').getTime()) / 86400000);
    if (lag < -2 || lag > 8) return { score: 0, lag }; // outside any plausible settlement window
    const ls = lagScore(lagCurves, cls, lag);
    let cardScore: number;
    if (inv.card_last4 && txn.last_four) cardScore = inv.card_last4 === txn.last_four ? 1 : -1; // mismatch = hard kill
    else cardScore = 0.5; // one side unknown — neutral
    if (cardScore < 0) return { score: 0, lag };
    return { score: 0.65 * ls + 0.35 * cardScore, lag };
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
          const evidence = {
            invoiceDate: best.inv.date, txnDate: t.date, lagDays: best.lag,
            card: best.inv.card_last4 && t.last_four ? (best.inv.card_last4 === t.last_four ? 'match' : 'unknown') : 'partial',
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
           l.match_score, l.match_evidence,
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
  const cardLast4s = new Set(cards.map(c => c.last_four).filter(Boolean));
  const fbByCard = new Map<string, any[]>();
  const unmappedFb: any[] = [];
  for (const p of profiles) {
    const l4 = p.primary_card_last4 || p.working_card_last4;
    if (l4 && cardLast4s.has(l4)) {
      if (!fbByCard.has(l4)) fbByCard.set(l4, []);
      fbByCard.get(l4)!.push(p);
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
    const fb = fbByCard.get(c.last_four) || [];
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
  return { totalCardDebtCents: debt?.cents || 0, chargesByClass30d: cls30, cardPaid30dCents: paid30?.cents || 0, coverage, lastScanAt: lastScan?.at || null };
}
