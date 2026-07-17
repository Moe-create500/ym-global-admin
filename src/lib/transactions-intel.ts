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
           a.account_type, a.store_id AS account_store_id, a.is_global, a.last_four,
           l.txn_id AS linked, l.confidence AS link_confidence
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id
    LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE t.date >= date('now', ?)
  `).all(`-${days} days`);
  stats.scanned = txns.length;

  // Lookup maps built once — the scan itself is pure in-memory matching.
  const stores: any[] = db.prepare('SELECT id, name FROM stores').all();
  const storeNameMap = stores
    .map(s => ({ id: s.id, upper: String(s.name).toUpperCase() }))
    .filter(s => s.upper.length >= 4);

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

  const upsert = db.prepare(`INSERT INTO txn_links (txn_id, class, store_id, store_source, entity_type, entity_id, pair_txn_id, confidence, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(txn_id) DO UPDATE SET class = excluded.class, store_id = excluded.store_id, store_source = excluded.store_source,
      entity_type = excluded.entity_type, entity_id = excluded.entity_id,
      pair_txn_id = COALESCE(excluded.pair_txn_id, txn_links.pair_txn_id), confidence = excluded.confidence, updated_at = datetime('now')`);

  const cardPayments: any[] = [];   // received on a credit card
  const paymentsSent: any[] = [];   // sent from a checking account

  db.transaction(() => {
    for (const t of txns) {
      if (t.linked && t.link_confidence === 'manual' && !opts.force) continue;
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
      const amt = Math.abs(t.amount_cents);

      // 1. exact invoice match (ads then shopify) — gives store + entity
      if (cls === 'fb_ads' || cls === 'google_ads') {
        const platform = cls === 'fb_ads' ? 'facebook' : 'google';
        const cands = (adIdx.get(`${amt}`) || []).filter(i =>
          i.platform === platform && daysApart(i.date, t.date) <= 3 &&
          (!i.card_last4 || !t.last_four || i.card_last4 === t.last_four));
        if (cands.length === 1) {
          storeId = cands[0].store_id; storeSource = 'invoice';
          entityType = 'ad_payment'; entityId = cands[0].id;
          stats.invoiceMatched++;
        }
      } else if (cls === 'shopify_app') {
        const cands = (shopIdx.get(`${amt}`) || []).filter(i =>
          daysApart(i.date, t.date) <= 5 &&
          (!i.card_last4 || !t.last_four || i.card_last4 === t.last_four));
        if (cands.length === 1) {
          storeId = cands[0].store_id; storeSource = 'invoice';
          entityType = 'shopify_invoice'; entityId = cands[0].id;
          stats.invoiceMatched++;
        }
      }

      // 2. store name inside the description (payout INDN/ID fields carry it)
      if (!storeId) {
        const upper = desc.toUpperCase();
        const hit = storeNameMap.find(s => upper.includes(s.upper));
        if (hit) { storeId = hit.id; storeSource = 'description'; }
      }

      // 3. the account itself belongs to a store
      if (!storeId && t.account_store_id && !t.is_global) {
        storeId = t.account_store_id; storeSource = 'account';
      }

      // 4. FB funding-card map, only when unambiguous
      if (!storeId && cls === 'fb_ads' && t.last_four) {
        const set = fbCardStores.get(t.last_four);
        if (set && set.size === 1) { storeId = [...set][0]; storeSource = 'fb_card'; }
      }

      if (storeId) stats.storeAttributed++;
      upsert.run(t.id, cls, storeId, storeSource, entityType, entityId, null, 'auto');

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
