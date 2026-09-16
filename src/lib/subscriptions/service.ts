import type DatabaseType from 'better-sqlite3';
import { detectSubscriptions, reconcile, type Subscription, type TxnRow } from './detect';

/** Subscriptions over the real ledger: loads every posted outflow, runs the
 *  detector, applies the remembered store mappings and worker reviews, and
 *  builds the summary + savings views. Nothing here writes to
 *  bank_transactions; store assignment goes through the categoriser's own
 *  path (see assignStore) so the Transactions page and the CFO agree. */

export type ReviewStatus = 'keep' | 'review_for_cancellation' | 'not_subscription' | 'cancelled';

export interface SubscriptionView extends Subscription {
  storeName: string | null;
  suggestedStoreName: string | null;
  review: { status: ReviewStatus; note: string | null; actor: string | null; updatedAt: string } | null;
}

export interface Summary {
  monthlyRecurringCents: number;      // active + possibly active, fixed and variable
  annualizedCents: number;
  activeCount: number;
  possiblyActiveCount: number;
  needsReviewCount: number;
  needsAttributionCount: number;
  newCount: number;
  priceIncreaseCount: number;
  possibleDuplicateCount: number;
  ledgerCheck: { subscriptions: number; sourceRows: number; totalCents: number; problems: string[] };
}

export interface SavingsItem { id: string; name: string; reason: 'possible_duplicate' | 'price_increase' | 'needs_attribution' | 'needs_review'; monthlyCents: number; detail: string; action: 'REVIEW FOR CANCELLATION' | 'REVIEW PRICE' | 'ASSIGN STORE' | 'REVIEW' }
export interface Savings {
  potentialMonthlyCents: number;
  potentialAnnualCents: number;
  duplicateSpendMonthlyCents: number;
  priceIncreaseMonthlyCents: number;
  items: SavingsItem[];
}

export function ensureSubscriptionSchema(db: DatabaseType.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscription_mappings (
      merchant_key TEXT PRIMARY KEY, store_id TEXT NOT NULL, note TEXT, actor TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS subscription_reviews (
      subscription_id TEXT PRIMARY KEY, status TEXT NOT NULL, note TEXT, actor TEXT,
      updated_at TEXT DEFAULT (datetime('now')));
  `);
}

export function loadRows(db: DatabaseType.Database): { rows: TxnRow[]; holding: Set<string> } {
  const rows: TxnRow[] = db.prepare(`
    SELECT t.id, t.date, t.amount_cents, t.description, t.status, t.bank_account_id,
           a.institution_name || ' ··' || a.last_four AS account_label, a.store_id AS account_store_id,
           COALESCE(t.custom_store_id, r.store_id) AS store_id, r.category
    FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
    LEFT JOIN classification_results r ON r.txn_id = t.id
    WHERE a.status != 'merged' AND t.amount_cents < 0`).all() as any[];
  // An account whose charges are paired to 3+ stores is a SHARED account; the
  // store it is filed under is a holder, not evidence of who a charge belongs to.
  const perAcct = new Map<string, Set<string>>();
  for (const r of rows) if (r.store_id) { const s = perAcct.get(r.bank_account_id) || new Set(); s.add(r.store_id); perAcct.set(r.bank_account_id, s); }
  const holding = new Set<string>();
  for (const [id, s] of perAcct) if (s.size >= 3) holding.add(id);
  for (const r of rows) r.account_is_holding = holding.has(r.bank_account_id);
  return { rows, holding };
}

export function listSubscriptions(db: DatabaseType.Database, today?: string): { subs: SubscriptionView[]; summary: Summary; savings: Savings; hidden: SubscriptionView[] } {
  ensureSubscriptionSchema(db);
  const { rows } = loadRows(db);
  const mappings = new Map<string, string>((db.prepare('SELECT merchant_key, store_id FROM subscription_mappings').all() as any[]).map(m => [m.merchant_key, m.store_id]));
  const stores = new Map<string, string>((db.prepare('SELECT id, name FROM stores').all() as any[]).map(s => [s.id, s.name]));
  const reviews = new Map<string, any>((db.prepare('SELECT * FROM subscription_reviews').all() as any[]).map(r => [r.subscription_id, r]));
  const detected = detectSubscriptions(rows, { today, mappings });
  const problems = reconcile(detected, rows);

  const all: SubscriptionView[] = detected.map(s => {
    const rv = reviews.get(s.id);
    const v: SubscriptionView = { ...s, storeName: s.attribution.storeId ? stores.get(s.attribution.storeId) || null : null,
      suggestedStoreName: s.attribution.suggestedStoreId ? stores.get(s.attribution.suggestedStoreId) || null : null,
      review: rv ? { status: rv.status, note: rv.note, actor: rv.actor, updatedAt: rv.updated_at } : null };
    if (rv?.status === 'cancelled' && v.status !== 'cancelled') { v.status = 'cancelled'; v.statusReason = `marked cancelled by ${rv.actor || 'a worker'}${rv.note ? ` — ${rv.note}` : ''}`; }
    return v;
  });
  const hidden = all.filter(s => s.review?.status === 'not_subscription');
  const subs = all.filter(s => s.review?.status !== 'not_subscription');

  const live = subs.filter(s => s.status === 'active' || s.status === 'possibly_active');
  const monthly = live.reduce((x, s) => x + s.monthlyCents, 0);
  const summary: Summary = {
    monthlyRecurringCents: monthly, annualizedCents: monthly * 12,
    activeCount: subs.filter(s => s.status === 'active').length,
    possiblyActiveCount: subs.filter(s => s.status === 'possibly_active').length,
    needsReviewCount: subs.filter(s => s.status === 'needs_review' || s.review?.status === 'review_for_cancellation').length,
    needsAttributionCount: subs.filter(s => s.attribution.needsAttribution && s.status !== 'cancelled').length,
    newCount: subs.filter(s => s.flags.includes('new')).length,
    priceIncreaseCount: subs.filter(s => s.flags.includes('price_increase') && s.status !== 'cancelled').length,
    possibleDuplicateCount: subs.filter(s => s.flags.includes('possible_duplicate')).length,
    ledgerCheck: { subscriptions: detected.length, sourceRows: detected.reduce((x, s) => x + s.txnIds.length, 0), totalCents: detected.reduce((x, s) => x + s.totalCents, 0), problems },
  };

  // Savings: never "cancel it" — only what a review could recover.
  const items: SavingsItem[] = [];
  const dupSeen = new Set<string>();
  for (const s of live) {
    if (s.flags.includes('possible_duplicate')) {
      const group = [s, ...s.duplicateOf.map(id => subs.find(x => x.id === id)).filter((x): x is SubscriptionView => !!x && (x.status === 'active' || x.status === 'possibly_active'))];
      const gid = group.map(g => g.id).sort().join('+');
      if (!dupSeen.has(gid)) {
        dupSeen.add(gid);
        const sorted = [...group].sort((a, b) => b.monthlyCents - a.monthlyCents);
        const recoverable = sorted.slice(1).reduce((x, g) => x + g.monthlyCents, 0);   // keep the largest, the rest is the possible overlap
        if (recoverable > 0) items.push({ id: s.id, name: s.name, reason: 'possible_duplicate', monthlyCents: recoverable, detail: `${group.length} concurrent ${s.name} plans on ${[...new Set(group.map(g => g.accountLabel))].join(' + ')} — if they serve the same store, all but one may be redundant`, action: 'REVIEW FOR CANCELLATION' });
      }
    }
    if (s.flags.includes('price_increase') && s.previousAmountCents != null) {
      const delta = s.monthlyCents - Math.round(s.monthlyCents * s.previousAmountCents / s.currentAmountCents);
      if (delta > 0) items.push({ id: s.id, name: s.name, reason: 'price_increase', monthlyCents: delta, detail: `went from ${(s.previousAmountCents / 100).toFixed(2)} to ${(s.currentAmountCents / 100).toFixed(2)} (${s.priceChangePct}%) on ${s.lastDate}`, action: 'REVIEW PRICE' });
    }
  }
  for (const s of subs.filter(x => x.attribution.needsAttribution && x.status !== 'cancelled')) items.push({ id: s.id, name: s.name, reason: 'needs_attribution', monthlyCents: 0, detail: `${(s.monthlyCents / 100).toFixed(2)}/mo on ${s.accountLabel} is in nobody's P&L${s.suggestedStoreName ? ` — likely ${s.suggestedStoreName}` : ''}`, action: 'ASSIGN STORE' });
  for (const s of subs.filter(x => x.status === 'needs_review')) items.push({ id: s.id, name: s.name, reason: 'needs_review', monthlyCents: 0, detail: s.statusReason, action: 'REVIEW' });
  items.sort((a, b) => b.monthlyCents - a.monthlyCents);
  const dupCents = items.filter(i => i.reason === 'possible_duplicate').reduce((x, i) => x + i.monthlyCents, 0);
  const incCents = items.filter(i => i.reason === 'price_increase').reduce((x, i) => x + i.monthlyCents, 0);
  const savings: Savings = { potentialMonthlyCents: dupCents + incCents, potentialAnnualCents: (dupCents + incCents) * 12, duplicateSpendMonthlyCents: dupCents, priceIncreaseMonthlyCents: incCents, items };
  return { subs, summary, savings, hidden };
}

export function subscriptionDetail(db: DatabaseType.Database, id: string, today?: string) {
  const { subs, hidden } = listSubscriptions(db, today);
  const s = [...subs, ...hidden].find(x => x.id === id);
  if (!s) return null;
  const q = s.txnIds.map(() => '?').join(',');
  const txns = db.prepare(`
    SELECT t.id, t.date, t.amount_cents, t.description, t.status, a.institution_name || ' ··' || a.last_four AS account,
           COALESCE(t.custom_store_id, r.store_id) AS store_id, s.name AS store_name, r.category, r.method
    FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
    LEFT JOIN classification_results r ON r.txn_id = t.id LEFT JOIN stores s ON s.id = COALESCE(t.custom_store_id, r.store_id)
    WHERE t.id IN (${q}) ORDER BY t.date DESC`).all(...s.txnIds);
  const related = subs.filter(x => x.merchantKey === s.merchantKey && x.id !== s.id).map(x => ({ id: x.id, name: x.name, accountLabel: x.accountLabel, monthlyCents: x.monthlyCents, status: x.status, storeName: x.storeName, firstDate: x.firstDate, lastDate: x.lastDate }));
  return { subscription: s, transactions: txns, related };
}

/** Worker assigns a store once: remembered for the vendor (future charges
 *  inherit it) and applied to the subscription's own rows through the same
 *  path the Transactions page uses, so every surface agrees. */
export async function assignStore(db: DatabaseType.Database, subscriptionId: string, storeId: string | null, actor: string | null, note?: string) {
  ensureSubscriptionSchema(db);
  const detail = subscriptionDetail(db, subscriptionId);
  if (!detail) return { ok: false, error: 'subscription not found' };
  const key = detail.subscription.merchantKey;
  if (storeId) {
    db.prepare(`INSERT INTO subscription_mappings (merchant_key, store_id, note, actor) VALUES (?, ?, ?, ?)
      ON CONFLICT(merchant_key) DO UPDATE SET store_id = excluded.store_id, note = excluded.note, actor = excluded.actor, updated_at = datetime('now')`).run(key, storeId, note || null, actor);
  } else {
    db.prepare('DELETE FROM subscription_mappings WHERE merchant_key = ?').run(key);
  }
  const { categorizeTransaction, saveResult } = await import('../categorize/engine');
  const { ensureCategorizeSchema } = await import('../categorize/merchants');
  ensureCategorizeSchema(db);
  let paired = 0;
  for (const t of detail.transactions as any[]) {
    db.prepare('UPDATE bank_transactions SET custom_store_id = ? WHERE id = ?').run(storeId, t.id);
    const fresh: any = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(t.id);
    const r = await categorizeTransaction(db, fresh, { allowLlm: false });
    saveResult(db, r);
    db.prepare("UPDATE classification_results SET store_id = ? WHERE txn_id = ? AND method = 'MANUAL'").run(storeId, t.id);
    paired++;
  }
  return { ok: true, merchantKey: key, paired };
}

export function setReview(db: DatabaseType.Database, subscriptionId: string, status: ReviewStatus | null, note: string | null, actor: string | null) {
  ensureSubscriptionSchema(db);
  if (!status) { db.prepare('DELETE FROM subscription_reviews WHERE subscription_id = ?').run(subscriptionId); return { ok: true }; }
  db.prepare(`INSERT INTO subscription_reviews (subscription_id, status, note, actor) VALUES (?, ?, ?, ?)
    ON CONFLICT(subscription_id) DO UPDATE SET status = excluded.status, note = excluded.note, actor = excluded.actor, updated_at = datetime('now')`).run(subscriptionId, status, note, actor);
  return { ok: true };
}
