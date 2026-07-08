import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { storeEvidenceRows } from './evidence-store';

// ─────────────────────────────────────────────────────────────────────────────
// Shopify per-store credential vault + client_credentials token minting.
//
// We store the custom app's Client ID + Secret (shpss_…) ONCE per store. Before
// every API call the server mints a short-lived (~24h) access token via the
// OAuth client_credentials grant and caches it until it expires. The user never
// hand-pastes a token, and each credential is bound to exactly one shop domain —
// so cross-store data mixups become structurally impossible.
// ─────────────────────────────────────────────────────────────────────────────

const API_VERSION = '2025-01';

export function ensureShopifyCredsTable(db: Database.Database) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS shopify_credentials (
      store_id TEXT PRIMARY KEY,
      shop_domain TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      token_cache TEXT,
      token_expires_at INTEGER,
      last_synced_at TEXT,
      last_sync_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
}

/** Normalize any pasted domain to the bare myshopify host (no scheme, no path). */
export function normalizeShopDomain(input: string): string {
  let d = (input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!d.includes('.')) d = `${d}.myshopify.com`;
  return d;
}

export function saveShopifyCreds(db: Database.Database, storeId: string, shopDomain: string, clientId: string, clientSecret: string) {
  ensureShopifyCredsTable(db);
  const domain = normalizeShopDomain(shopDomain);
  db.prepare(`
    INSERT INTO shopify_credentials (store_id, shop_domain, client_id, client_secret, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(store_id) DO UPDATE SET
      shop_domain = excluded.shop_domain,
      client_id = excluded.client_id,
      client_secret = excluded.client_secret,
      token_cache = NULL, token_expires_at = NULL,
      updated_at = datetime('now')
  `).run(storeId, domain, clientId.trim(), clientSecret.trim());
}

export interface StoreCreds {
  store_id: string; shop_domain: string; client_id: string; client_secret: string;
  token_cache: string | null; token_expires_at: number | null;
  last_synced_at: string | null; last_sync_note: string | null;
}

export function getCreds(db: Database.Database, storeId: string): StoreCreds | null {
  ensureShopifyCredsTable(db);
  return (db.prepare('SELECT * FROM shopify_credentials WHERE store_id = ?').get(storeId) as any) || null;
}

/** Mint (or reuse a cached) access token via client_credentials. Returns the token string. */
export async function getAccessToken(db: Database.Database, storeId: string, nowMs: number): Promise<string> {
  const creds = getCreds(db, storeId);
  if (!creds) throw new Error('No Shopify credentials saved for this store');

  // reuse cached token until 5 min before expiry
  if (creds.token_cache && creds.token_expires_at && creds.token_expires_at - 5 * 60_000 > nowMs) {
    return creds.token_cache;
  }

  const res = await fetch(`https://${creds.shop_domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      grant_type: 'client_credentials',
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token mint failed (${res.status}): ${text.slice(0, 300)}`);
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`Token response not JSON: ${text.slice(0, 200)}`); }
  const token = json.access_token;
  if (!token) throw new Error(`No access_token in response: ${text.slice(0, 200)}`);
  const expiresMs = nowMs + (Number(json.expires_in) || 86400) * 1000;

  db.prepare('UPDATE shopify_credentials SET token_cache = ?, token_expires_at = ? WHERE store_id = ?')
    .run(token, expiresMs, storeId);
  return token;
}

/** Authenticated GET against the store's Admin API. Returns { json, linkHeader }. */
export async function shopifyGetRaw(db: Database.Database, storeId: string, path: string, nowMs: number): Promise<{ json: any; link: string | null }> {
  const creds = getCreds(db, storeId);
  if (!creds) throw new Error('No Shopify credentials saved for this store');
  const token = await getAccessToken(db, storeId, nowMs);
  const url = path.startsWith('http') ? path : `https://${creds.shop_domain}/admin/api/${API_VERSION}/${path}`;
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path.slice(0, 60)} failed (${res.status}): ${text.slice(0, 300)}`);
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`Response not JSON: ${text.slice(0, 200)}`); }
  return { json, link: res.headers.get('link') };
}

export async function shopifyGet(db: Database.Database, storeId: string, path: string, nowMs: number): Promise<any> {
  return (await shopifyGetRaw(db, storeId, path, nowMs)).json;
}

/** Follow Shopify cursor pagination (Link: rel="next") up to maxPages. */
async function shopifyGetAll(db: Database.Database, storeId: string, path: string, key: string, nowMs: number, maxPages = 20): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = path;
  for (let page = 0; page < maxPages && next; page++) {
    const { json, link }: { json: any; link: string | null } = await shopifyGetRaw(db, storeId, next, nowMs);
    if (Array.isArray(json[key])) out.push(...json[key]);
    const m = link && link.match(/<([^>]+)>;\s*rel="next"/);
    next = m ? m[1] : null;
  }
  return out;
}

const toCents = (s: any): number => Math.round(parseFloat(String(s ?? '0')) * 100) || 0;

// ── Normalizers: Shopify Payments API JSON → the pipeline's NormalizedRow shape ──

/** Payouts list → shopify_payouts rows (one per payout: date, status, net, breakdown). */
function normalizePayouts(payouts: any[]): any[] {
  return payouts.map(p => {
    const s = p.summary || {};
    const charges = toCents(s.charges_gross_amount);
    const refunds = toCents(s.refunds_gross_amount);
    const adjustments = toCents(s.adjustments_gross_amount);
    const reserved = toCents(s.reserved_funds_gross_amount);
    const fees = toCents(s.charges_fee_amount) + toCents(s.refunds_fee_amount) + toCents(s.adjustments_fee_amount) + toCents(s.reserved_funds_fee_amount);
    return {
      ts_utc: null, date: p.date, type: 'payout', reference: String(p.id),
      payout_status: p.status, payout_date: p.date,
      amount_cents: toCents(p.amount), fee_cents: fees, net_cents: toCents(p.amount),
      money: { Charges: charges, Refunds: refunds, Adjustments: adjustments, 'Reserved Funds': reserved, Fees: fees, Total: toCents(p.amount) },
      raw: { id: p.id, status: p.status, date: p.date, amount: p.amount },
    };
  });
}

/** Balance transactions → shopify_payments rows (exact-second per-transaction detail).
 *  Resolves each txn's payout date from the payouts map (pending txns have no payout_id). */
function normalizeBalanceTxns(txns: any[], payoutDateById: Map<string, string>): any[] {
  return txns
    // 'payout' type rows are the payout MOVEMENT itself (net = −sum of that payout's
    // charges); the payout is already captured in shopify_payouts. Keeping them here would
    // zero out each payout group (charges − reserve − payout = 0). Drop them.
    .filter(t => (t.type || '').toLowerCase() !== 'payout')
    .map(t => {
    const pid = t.payout_id != null ? String(t.payout_id) : null;
    const payoutDate = pid ? (payoutDateById.get(pid) || null) : null;
    return {
      ts_utc: t.processed_at ? isoToUtcSeconds(t.processed_at) : null,
      date: t.processed_at ? isoToUtcSeconds(t.processed_at)?.slice(0, 10) : null,
      type: t.type, reference: t.source_order_id ? `#${t.source_order_id}` : String(t.id),
      payout_status: t.payout_status || (pid ? 'paid' : 'pending'),
      payout_date: payoutDate,
      amount_cents: toCents(t.amount), fee_cents: toCents(t.fee), net_cents: toCents(t.net),
      money: {}, raw: { id: t.id, type: t.type, payout_id: t.payout_id },
    };
  });
}

/** ISO8601 with offset → 'YYYY-MM-DD HH:MM:SS' in UTC. */
function isoToUtcSeconds(iso: string): string | null {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return null;
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Pull payouts + balance transactions + disputes + balance from Shopify and feed the
 *  pipeline. Returns a per-source summary. */
export async function syncShopifyPayments(db: Database.Database, storeId: string, nowMs: number): Promise<any> {
  const summary: any = { payouts: null, transactions: null, disputes: null, balance_cents: null };

  // 1) Payouts (last ~90 days + all scheduled/pending) → shopify_payouts
  const payouts = await shopifyGetAll(db, storeId, 'shopify_payments/payouts.json?limit=250', 'payouts', nowMs);
  const payoutDateById = new Map<string, string>();
  for (const p of payouts) payoutDateById.set(String(p.id), p.date);
  const payoutRows = normalizePayouts(payouts);
  const pr = storeEvidenceRows(db, { storeId, kind: 'shopify_payouts', rows: payoutRows, filename: 'shopify-api:payouts' });
  summary.payouts = { pulled: payouts.length, ...pr };

  // 2) Balance transactions → shopify_payments (exact-second detail)
  const txns = await shopifyGetAll(db, storeId, 'shopify_payments/balance/transactions.json?limit=250', 'transactions', nowMs);
  const txnRows = normalizeBalanceTxns(txns, payoutDateById);
  const tr = storeEvidenceRows(db, { storeId, kind: 'shopify_payments', rows: txnRows, filename: 'shopify-api:transactions' });
  summary.transactions = { pulled: txns.length, ...tr };

  // 3) Disputes → chargebacks table (book lost/needs_response as costs)
  const disputes = await shopifyGetAll(db, storeId, 'shopify_payments/disputes.json?limit=250', 'disputes', nowMs);
  let dbooked = 0;
  for (const d of disputes) {
    const id = `shopify_dispute_${d.id}`;
    const dateOnly = (d.initiated_at || '').slice(0, 10) || null;
    const amountCents = toCents(d.amount);
    const status = /won/i.test(d.status) ? 'won' : /lost/i.test(d.status) ? 'lost' : 'open';
    const exists = db.prepare('SELECT id FROM chargebacks WHERE id = ?').get(id);
    if (!exists) {
      db.prepare(`INSERT INTO chargebacks (id, store_id, order_number, chargeback_date, amount_cents, reason, status, chargeflow_fee_cents, notes, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, storeId, d.order_id ? `#${d.order_id}` : null, dateOnly, amountCents,
        d.reason || 'dispute', status, 0, `Shopify dispute ${d.id} (${d.type}, ${d.status})`, 'shopify_api');
      dbooked++;
    } else {
      db.prepare('UPDATE chargebacks SET status = ?, amount_cents = ? WHERE id = ?').run(status, amountCents, id);
    }
  }
  summary.disputes = { pulled: disputes.length, booked: dbooked };

  // 4) Available balance (the ****account behind Shopify Balance)
  try {
    const bal = await shopifyGet(db, storeId, 'shopify_payments/balance.json', nowMs);
    const first = Array.isArray(bal?.balance) ? bal.balance[0] : null;
    summary.balance_cents = first ? toCents(first.amount) : null;
  } catch { /* balance scope optional */ }

  const note = `payouts ${summary.payouts.pulled} (${summary.payouts.imported} new/${summary.payouts.updated} upd), txns ${summary.transactions.pulled} (${summary.transactions.imported} new/${summary.transactions.updated} upd), disputes ${summary.disputes.pulled}`;
  db.prepare('UPDATE shopify_credentials SET last_synced_at = datetime(\'now\'), last_sync_note = ? WHERE store_id = ?').run(note, storeId);
  summary.note = note;
  return summary;
}

/** Live Shopify figures for the CFO balance sheet — replaces hand-typed values.
 *  pending_balance = Shopify's payout balance (money held, not yet in a payout)
 *  scheduled       = payouts Shopify has committed but not sent
 *  paid_unlanded   = payouts sent whose landing day hasn't passed (in transit)
 *  reserves        = sum of reserve holdback events (from synced evidence)   */
export function pacificDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The Main (Shopify Balance) account anchor: manually-set balance + the Pacific date it
 *  was set. THE ANCHOR RULE: any payout expected to land ON OR BEFORE the anchor date is
 *  presumed INSIDE the anchor balance — it must never also count as in-transit. Ambiguity
 *  always resolves toward the bank side (brief undercount possible, overcount never). */
export function getMainAnchor(db: Database.Database, storeId: string): { balance_cents: number; anchor_date: string; exceptions: string[] } | null {
  try {
    try { db.exec('ALTER TABLE bank_accounts ADD COLUMN anchor_exceptions TEXT'); } catch { /* exists */ }
    const row: any = db.prepare(
      "SELECT balance_available_cents, balance_updated_at, anchor_exceptions FROM bank_accounts WHERE store_id = ? AND institution_name = 'Shopify Balance' AND status = 'active' LIMIT 1"
    ).get(storeId);
    if (!row || row.balance_available_cents == null || !row.balance_updated_at) return null;
    const anchorDate = pacificDate(new Date(String(row.balance_updated_at).replace(' ', 'T') + 'Z'));
    // exceptions: payout references KNOWN not to be in the anchored balance (visible as
    // Deposited on the Payouts screen but absent from Main's statement at anchor time).
    // They stay in-transit despite the Anchor Rule — exact books, still no double count.
    let exceptions: string[] = [];
    try { exceptions = JSON.parse(row.anchor_exceptions || '[]'); } catch { /* ignore */ }
    return { balance_cents: row.balance_available_cents, anchor_date: anchorDate, exceptions };
  } catch { return null; }
}

export async function getLiveShopifyFigures(db: Database.Database, storeId: string, nowMs: number): Promise<{
  pending_balance_cents: number; scheduled_cents: number; paid_unlanded_cents: number; reserves_cents: number; as_of: string; anchor_date: string | null;
}> {
  const todayPacific = pacificDate(new Date(nowMs));
  const anchor = getMainAnchor(db, storeId);
  // in-transit cutoff (Anchor Rule): only payouts landing strictly AFTER the anchor date
  // count as in transit — anything on/before it is presumed inside the anchored bank
  // balance. With no anchor, payouts landing today or later count (yesterday as cutoff).
  const yesterday = pacificDate(new Date(nowMs - 86_400_000));
  const transitAfter = anchor ? anchor.anchor_date : yesterday;

  const bal = await shopifyGet(db, storeId, 'shopify_payments/balance.json', nowMs);
  const pending = Array.isArray(bal?.balance) && bal.balance[0] ? toCents(bal.balance[0].amount) : 0;

  const payouts = (await shopifyGet(db, storeId, 'shopify_payments/payouts.json?limit=250', nowMs))?.payouts || [];
  let scheduled = 0, paidUnlanded = 0;
  const exceptions = new Set(anchor?.exceptions || []);
  for (const p of payouts) {
    const st = (p.status || '').toLowerCase();
    if (/sched|in_transit/.test(st)) scheduled += toCents(p.amount);
    else if (st === 'paid' && (p.date > transitAfter || exceptions.has(String(p.id)))) paidUnlanded += toCents(p.amount);
  }

  // Reserve total: sum of reserve holdback events from the synced per-transaction evidence
  // (withhold negative → adds to held; release positive → subtracts). No direct API total.
  let reserves = 0;
  const uploads: any[] = db.prepare(
    "SELECT rows_json FROM cfo_evidence WHERE store_id = ? AND kind = 'shopify_payments'"
  ).all(storeId);
  for (const u of uploads) {
    try {
      for (const r of JSON.parse(u.rows_json) || []) {
        if (/reserve/.test((r.type || '').toLowerCase())) reserves -= r.net_cents ?? 0;
      }
    } catch { /* skip corrupt */ }
  }
  if (reserves < 0) reserves = 0;

  return { pending_balance_cents: pending, scheduled_cents: scheduled, paid_unlanded_cents: paidUnlanded, reserves_cents: reserves, as_of: new Date(nowMs).toISOString(), anchor_date: anchor?.anchor_date || null };
}

/** Live probe: mint a token and confirm the store identity + payments scope. */
export async function probeStore(db: Database.Database, storeId: string, nowMs: number): Promise<{ shop: string; currency: string; payouts_visible: boolean }> {
  const shop = await shopifyGet(db, storeId, 'shop.json', nowMs);
  let payoutsVisible = false;
  try {
    await shopifyGet(db, storeId, 'shopify_payments/payouts.json?limit=1', nowMs);
    payoutsVisible = true;
  } catch { /* scope not granted or not a Shopify Payments store */ }
  return {
    shop: shop?.shop?.myshopify_domain || shop?.shop?.name || 'unknown',
    currency: shop?.shop?.currency || 'USD',
    payouts_visible: payoutsVisible,
  };
}
