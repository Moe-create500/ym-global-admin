import type DatabaseType from 'better-sqlite3';
import { cashAvailableCents } from './bank-balances';
import { getPaymentsInFlight } from './payments-in-flight';
import { listSubscriptions } from './subscriptions/service';

/** The cash position of the SHOPIFY STORES — one store or all of them —
 *  built from the SAME sources every other finance surface uses, one
 *  definition per number. ShipSourced (the 3PL) is out of scope here: it has
 *  its own P&L on the CFO page and its accounts never enter these figures.
 *
 *    cash           bank_accounts (depository) via bank-balances.ts   ← Bank Accounts page
 *    card debt      credit accounts via cardOwedCents                 ← Credit Cards page / CFO
 *    card charges   unpaid charges paired to the store                ← CFO "Card charges linked"
 *    in flight      logged card payments not yet debited             ← payments-in-flight.ts
 *    FB unbilled    fb_profiles.balance_cents                         ← Ad accounts
 *    recurring      subscriptions engine, next expected date          ← Subscriptions page
 *    ad burn        daily_pnl, measured 7-day average                 ← P&L
 *
 *  Scope rule: a store's cash is ONLY the accounts assigned to it; "all"
 *  is the sum over active Shopify stores. Unknown is null, never $0. */

export interface Figure { cents: number | null; asOf?: string | null; note?: string; href?: string; rows?: { label: string; cents: number; note?: string }[] }

export interface CashPosition {
  scope: { storeId: string | null; storeName: string; note?: string };
  cash: Figure;                 // this scope's spendable cash (accounts assigned to the store / to any Shopify store)
  obligations: {
    cardCharges: Figure;        // unpaid card charges paired to this store / to all Shopify stores
    inFlight: Figure;           // payments already leaving
    fbUnbilled: Figure;
    recurringDue14d: Figure;
    manualCards: Figure;
    adBurn7d: Figure;
    totalCents: number;         // card charges + FB + recurring + ad burn 7d (in-flight is inside card debt; manual rows have no due date)
  };
  freshness: { bank: string | null; shopify: string | null; fb: string | null };
  /** All-stores only: one light row per store so the overview table shares the same definitions. */
  storeRows?: { storeId: string; storeName: string; cashCents: number | null; cardChargesCents: number; fbCents: number | null; recurring14dCents: number }[];
}

const HIDDEN = "COALESCE(a.cfo_hidden, 0) = 0 AND a.merged_into IS NULL AND a.status = 'active'";

function maxDate(rows: any[], key: string): string | null {
  return rows.reduce<string | null>((m, r) => (r[key] && (!m || r[key] > m) ? r[key] : m), null);
}

// The subscriptions engine scans the whole ledger (~0.5 s) — memoised per
// process for 5 minutes so the position page stays instant.
let subsCache: { at: number; subs: ReturnType<typeof listSubscriptions>['subs'] } | null = null;
function subsCached(db: DatabaseType.Database) {
  if (subsCache && Date.now() - subsCache.at < 5 * 60_000) return subsCache.subs;
  try { subsCache = { at: Date.now(), subs: listSubscriptions(db).subs }; } catch { subsCache = { at: Date.now(), subs: [] }; }
  return subsCache.subs;
}
export function _resetSubsCache() { subsCache = null; }

export function buildCashPosition(db: DatabaseType.Database, storeId: string | undefined, adBurnDailyCents: number, today = new Date().toISOString().slice(0, 10)): CashPosition {
  const shopifyStores: any[] = db.prepare("SELECT id, name FROM stores WHERE platform = 'shopify' AND is_active = 1 ORDER BY name").all();
  const shopifyIds = new Set(shopifyStores.map(x => x.id));
  const requested: any = storeId ? db.prepare('SELECT id, name, platform FROM stores WHERE id = ?').get(storeId) : null;
  // A non-Shopify store (ShipSourced, Amazon…) has no Shopify cashflow — fall back to all Shopify stores and say so.
  const store = requested && shopifyIds.has(requested.id) ? requested : null;
  const scope = { storeId: store ? store.id : null, storeName: store ? store.name : 'All Shopify stores', note: requested && !store ? `${requested.name} is not a Shopify store — cashflow covers Shopify stores only.` : undefined };
  const inScope = (sid: string | null) => store ? sid === store.id : !!sid && shopifyIds.has(sid);
  const idList = store ? [store.id] : [...shopifyIds];
  const idPlaceholders = idList.map(() => '?').join(',');

  // ── Cash ──
  const depAll: any[] = db.prepare(`SELECT a.*, COALESCE(a.nickname, a.account_name) AS label, s.name AS store_name FROM bank_accounts a LEFT JOIN stores s ON s.id = a.store_id WHERE a.account_type != 'credit' AND ${HIDDEN}`).all();
  const dep = depAll.filter(a => inScope(a.store_id));
  const cashRows = dep.map(a => ({ label: `${a.label} ·${a.last_four || '????'}${store ? '' : a.store_name ? ` (${a.store_name})` : ''}`, cents: cashAvailableCents(a), note: a.institution_name || undefined }));
  const cash: Figure = dep.length
    ? { cents: cashRows.reduce((s, r) => s + r.cents, 0), asOf: maxDate(dep, 'balance_updated_at'), rows: cashRows, href: '/dashboard/banking' }
    : { cents: null, note: store ? `No bank account is assigned to ${store.name}. Assign one on Bank Accounts to see its cash.` : 'No bank account is assigned to any Shopify store.', href: '/dashboard/banking' };

  // ── Card charges owed (same query as the CFO "Card charges linked to this store"; ad and app invoices are tracked separately) ──
  const chargeRows: any[] = db.prepare(`
    SELECT r.store_id, s.name AS store_name, COUNT(*) n, COALESCE(SUM(-bt.amount_cents), 0) cents FROM bank_transactions bt
    JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.account_type = 'credit' AND a.status = 'active'
    JOIN classification_results r ON r.txn_id = bt.id AND r.store_id IN (${idPlaceholders})
    JOIN stores s ON s.id = r.store_id
    WHERE bt.amount_cents < 0 AND bt.settled_at IS NULL
      AND COALESCE(r.category, '') NOT IN ('Credit Card Payment', 'Transfer Out', 'Transfer In')
      AND COALESCE(r.method, '') != 'INVOICE_MATCH'
      AND COALESCE(r.merchant_name, '') NOT IN ('Meta', 'Google Ads', 'Shopify')
      AND LOWER(bt.description) NOT LIKE '%shopify%' AND LOWER(bt.description) NOT LIKE '%facebk%'
      AND LOWER(bt.description) NOT LIKE '%facebook%' AND LOWER(bt.description) NOT LIKE '%google%'
    GROUP BY r.store_id ORDER BY cents DESC`).all(...idList);
  const chargeN = chargeRows.reduce((t, r) => t + r.n, 0);
  const cardCharges: Figure = {
    cents: chargeRows.reduce((t, r) => t + r.cents, 0),
    rows: store ? undefined : chargeRows.map(r => ({ label: r.store_name, cents: r.cents, note: `${r.n} charge${r.n === 1 ? '' : 's'}` })),
    note: `${chargeN} unpaid card charge${chargeN === 1 ? '' : 's'} paired to ${store ? store.name : 'Shopify stores'} — mark them paid on the CFO page`,
    href: store ? `/dashboard/cfo?storeId=${store.id}&tab=position` : '/dashboard/cfo',
  };

  // ── Payments in flight (this store's / every Shopify store's logged card payments not yet debited) ──
  let inFlight: Figure;
  try {
    let cents = 0; const rows: NonNullable<Figure['rows']> = [];
    for (const sid of idList) {
      const f = getPaymentsInFlight(db, sid, 21);
      cents += f.totalCents;
      const nm = shopifyStores.find(x => x.id === sid)?.name || '';
      for (const r of f.rows) rows.push({ label: `${store ? '' : nm + ' → '}card ··${r.card_last4} · ${r.date}`, cents: r.amount_cents, note: r.status });
    }
    inFlight = { cents, rows, href: store ? `/dashboard/cfo?storeId=${store.id}&tab=position` : '/dashboard/credit-cards' };
  } catch (e: any) { inFlight = { cents: null, note: `in-flight detection failed: ${String(e?.message || e).slice(0, 80)}` }; }

  // ── FB unbilled ──
  const fbRows: any[] = db.prepare(`SELECT p.profile_name, p.balance_cents, p.last_sync_at, s.name AS store_name FROM fb_profiles p JOIN stores s ON s.id = p.store_id WHERE p.is_active = 1 AND p.store_id IN (${idPlaceholders})`).all(...idList);
  const fbUnbilled: Figure = fbRows.length
    ? { cents: fbRows.reduce((s, r) => s + Math.max(0, r.balance_cents || 0), 0), asOf: maxDate(fbRows, 'last_sync_at'), rows: fbRows.filter(r => (r.balance_cents || 0) > 0).map(r => ({ label: `${r.profile_name}${store ? '' : ` (${r.store_name || '—'})`}`, cents: r.balance_cents })), note: 'Meta will bill this soon', href: '/dashboard/ads/connect' }
    : { cents: null, note: store ? `No ad account is linked to ${store.name}` : 'No ad accounts linked to Shopify stores', href: '/dashboard/ads/connect' };

  // ── Recurring charges due in the next 14 days ──
  const horizon = new Date(new Date(today + 'T00:00:00Z').getTime() + 14 * 864e5).toISOString().slice(0, 10);
  const subs = subsCached(db).filter(s => (s.status === 'active' || s.status === 'possibly_active') && s.nextExpectedDate && s.nextExpectedDate >= today && s.nextExpectedDate <= horizon && inScope(s.attribution.storeId));
  const recurringDue14d: Figure = { cents: subs.reduce((s, x) => s + x.currentAmountCents, 0), rows: subs.map(s => ({ label: `${s.name} · ${s.nextExpectedDate}`, cents: s.currentAmountCents, note: s.cadence })).sort((a, b) => a.label.localeCompare(b.label)), note: store ? 'Subscriptions attributed to this store' : 'Subscriptions attributed to Shopify stores', href: '/dashboard/subscriptions' };

  // ── Manual card / liability rows (kept for what the feeds cannot see) ──
  const manual: any[] = db.prepare(`SELECT m.card_name, m.amount_owed_cents, s.name AS store_name FROM manual_credit_cards m JOIN stores s ON s.id = m.store_id WHERE m.amount_owed_cents > 0 AND m.store_id IN (${idPlaceholders})`).all(...idList);
  const manualCards: Figure = { cents: manual.reduce((s, r) => s + r.amount_owed_cents, 0), rows: manual.map(r => ({ label: `${r.card_name}${store ? '' : ` (${r.store_name || '—'})`}`, cents: r.amount_owed_cents, note: 'manual entry' })), note: 'Manually entered liabilities', href: store ? `/dashboard/cfo?storeId=${store.id}&tab=position` : '/dashboard/cfo' };

  const adBurn7d: Figure = { cents: adBurnDailyCents * 7, note: `${(adBurnDailyCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/day, measured over the last 7 days` };

  // Manual rows are NOT in the 7-day total: they hold investor loans and hand-typed liabilities with no due date.
  const totalCents = (cardCharges.cents || 0) + (fbUnbilled.cents || 0) + recurringDue14d.cents! + adBurn7d.cents!;

  let storeRows: CashPosition['storeRows'];
  if (!store) {
    const charges: any[] = db.prepare(`
      SELECT r.store_id, COALESCE(SUM(-bt.amount_cents), 0) cents FROM bank_transactions bt
      JOIN bank_accounts a ON a.id = bt.bank_account_id AND a.account_type = 'credit' AND a.status = 'active'
      JOIN classification_results r ON r.txn_id = bt.id
      WHERE bt.amount_cents < 0 AND bt.settled_at IS NULL AND r.store_id IS NOT NULL
        AND COALESCE(r.category, '') NOT IN ('Credit Card Payment', 'Transfer Out', 'Transfer In')
        AND COALESCE(r.method, '') != 'INVOICE_MATCH'
        AND COALESCE(r.merchant_name, '') NOT IN ('Meta', 'Google Ads', 'Shopify')
        AND LOWER(bt.description) NOT LIKE '%shopify%' AND LOWER(bt.description) NOT LIKE '%facebk%'
        AND LOWER(bt.description) NOT LIKE '%facebook%' AND LOWER(bt.description) NOT LIKE '%google%'
      GROUP BY r.store_id`).all();
    const chargeBy = new Map(charges.map(c => [c.store_id, c.cents]));
    const fbAll: any[] = db.prepare('SELECT store_id, SUM(MAX(balance_cents, 0)) cents, COUNT(*) n FROM fb_profiles WHERE is_active = 1 GROUP BY store_id').all();
    const fbBy = new Map(fbAll.map(f => [f.store_id, f.cents]));
    const allSubs = subsCached(db);
    storeRows = shopifyStores.map(st => {
      const acc = depAll.filter(a => a.store_id === st.id);
      return {
        storeId: st.id, storeName: st.name,
        cashCents: acc.length ? acc.reduce((s, a) => s + cashAvailableCents(a), 0) : null,
        cardChargesCents: chargeBy.get(st.id) || 0,
        fbCents: fbBy.has(st.id) ? fbBy.get(st.id) : null,
        recurring14dCents: allSubs.filter(x => (x.status === 'active' || x.status === 'possibly_active') && x.attribution.storeId === st.id && x.nextExpectedDate && x.nextExpectedDate >= today && x.nextExpectedDate <= horizon).reduce((s, x) => s + x.currentAmountCents, 0),
      };
    });
  }

  const shopify: any = db.prepare(`SELECT MIN(last_synced_at) mn, MAX(last_synced_at) mx FROM shopify_credentials WHERE store_id IN (${idPlaceholders})`).get(...idList);
  return {
    scope, cash,
    obligations: { cardCharges, inFlight, fbUnbilled, recurringDue14d, manualCards, adBurn7d, totalCents },
    freshness: { bank: cash.asOf || null, shopify: store ? shopify?.mx || null : shopify?.mn || null, fb: fbUnbilled.asOf || null },
    storeRows,
  };
}
