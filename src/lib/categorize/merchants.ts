// ============================================================================
// MERCHANT INTELLIGENCE — canonical merchant entities + alias resolution.
//
// Merchant IDENTITY and accounting CATEGORY are separate concepts: "Shopify"
// the entity may be a payout, a software bill, or a processing fee — context
// decides the category, this layer only decides WHO the counterparty is.
// Aliases are seeded for known counterparties and grown safely from verified
// human corrections (≥3 confirmations before an alias is trusted).
// ============================================================================

import type Database from 'better-sqlite3';
import crypto from 'crypto';

export function ensureCategorizeSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    merchant_type TEXT,               -- AD_PLATFORM | PROCESSOR | CARRIER | SUPPLIER | SOFTWARE | BANK | OTHER
    default_purpose TEXT,             -- identity-level hint only, never forced
    created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS merchant_aliases (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchant_entities(id),
    pattern TEXT NOT NULL UNIQUE,     -- lowercase substring match
    source TEXT DEFAULT 'seed',       -- seed | learned | user
    confirmations INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS idx_merchant_aliases_merchant ON merchant_aliases(merchant_id);

  CREATE TABLE IF NOT EXISTS classification_results (
    txn_id TEXT PRIMARY KEY,
    category TEXT,                    -- NULL = honest abstention
    subcategory TEXT,
    merchant_id TEXT,
    merchant_name TEXT,
    store_id TEXT,
    method TEXT NOT NULL,             -- EXACT_HISTORY | MERCHANT_RULE | TRANSFER_MATCH | ...
    confidence REAL NOT NULL,
    reason TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    suggested_category TEXT,          -- sub-certain hint; NEVER counted as a category
    related_txn_id TEXT,              -- transfer/card-payment pair
    engine_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS idx_class_results_review ON classification_results(needs_review);
  CREATE INDEX IF NOT EXISTS idx_class_results_category ON classification_results(category);

  CREATE TABLE IF NOT EXISTS classification_feedback (
    id TEXT PRIMARY KEY,
    txn_id TEXT NOT NULL,
    predicted_category TEXT,
    predicted_method TEXT,
    corrected_category TEXT NOT NULL,
    merchant_name TEXT,
    description TEXT,
    amount_cents INTEGER,
    account_id TEXT,
    actor TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS idx_class_feedback_merchant ON classification_feedback(merchant_name);

  `);
  try { db.exec('ALTER TABLE classification_results ADD COLUMN suggested_category TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE classification_results ADD COLUMN suggested_store_id TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE bank_transactions ADD COLUMN custom_store_id TEXT'); } catch { /* exists */ }
  db.exec(`
  CREATE TABLE IF NOT EXISTS ai_calls (
    id TEXT PRIMARY KEY,
    purpose TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    ok INTEGER,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  seedMerchants(db);
}

// Seeded canonical counterparties — patterns are lowercase substrings of bank
// descriptors. Identity only; category comes from context.
const SEEDS: [string, string, string | null, string[]][] = [
  ['Meta', 'AD_PLATFORM', 'Ad Spend', ['facebk', 'facebook', 'meta platforms', 'meta ads', 'fb ads']],
  ['Google Ads', 'AD_PLATFORM', 'Ad Spend', ['google ads', 'google adw', 'adwords', 'google*ads', 'google llc ads']],
  ['Shopify', 'PROCESSOR', null, ['shopify']],
  ['Stripe', 'PROCESSOR', null, ['stripe']],
  ['PayPal', 'PROCESSOR', null, ['paypal']],
  ['Amazon', 'PROCESSOR', null, ['amazon', 'amzn']],
  ['American Express', 'BANK', null, ['american express', 'amex epayment', 'axp']],
  ['Bank of America', 'BANK', null, ['bank of america', 'bofa', 'bkofamerica']],
  ['USPS', 'CARRIER', 'Fulfillment', ['usps', 'stamps.com', 'postal service']],
  ['UPS', 'CARRIER', 'Fulfillment', ['ups billing', 'theupsstore', 'united parcel']],
  ['DHL', 'CARRIER', 'Fulfillment', ['dhl']],
  ['Shippo', 'CARRIER', 'Fulfillment', ['shippo']],
  ['Alibaba', 'SUPPLIER', null, ['alibaba', 'aliexpress', '1688']],
  ['Chargeflow', 'SOFTWARE', 'Software', ['chargeflow']],
  ['Zelle', 'BANK', null, ['zelle']],
  ['Wire Transfer', 'BANK', null, ['wire type', 'wire trans', 'fedwire']],
];

function seedMerchants(db: Database.Database) {
  const insEnt = db.prepare('INSERT OR IGNORE INTO merchant_entities (id, name, merchant_type, default_purpose) VALUES (?, ?, ?, ?)');
  const getEnt = db.prepare('SELECT id FROM merchant_entities WHERE name = ?');
  const insAlias = db.prepare('INSERT OR IGNORE INTO merchant_aliases (id, merchant_id, pattern, source) VALUES (?, ?, ?, ?)');
  for (const [name, type, purpose, aliases] of SEEDS) {
    insEnt.run(crypto.randomUUID(), name, type, purpose);
    const ent: any = getEnt.get(name);
    for (const a of aliases) insAlias.run(crypto.randomUUID(), ent.id, a, 'seed');
  }
}

export interface ResolvedMerchant {
  id: string; name: string; merchant_type: string | null; default_purpose: string | null;
  matched_alias: string;
}

/** WHO is this? Longest-alias-wins substring resolution over the description. */
export function resolveMerchant(db: Database.Database, description: string): ResolvedMerchant | null {
  const dl = (description || '').toLowerCase();
  if (!dl) return null;
  const aliases: any[] = db.prepare(`
    SELECT a.pattern, e.id, e.name, e.merchant_type, e.default_purpose
    FROM merchant_aliases a JOIN merchant_entities e ON e.id = a.merchant_id
    WHERE a.source != 'learned' OR a.confirmations >= 3`).all();
  let best: any = null;
  for (const a of aliases) {
    if (dl.includes(a.pattern) && (!best || a.pattern.length > best.pattern.length)) best = a;
  }
  return best ? { id: best.id, name: best.name, merchant_type: best.merchant_type, default_purpose: best.default_purpose, matched_alias: best.pattern } : null;
}

/** Human correction becomes future intelligence. Also grows alias knowledge
 *  SAFELY: a learned alias needs ≥3 confirmations before resolution trusts it —
 *  one correction never creates a broad silent rule. */
export function recordFeedback(db: Database.Database, opts: {
  txnId: string; predictedCategory: string | null; predictedMethod: string | null;
  correctedCategory: string; merchantName?: string | null; description?: string;
  amountCents?: number; accountId?: string; actor?: string;
}) {
  db.prepare(`INSERT INTO classification_feedback (id, txn_id, predicted_category, predicted_method,
      corrected_category, merchant_name, description, amount_cents, account_id, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), opts.txnId, opts.predictedCategory, opts.predictedMethod,
      opts.correctedCategory, opts.merchantName || null, opts.description || null,
      opts.amountCents ?? null, opts.accountId || null, opts.actor || null);
  // The corrected txn becomes a VERIFIED retrieval example via feedback lookups.
  // Manual verdict also locks the result row.
  db.prepare(`INSERT INTO classification_results (txn_id, category, method, confidence, reason, evidence_json, needs_review)
    VALUES (?, ?, 'MANUAL', 1.0, 'Human verified', '[]', 0)
    ON CONFLICT(txn_id) DO UPDATE SET category = excluded.category, method = 'MANUAL',
      confidence = 1.0, reason = 'Human verified', needs_review = 0, created_at = datetime('now')`)
    .run(opts.txnId, opts.correctedCategory);
}
