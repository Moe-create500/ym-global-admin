// ============================================================================
// CATEGORIZATION ENGINE — the decision layer for where a transaction belongs.
//
// Precedence (higher layers ALWAYS beat lower ones):
//   1. manual lock (human override — automation never touches it)
//   2. transfer / card-payment matching (money movement is never P&L)
//   3. business-context matches (ad invoices, app invoices, payouts)
//   4. exact verified history (human corrections + strong legacy evidence)
//   5. deterministic merchant rules (merchant_store_rules, direction-guarded)
//   6. merchant knowledge (entity default purpose, verified-count weighted)
//   7. lexical similarity over verified history
//   8. LLM (only if configured; structured output; never invents categories)
//   9. honest abstention — category NULL + needs_review
//
// Confidence is computed from EVIDENCE, never from asking a model how it
// feels. Below 0.80 the engine abstains. UNKNOWN is a valid result.
// ============================================================================

import type Database from 'better-sqlite3';
import { resolveMerchant, ensureCategorizeSchema, type ResolvedMerchant } from './merchants';
import { llmClassify, VALID_CATEGORIES } from './llm';

export interface Evidence { type: string; reference: string }

export interface ClassificationResult {
  txn_id: string;
  category: string | null;
  /** sub-certain hint shown as "suggest: X?" — never asserted, never counted */
  suggested_category?: string | null;
  /** store hint when the txn itself is unexplained — never shown as ownership */
  suggested_store_id?: string | null;
  subcategory: string | null;
  merchant_id: string | null;
  merchant_name: string | null;
  store_id: string | null;
  method: string;
  confidence: number;
  reason: string;
  evidence: Evidence[];
  needs_review: boolean;
  related_txn_id: string | null;
}

const abstain = (txn: any, reason: string, evidence: Evidence[] = []): ClassificationResult => ({
  txn_id: txn.id, category: null, subcategory: null, merchant_id: null, merchant_name: null,
  store_id: null, method: 'UNKNOWN', confidence: 0, reason, evidence, needs_review: true, related_txn_id: null,
});

/** Full pipeline: classify (what is it) + attribute (whose money is it).
 *  RECONCILIATION IS THE POINT: store attribution has its own evidence
 *  chain, and a transaction with no proven store connection stays
 *  store_id = NULL — explicitly unattributed, never guessed. */
export async function categorizeTransaction(db: Database.Database, txn: any, opts: { allowLlm?: boolean } = {}): Promise<ClassificationResult> {
  const result = await classifyTransaction(db, txn, opts);
  return attributeStore(db, txn, result);
}

/** Store attribution evidence chain (strongest first):
 *  1. already attributed by invoice/rule evidence during classification
 *  2. ACCOUNT_OWNERSHIP — the account itself belongs to one store
 *  3. STORE_NAME_MATCH — store name appears word-bounded in the description
 *  4. PAIRED_ACCOUNT — transfer/card-payment pair's other account is store-owned
 *  Transfers/card payments themselves stay unattributed to P&L but carry the
 *  payer store so card debt composition stays reconcilable. */
function attributeStore(db: Database.Database, txn: any, r: ClassificationResult): ClassificationResult {
  // 0. MANUAL STORE PAIRING — a human said whose money this is. Always
  // asserted (100%), independent of category state, never overridden.
  if (txn.custom_store_id) {
    return { ...r, store_id: txn.custom_store_id,
      evidence: [...r.evidence, { type: 'manual_store', reference: 'paired to store by human' }] };
  }
  if (r.store_id) return r; // invoice/rule already proved it — keep that evidence
  // Policy (2026-09-09): an UNEXPLAINED transaction claims no owner. Store is
  // only ASSERTED when the classification itself is asserted; otherwise any
  // ownership evidence becomes suggested_store_id (unconfirmed, detail-only).
  const assertable = r.category != null;
  const withStore = (storeId: string, ev: Evidence): ClassificationResult =>
    assertable
      ? { ...r, store_id: storeId, evidence: [...r.evidence, ev] }
      : { ...r, suggested_store_id: storeId, evidence: [...r.evidence, { ...ev, reference: `${ev.reference} (unconfirmed — txn itself unexplained)` }] };
  try {
  const account: any = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(txn.bank_account_id);

  // 2. store-owned account (not a global/company-wide account)
  if (account?.store_id && !account.is_global) {
    const store: any = db.prepare('SELECT id, name FROM stores WHERE id = ?').get(account.store_id);
    if (store) return withStore(store.id, { type: 'account_ownership', reference: `account belongs to ${store.name}` });
  }

  // 3. store name word-bounded in the description
  const dl = ` ${(txn.description || '').toLowerCase()} `;
  const stores: any[] = db.prepare('SELECT * FROM stores').all();
  const named = stores.filter(s => (s.is_active === 1 || s.is_active == null)
    && s.name && s.name.length >= 4 && dl.includes(` ${s.name.toLowerCase()} `));
  if (named.length === 1) return withStore(named[0].id, { type: 'store_name_match', reference: named[0].name });

  // 4. paired transaction's account is store-owned (payer attribution)
  if (r.related_txn_id) {
    const pairAcct: any = db.prepare(`SELECT a.*, s.name AS store_name FROM bank_transactions bt
      JOIN bank_accounts a ON a.id = bt.bank_account_id LEFT JOIN stores s ON s.id = a.store_id
      WHERE bt.id = ?`).get(r.related_txn_id);
    if (pairAcct?.store_id && !pairAcct.is_global) {
      return withStore(pairAcct.store_id, { type: 'paired_account_store', reference: `paid from ${pairAcct.store_name || 'store'}'s account` });
    }
  }

  } catch { /* attribution must never break classification (e.g. minimal schemas) */ }
  // honestly unattributed — this is triage work, not a guess
  return r;
}

async function classifyTransaction(db: Database.Database, txn: any, opts: { allowLlm?: boolean } = {}): Promise<ClassificationResult> {
  ensureCategorizeSchema(db);
  const account: any = db.prepare('SELECT id, account_type, institution_name, company, store_id FROM bank_accounts WHERE id = ?').get(txn.bank_account_id);
  const merchant = resolveMerchant(db, txn.description || '');
  const base = {
    txn_id: txn.id, subcategory: null as string | null,
    merchant_id: merchant?.id || null, merchant_name: merchant?.name || null,
    store_id: null as string | null, related_txn_id: null as string | null,
  };

  // ---- 1. MANUAL LOCK -----------------------------------------------------
  if (txn.custom_category) {
    return { ...base, category: txn.custom_category, method: 'MANUAL', confidence: 1,
      reason: 'Manually categorized by a human — automation never overrides this',
      evidence: [{ type: 'manual_override', reference: txn.id }], needs_review: false };
  }

  // ---- 2. TRANSFER / CARD-PAYMENT MATCHING --------------------------------
  // Opposite amounts across two OWNED same-currency accounts within ±3 days =
  // the two legs of one movement. Never revenue, never expense.
  // Hardened (2026-09-09): MULTIPLE candidates → TRANSFER_SUSPECT (never
  // guess which leg); a twin already claimed by another transaction's pairing
  // is excluded (one leg can only settle one movement).
  if (Math.abs(txn.amount_cents) >= 1000) {
    const hasCurrency = (db.prepare("SELECT COUNT(*) n FROM pragma_table_info('bank_accounts') WHERE name = 'currency'").get() as any).n > 0;
    const currencyClause = hasCurrency
      ? "AND COALESCE(a.currency,'USD') = COALESCE((SELECT currency FROM bank_accounts WHERE id = @acct),'USD')"
      : '';
    const candidates: any[] = db.prepare(`
      SELECT bt.id, a.account_type, a.institution_name, a.last_four FROM bank_transactions bt
      JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.status = 'active' ${currencyClause}
      WHERE bt.amount_cents = @negAmt AND bt.bank_account_id != @acct AND bt.id != @txnId
        AND ABS(JULIANDAY(bt.date) - JULIANDAY(@date)) <= 3
        AND NOT EXISTS (SELECT 1 FROM classification_results cr WHERE cr.related_txn_id = bt.id AND cr.txn_id != @txnId)
      ORDER BY ABS(JULIANDAY(bt.date) - JULIANDAY(@date)) LIMIT 3`)
      .all({ acct: txn.bank_account_id, negAmt: -txn.amount_cents, txnId: txn.id, date: txn.date });
    if (candidates.length === 1) {
      const twin = candidates[0];
      const isCardPayment = account?.account_type === 'credit' || twin.account_type === 'credit';
      const category = isCardPayment ? 'Credit Card Payment' : (txn.amount_cents < 0 ? 'Transfer Out' : 'Transfer In');
      return { ...base, category, related_txn_id: twin.id,
        method: isCardPayment ? 'CARD_PAYMENT_MATCH' : 'TRANSFER_MATCH', confidence: 0.97,
        reason: `Opposite-amount twin on ${twin.institution_name} ····${twin.last_four} within 3 days — two legs of one movement, excluded from P&L`,
        evidence: [{ type: 'paired_transaction', reference: twin.id }], needs_review: false };
    }
    if (candidates.length > 1) {
      return { ...base, category: null, method: 'TRANSFER_SUSPECT', confidence: 0,
        reason: `${candidates.length} opposite-amount candidates within the window — ambiguous pairing, review required (never guessed)`,
        evidence: candidates.map((c: any) => ({ type: 'transfer_candidate', reference: c.id })),
        needs_review: true, related_txn_id: null };
    }
  }

  // ---- 3. BUSINESS CONTEXT: invoices & payouts ---------------------------
  // Invoice matches require DESCRIPTION COMPATIBILITY, not just an exact
  // amount — a $16 make.com charge must never match a coincidental $16
  // Shopify invoice (real false positive found 2026-09-09). Amount + date
  // window + the descriptor actually naming the platform.
  // A Shopify line on a CREDIT CARD is an app/subscription fee — payouts land
  // in checking, never on a card. A positive one is a refunded fee. Before the
  // 2026-09-14 sign normalisation these were stored positive, read as income,
  // and filed as "Shopify Payout" against a store they had nothing to do with.
  const onCard = account?.account_type === 'credit';
  const shopifyDesc = /shopify|shoppay/i.test(txn.description || '');
  if (onCard && shopifyDesc && txn.amount_cents > 0) {
    return { ...base, category: 'Software', subcategory: 'Shopify Apps',
      method: 'MERCHANT_KNOWLEDGE', confidence: 0.95,
      reason: 'Shopify credit on a card — a refunded app fee, not a payout (payouts land in checking)',
      evidence: [{ type: 'account_type', reference: 'credit' }], needs_review: false };
  }

  if (txn.amount_cents < 0) {
    const descL = (txn.description || '').toLowerCase();
    // Take EVERY invoice in the window, not `LIMIT 1`. The store the charge
    // belongs to is sitting on the invoice, and dropping it left the charge
    // categorised as Ad Spend but unpaired — 81 card charges, $54,024.09, that
    // the system already had the answer for. The Shopify branch below has always
    // carried store_id through; this one never did.
    //
    // Round top-up amounts collide badly ($2,000 appears on invoices for several
    // stores at once), so assert the store ONLY when every candidate agrees.
    // Where they disagree it stays a suggestion — the 100%-or-nothing rule, and
    // the same class of mistake as the Marroomi payout misroute.
    const adInvs: any[] = db.prepare(`
      SELECT id, platform, date, store_id FROM ad_payments
      WHERE amount_cents = ? AND ABS(JULIANDAY(date) - JULIANDAY(?)) <= 3`)
      .all(Math.abs(txn.amount_cents), txn.date);
    const isGoogleDesc = /google|adword/.test(descL);
    const adMatches = adInvs.filter(i => (i.platform === 'google') === isGoogleDesc);
    if (adMatches.length) {
      const platOk = isGoogleDesc || /facebk|facebook|meta|fb /.test(descL);
      if (platOk) {
        const adInv = adMatches[0];
        const stores = [...new Set(adMatches.map(i => i.store_id).filter(Boolean))];
        // Three distinct outcomes, and only one of them is a conflict:
        //   one store   -> assert it, this is the whole point
        //   no store    -> the invoice never carried one; categorise as before
        //                  and leave the store alone. Not a conflict, not review.
        //   many stores -> a round top-up amount shared across stores. Assert
        //                  nothing and suggest nothing; a wrong store is worse
        //                  than none. Flag it for a human.
        const conflicted = stores.length > 1;
        return { ...base, category: 'Ad Spend', subcategory: adInv.platform === 'google' ? 'Google Ads' : 'Meta Ads',
          ...(stores.length === 1 ? { store_id: stores[0] } : {}),
          method: 'INVOICE_MATCH', confidence: 0.98,
          reason: stores.length === 1
            ? `Amount matches ${adInv.platform} ad invoice dated ${adInv.date}, descriptor names the platform, and all ${adMatches.length} matching invoice(s) belong to one store`
            : conflicted
              ? `Amount matches ${adInv.platform} ad invoice dated ${adInv.date} and descriptor names the platform, but ${stores.length} stores share this amount in the window — store left unassigned`
              : `Amount matches ${adInv.platform} ad invoice dated ${adInv.date} and descriptor names the platform`,
          evidence: adMatches.slice(0, 5).map(i => ({ type: 'ad_invoice', reference: i.id })),
          needs_review: conflicted };
      }
    }
    if (/shopify/.test(descL)) {
      const appInv: any = db.prepare(`
        SELECT id, store_id, date FROM shopify_invoices
        WHERE total_cents = ? AND ABS(JULIANDAY(date) - JULIANDAY(?)) <= 5 LIMIT 1`)
        .get(Math.abs(txn.amount_cents), txn.date);
      if (appInv) {
        return { ...base, category: 'Software', subcategory: 'Shopify Apps', store_id: appInv.store_id,
          method: 'INVOICE_MATCH', confidence: 0.96,
          reason: `Shopify descriptor + amount matches app invoice dated ${appInv.date}`,
          evidence: [{ type: 'shopify_invoice', reference: appInv.id }], needs_review: false };
      }
      // No invoice to pin a store on, but on a card the category is not in
      // doubt. Assert Software, assert no store — never guess one.
      if (onCard) {
        return { ...base, category: 'Software', subcategory: 'Shopify Apps',
          method: 'MERCHANT_KNOWLEDGE', confidence: 0.95,
          reason: 'Shopify app fee on a card; no app invoice matched, so the store is left unassigned',
          evidence: [{ type: 'account_type', reference: 'credit' }], needs_review: false };
      }
    }
  } else if (merchant?.name === 'Shopify' || /shopify|shoppay/i.test(txn.description || '')) {
    // A payout is a SETTLEMENT of underlying sales, not raw revenue.
    return { ...base, category: 'Shopify Payout',
      method: 'PAYOUT_MATCH', confidence: 0.95,
      reason: 'Incoming Shopify settlement — represents underlying sales already recorded, not standalone revenue',
      evidence: [{ type: 'payout_pattern', reference: 'shopify_deposit' }], needs_review: false };
  }

  // ---- 4. EXACT VERIFIED HISTORY ------------------------------------------
  if (merchant) {
    const fb: any = db.prepare(`
      SELECT corrected_category cat, COUNT(*) n FROM classification_feedback
      WHERE merchant_name = ? GROUP BY corrected_category ORDER BY n DESC LIMIT 2`).all(merchant.name);
    if (fb.length && fb[0].n >= 3 && (fb.length === 1 || fb[0].n >= fb[1].n * 4)) {
      return { ...base, category: fb[0].cat, method: 'EXACT_HISTORY', confidence: 0.96,
        reason: `${fb[0].n} human-verified ${merchant.name} transactions were categorized "${fb[0].cat}"`,
        evidence: [{ type: 'verified_history', reference: `${merchant.name}:${fb[0].n}` }], needs_review: false };
    }
  }

  // ---- 5. DETERMINISTIC MERCHANT RULES (pre-existing table, direction-guarded)
  const dl = (txn.description || '').toLowerCase();
  const rules: any[] = db.prepare('SELECT * FROM merchant_store_rules WHERE enabled = 1').all();
  const hits = rules.filter(r => dl.includes(String(r.pattern).toLowerCase())
    && (!r.direction || (r.direction === 'debit' ? txn.amount_cents < 0 : txn.amount_cents > 0)));
  if (hits.length === 1) {
    const r = hits[0];
    db.prepare("UPDATE merchant_store_rules SET last_used_at = datetime('now') WHERE id = ?").run(r.id);
    return { ...base, category: classToCategory(r.class), store_id: r.store_id,
      method: 'MERCHANT_RULE', confidence: 0.95,
      reason: `Matched rule #${r.id} pattern "${r.pattern}"${r.direction ? ` (${r.direction}-only)` : ''}`,
      evidence: [{ type: 'merchant_rule', reference: String(r.id) }], needs_review: false };
  }
  if (hits.length > 1) {
    return { ...abstain(txn, `RULE_CONFLICT: ${hits.length} rules match (${hits.map(h => '#' + h.id).join(', ')}) — needs review`,
      hits.map(h => ({ type: 'conflicting_rule', reference: String(h.id) }))), ...{ merchant_id: base.merchant_id, merchant_name: base.merchant_name } };
  }

  // ---- 6. MERCHANT KNOWLEDGE — SUGGESTION ONLY (policy 2026-09-09: below
  // near-certainty, nothing is asserted; "typically means X" is a hint, not
  // a fact. category stays NULL, the hint rides in suggested_category.)
  if (merchant?.default_purpose && txn.amount_cents < 0) {
    const legacy: any = db.prepare(`
      SELECT COUNT(*) n FROM txn_links l JOIN bank_transactions bt ON bt.id = l.txn_id
      WHERE LOWER(bt.description) LIKE ? AND l.class NOT IN ('other','personal')`).get(`%${merchant.matched_alias}%`);
    const conf = legacy.n >= 20 ? 0.93 : legacy.n >= 5 ? 0.88 : 0.82;
    return { ...base, category: null, suggested_category: merchant.default_purpose,
      method: 'MERCHANT_KNOWLEDGE', confidence: conf,
      reason: `${merchant.name} (${merchant.merchant_type}) typically means "${merchant.default_purpose}"${legacy.n ? ` — ${legacy.n} prior classified transactions agree` : ''} — suggestion only, not certain enough to assert`,
      evidence: [{ type: 'merchant_entity', reference: merchant.id }, ...(legacy.n ? [{ type: 'legacy_history', reference: String(legacy.n) }] : [])],
      needs_review: true, related_txn_id: null };
  }

  // ---- 7. LEXICAL SIMILARITY over verified feedback -----------------------
  const tokens = dl.split(/[^a-z0-9]+/).filter((t: string) => t.length >= 4);
  if (tokens.length) {
    const like = tokens.slice(0, 3).map(() => 'description LIKE ?').join(' OR ');
    const sims: any[] = db.prepare(`
      SELECT corrected_category cat, COUNT(*) n FROM classification_feedback
      WHERE ${like} GROUP BY corrected_category ORDER BY n DESC LIMIT 2`)
      .all(...tokens.slice(0, 3).map((t: string) => `%${t}%`));
    if (sims.length && sims[0].n >= 3 && (sims.length === 1 || sims[0].n >= sims[1].n * 3)) {
      return { ...base, category: null, suggested_category: sims[0].cat, method: 'SEMANTIC_HISTORY', confidence: 0.85,
        reason: `${sims[0].n} verified transactions with similar descriptions were "${sims[0].cat}" — suggestion only`,
        evidence: [{ type: 'similar_verified', reference: `${sims[0].n} examples` }], needs_review: true };
    }
  }

  // ---- 8. LLM (optional, structured, never fails the pipeline) ------------
  if (opts.allowLlm !== false) {
    const llm = await llmClassify(db, txn, { merchant, account });
    if (llm && llm.confidence >= 0.8 && VALID_CATEGORIES.includes(llm.category)) {
      // model opinion is NEVER an assertion — suggestion only
      return { ...base, category: null, suggested_category: llm.category, method: 'LLM_ASSISTED',
        confidence: Math.min(llm.confidence, 0.9),
        reason: `LLM suggests: ${llm.reason}`.slice(0, 300),
        evidence: [{ type: 'llm', reference: llm.model }], needs_review: true };
    }
  }

  // ---- 9. HONEST ABSTENTION -----------------------------------------------
  return abstain(txn, merchant
    ? `Merchant ${merchant.name} recognized but no category evidence is strong enough — review needed`
    : 'No merchant match, no history, no business-context evidence — unknown is the honest answer');
}

function classToCategory(cls: string | null): string {
  const map: Record<string, string> = {
    fb_ads: 'Ad Spend', google_ads: 'Ad Spend', shopify_app: 'Software', software: 'Software',
    supplier: 'Inventory', owner_draw: 'Owner Draw', transfer: 'Transfer Out', payroll: 'Payroll',
    shopify_payout: 'Shopify Payout', card_payment: 'Credit Card Payment',
  };
  return map[cls || ''] || 'Other';
}

/** Persist a result (idempotent upsert; MANUAL results are never overwritten). */
export function saveResult(db: Database.Database, r: ClassificationResult) {
  db.prepare(`INSERT INTO classification_results (txn_id, category, suggested_category, suggested_store_id, subcategory, merchant_id, merchant_name,
      store_id, method, confidence, reason, evidence_json, needs_review, related_txn_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(txn_id) DO UPDATE SET
      category = excluded.category, suggested_category = excluded.suggested_category, suggested_store_id = excluded.suggested_store_id, subcategory = excluded.subcategory,
      merchant_id = excluded.merchant_id, merchant_name = excluded.merchant_name,
      store_id = excluded.store_id, method = excluded.method, confidence = excluded.confidence,
      reason = excluded.reason, evidence_json = excluded.evidence_json,
      needs_review = excluded.needs_review, related_txn_id = excluded.related_txn_id,
      created_at = datetime('now')
    WHERE classification_results.method != 'MANUAL'`)
    .run(r.txn_id, r.category, r.suggested_category ?? null, r.suggested_store_id ?? null, r.subcategory, r.merchant_id, r.merchant_name, r.store_id,
      r.method, r.confidence, r.reason, JSON.stringify(r.evidence), r.needs_review ? 1 : 0, r.related_txn_id);
}
