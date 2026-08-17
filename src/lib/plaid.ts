// Plaid integration — replaces Teller for NEW bank/card connections (Teller
// went invite-only and its BoA feeds died 2026-07). Reuses the existing
// bank_accounts/bank_transactions tables: plaid account ids live in
// teller_account_id, item ids in teller_enrollment_id, provider='plaid'
// distinguishes the sync path. Existing rows re-attach by institution +
// last_four + type, so history survives the provider switch.

import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { reportSource } from '@/lib/source-registry';

const PLAID_ENV = process.env.PLAID_ENV || 'production';
const BASE = `https://${PLAID_ENV}.plaid.com`;

async function plaidPost(path: string, body: Record<string, any>): Promise<any> {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) throw new Error('PLAID_CLIENT_ID / PLAID_SECRET not configured');
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...body }),
  });
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Plaid ${path} ${res.status}: ${d?.error_code || ''} ${String(d?.error_message || '').slice(0, 180)}`);
  return d;
}

export function ensurePlaidSchema(db: Database.Database) {
  try { db.exec("ALTER TABLE bank_accounts ADD COLUMN provider TEXT DEFAULT 'teller'"); } catch { /* exists */ }
  try { db.exec('ALTER TABLE bank_accounts ADD COLUMN last_sync_error TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE bank_accounts ADD COLUMN bank_data_as_of TEXT'); } catch { /* exists */ }
  db.exec(`CREATE TABLE IF NOT EXISTS plaid_items (
    item_id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    institution_name TEXT,
    cursor TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
}

/** Link token for the Plaid Link popup. Pass an existing item's access token
 *  for UPDATE mode (re-authenticate a broken connection in place). */
export async function createLinkToken(opts: { accessToken?: string } = {}): Promise<string> {
  const body: any = {
    user: { client_user_id: 'ym-global-admin' },
    client_name: 'YM Global',
    language: 'en',
    country_codes: ['US'],
    // liabilities consent = statement balance/date/due date straight from the
    // bank (drives card_statements automatically). Update-mode relinks request
    // it as additional consent so existing items gain the scope on re-auth.
    ...(opts.accessToken
      ? { access_token: opts.accessToken, additional_consented_products: ['liabilities'] }
      : { products: ['transactions'], additional_consented_products: ['liabilities'] }),
  };
  const d = await plaidPost('/link/token/create', body);
  return d.link_token;
}

/** Exchange the Link public token, then upsert every account on the item.
 *  Existing rows (any provider) re-attach by account id OR institution+last4. */
export async function exchangeAndImport(db: Database.Database, publicToken: string, storeId: string): Promise<{ imported: number; institution: string }> {
  ensurePlaidSchema(db);
  const ex = await plaidPost('/item/public_token/exchange', { public_token: publicToken });
  const accessToken = ex.access_token;
  const itemId = ex.item_id;
  const acc = await plaidPost('/accounts/get', { access_token: accessToken });

  let institution = 'Unknown';
  try {
    const instId = acc.item?.institution_id;
    if (instId) {
      const inst = await plaidPost('/institutions/get_by_id', { institution_id: instId, country_codes: ['US'] });
      institution = inst.institution?.name || 'Unknown';
    }
  } catch { /* cosmetic */ }

  db.prepare(`INSERT INTO plaid_items (item_id, access_token, institution_name) VALUES (?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET access_token = excluded.access_token, status = 'active', updated_at = datetime('now')`)
    .run(itemId, accessToken, institution);

  let imported = 0;
  for (const a of acc.accounts || []) {
    const available = Math.round(((a.balances?.available ?? a.balances?.current) || 0) * 100);
    const ledger = Math.round((a.balances?.current || 0) * 100);
    const existing: any = db.prepare('SELECT id FROM bank_accounts WHERE teller_account_id = ?').get(a.account_id)
      || db.prepare('SELECT id FROM bank_accounts WHERE last_four = ? AND account_type = ? AND institution_name = ? ORDER BY updated_at DESC LIMIT 1')
        .get(a.mask || '', a.type, institution);
    if (existing) {
      db.prepare(`UPDATE bank_accounts SET provider = 'plaid', access_token = ?, teller_enrollment_id = ?, teller_account_id = ?,
          status = 'active', balance_available_cents = ?, balance_ledger_cents = ?, balance_updated_at = datetime('now'),
          last_sync_error = NULL, updated_at = datetime('now')
        WHERE id = ?`)
        .run(accessToken, itemId, a.account_id, available, ledger, existing.id);
    } else {
      db.prepare(`INSERT INTO bank_accounts (id, store_id, provider, teller_enrollment_id, teller_account_id, access_token,
          institution_name, account_name, account_type, account_subtype, last_four, currency,
          balance_available_cents, balance_ledger_cents, balance_updated_at)
        VALUES (?, ?, 'plaid', ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, datetime('now'))`)
        .run(crypto.randomUUID(), storeId, itemId, a.account_id, accessToken, institution,
          a.official_name || a.name || 'Account', a.type, a.subtype || '', a.mask || '', available, ledger);
    }
    imported++;
  }
  return { imported, institution };
}

/** Sync every active Plaid item: balances + cursor-based transaction sync.
 *  Plaid sign convention is inverted (positive = outflow) — we store inflow-positive. */
export async function syncPlaidItems(db: Database.Database): Promise<{ accounts_synced: number; transactions_imported: number; errors: string[] }> {
  ensurePlaidSchema(db);
  const items: any[] = db.prepare("SELECT * FROM plaid_items WHERE status = 'active'").all();
  let synced = 0;
  let txns = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const bal = await plaidPost('/accounts/balance/get', { access_token: item.access_token });
      for (const a of bal.accounts || []) {
        const available = Math.round(((a.balances?.available ?? a.balances?.current) || 0) * 100);
        const ledger = Math.round((a.balances?.current || 0) * 100);
        const r = db.prepare(`UPDATE bank_accounts SET balance_available_cents = ?, balance_ledger_cents = ?,
            balance_updated_at = datetime('now'), updated_at = datetime('now'), last_sync_error = NULL
          WHERE teller_account_id = ?`).run(available, ledger, a.account_id);
        if (r.changes) synced++;
      }

      // Statement data (balance/dates/min/limit) — the bank's own numbers, no
      // manual typing. Consent-gated: items linked before liabilities consent
      // 400 here (ADDITIONAL_CONSENT_REQUIRED) and we just move on.
      try {
        const li = await plaidPost('/liabilities/get', { access_token: item.access_token });
        db.exec(`CREATE TABLE IF NOT EXISTS card_statements (
          bank_account_id TEXT PRIMARY KEY, statement_balance_cents INTEGER, statement_date TEXT,
          due_date TEXT, min_payment_cents INTEGER, updated_at TEXT DEFAULT (datetime('now')))`);
        try { db.exec("ALTER TABLE card_statements ADD COLUMN source TEXT"); } catch { /* exists */ }
        for (const c of li.liabilities?.credit || []) {
          const row: any = db.prepare('SELECT id FROM bank_accounts WHERE teller_account_id = ?').get(c.account_id);
          if (!row) continue;
          const acct = (li.accounts || []).find((a: any) => a.account_id === c.account_id);
          if (acct?.balances?.limit) {
            db.prepare('UPDATE bank_accounts SET credit_limit_cents = ? WHERE id = ?')
              .run(Math.round(acct.balances.limit * 100), row.id);
          }
          if (c.last_statement_balance == null && !c.next_payment_due_date) continue;
          // Bank statement data beats hand-typed entries — always current
          db.prepare(`INSERT INTO card_statements (bank_account_id, statement_balance_cents, statement_date, due_date, min_payment_cents, source, updated_at)
            VALUES (?, ?, ?, ?, ?, 'plaid', datetime('now'))
            ON CONFLICT(bank_account_id) DO UPDATE SET
              statement_balance_cents = excluded.statement_balance_cents, statement_date = excluded.statement_date,
              due_date = excluded.due_date, min_payment_cents = excluded.min_payment_cents,
              source = 'plaid', updated_at = datetime('now')`)
            .run(row.id,
              c.last_statement_balance != null ? Math.round(c.last_statement_balance * 100) : null,
              c.last_statement_issue_date || null, c.next_payment_due_date || null,
              c.minimum_payment_amount != null ? Math.round(c.minimum_payment_amount * 100) : null);
        }
      } catch { /* consent not granted yet — manual entry covers these cards */ }

      let cursor: string | undefined = item.cursor || undefined;
      let hasMore = true;
      let guard = 0;
      while (hasMore && guard++ < 40) {
        const d = await plaidPost('/transactions/sync', { access_token: item.access_token, ...(cursor ? { cursor } : {}), count: 250 });
        for (const t of d.added || []) {
          const row: any = db.prepare('SELECT id FROM bank_accounts WHERE teller_account_id = ?').get(t.account_id);
          if (!row) continue;
          const desc = t.name || t.merchant_name || '';
          const amountCents = -Math.round((t.amount || 0) * 100);
          const existing = db.prepare('SELECT id FROM bank_transactions WHERE teller_transaction_id = ?').get(t.transaction_id)
            || db.prepare('SELECT id FROM bank_transactions WHERE bank_account_id = ? AND date = ? AND amount_cents = ? AND description = ?')
              .get(row.id, t.date, amountCents, desc);
          if (existing) continue;
          db.prepare(`INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, description,
              category, amount_cents, type, status, counterparty, running_balance_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
            .run(crypto.randomUUID(), row.id, t.transaction_id, t.date, desc,
              (t.personal_finance_category?.primary || '').toLowerCase().replace(/_/g, ' ') || null,
              amountCents, t.payment_channel || 'other', t.pending ? 'pending' : 'posted', t.merchant_name || null);
          txns++;
        }
        cursor = d.next_cursor;
        hasMore = !!d.has_more;
      }
      db.prepare("UPDATE plaid_items SET cursor = ?, updated_at = datetime('now') WHERE item_id = ?").run(cursor || null, item.item_id);
      reportSource(db, `bank:plaid:${item.item_id}`, { ok: true, records: txns, label: `Bank — ${item.institution_name || 'Plaid item'}`, cadenceMin: 120 });
    } catch (e: any) {
      const msg = String(e?.message || e);
      errors.push(`plaid ${item.institution_name || item.item_id}: ${msg.slice(0, 160)}`);
      reportSource(db, `bank:plaid:${item.item_id}`, { ok: false, error: msg, label: `Bank — ${item.institution_name || 'Plaid item'}`, cadenceMin: 120 });
      if (/ITEM_LOGIN_REQUIRED|ITEM_LOCKED|ACCESS_NOT_GRANTED/i.test(msg)) {
        db.prepare("UPDATE bank_accounts SET last_sync_error = 'CONNECTION EXPIRED — reconnect this bank via Connect Bank' WHERE teller_enrollment_id = ?").run(item.item_id);
      }
    }
  }

  // Freshness = newest imported transaction per account
  db.exec(`UPDATE bank_accounts SET bank_data_as_of =
    (SELECT MAX(date) FROM bank_transactions bt WHERE bt.bank_account_id = bank_accounts.id)
    WHERE provider = 'plaid'`);

  try { autoAssignShopifyBalances(db); } catch { /* matching is best-effort */ }
  return { accounts_synced: synced, transactions_imported: txns, errors };
}

/** Shopify Balance accounts arrive in one bulk Plaid enrollment with no store
 *  identity — match each one's payout credits against every store's Shopify
 *  payout history (amount + date ±2 days) and assign the clear winner. Only
 *  touches accounts still carrying the generic name, so manual assignments
 *  (renamed rows) are never overridden. Runs after every sync — Plaid
 *  backfills history asynchronously, so matches appear over time. */
export function autoAssignShopifyBalances(db: Database.Database) {
  const evidence: any[] = db.prepare("SELECT store_id, rows_json FROM cfo_evidence WHERE kind = 'shopify_payouts'").all();
  const storePayouts = new Map<string, Set<string>>();
  for (const e of evidence) {
    let rows: any[] = [];
    try { rows = JSON.parse(e.rows_json); } catch { continue; }
    const set = storePayouts.get(e.store_id) || new Set<string>();
    for (const r of rows) {
      const amt = r.net_cents || r.amount_cents;
      const d = r.payout_date || r.date;
      if (amt && d) set.add(`${amt}|${d}`);
    }
    storePayouts.set(e.store_id, set);
  }
  if (!storePayouts.size) return;
  const names = new Map<string, string>((db.prepare('SELECT id, name FROM stores').all() as any[]).map((s: any) => [s.id, s.name]));
  const dayMs = 86_400_000;
  const accounts: any[] = db.prepare(`SELECT id, store_id FROM bank_accounts
    WHERE provider = 'plaid' AND institution_name LIKE '%Shopify%' AND account_name = 'Shopify Balance'
      AND status IN ('active', 'unassigned')`).all();
  for (const a of accounts) {
    const credits: any[] = db.prepare('SELECT date, amount_cents FROM bank_transactions WHERE bank_account_id = ? AND amount_cents > 0').all(a.id);
    if (!credits.length) continue;
    const scores = new Map<string, number>();
    for (const c of credits) {
      const cTime = Date.parse(c.date);
      for (const [sid, payouts] of storePayouts) {
        for (const key of payouts) {
          const [amt, d] = key.split('|');
          if (Number(amt) === c.amount_cents && Math.abs(Date.parse(d) - cTime) <= 2 * dayMs) {
            scores.set(sid, (scores.get(sid) || 0) + 1);
            break;
          }
        }
      }
    }
    const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1]);
    if (ranked.length && ranked[0][1] >= 2 && (ranked.length === 1 || ranked[0][1] > ranked[1][1] * 2)) {
      const [winner] = ranked[0];
      db.prepare("UPDATE bank_accounts SET store_id = ?, account_name = ?, status = 'active' WHERE id = ?")
        .run(winner, `${(names.get(winner) || 'Store').toUpperCase()} Shopify Balance`, a.id);
      console.log(`[plaid] Shopify Balance auto-assigned to ${names.get(winner)} (${ranked[0][1]} payout matches)`);
    }
  }
}
