import type DatabaseType from 'better-sqlite3';
import { type Scope, listScopes } from './scopes';
import { hoursSince, FRESH_HOURS } from './figures';
import { getPaymentsInFlight } from '../payments-in-flight';
import { unpairedOutflows } from './movements';

/** Things a person has to fix before the numbers can be trusted. Every issue
 *  names its source, the unit it belongs to, a count and — only when the
 *  source knows it — a dollar amount. A missing cost never gets an invented
 *  value. ShipSourced Billing Duty tickets are read from ShipSourced with
 *  their own identity and status; when that feed is unavailable the issue
 *  says so instead of showing zero tickets. */

export type IssueKind =
  | 'connection' | 'stale_source' | 'unallocated' | 'in_flight_overdue' | 'missing_pnl' | 'estimate'
  | 'ads_payments_stale' | 'fb_token' | 'double_count' | 'recon_drift' | 'no_snapshot' | 'mapping'
  | 'ss_billing_flag' | 'source_unavailable';

export interface Issue {
  id: string;
  kind: IssueKind;
  severity: 'high' | 'medium' | 'low';
  unitId: string;             // scope id the issue belongs to ('all' for company-wide)
  title: string;
  detail: string;
  count: number;
  cents: number | null;       // known amount only; null when the source does not know it
  href: string | null;        // where to fix it
  source: string;
  externalId?: string;        // e.g. ShipSourced flag id — never re-keyed
  externalStatus?: string;
}

export interface SsBillingFlagFeed {
  available: boolean;
  reason?: string;
  asOf?: string;
  flags?: { ruleKey: string; severity: string; status: string; count: number; amountCents: number | null; clientId: string | null; company: string | null; suppressed?: boolean }[];
}

/** Provider for ShipSourced Billing Duty flags. Injected so tests and the
 *  offline case don't touch the network. */
export type SsFlagProvider = () => Promise<SsBillingFlagFeed>;

export async function collectIssues(db: DatabaseType.Database, period: { from: string; to: string }, ssFlags: SsFlagProvider, now = Date.now()): Promise<Issue[]> {
  const issues: Issue[] = [];
  const scopes = listScopes(db);
  const storeUnit = (sid: string) => scopes.find(s => s.kind === 'store' && s.storeIds[0] === sid)?.id || (scopes.find(s => s.id === 'ss' && s.storeIds.includes(sid))?.id ?? 'all');
  const storeName = (sid: string) => (db.prepare('SELECT name FROM stores WHERE id = ?').get(sid) as any)?.name || sid;

  // 1. Connections needing action / stale balances
  const accts: any[] = db.prepare(`
    SELECT a.id, a.store_id, a.institution_name, a.last_four, a.account_type, a.balance_updated_at, a.last_sync_error,
           p.status AS item_status, p.provider_error_code, p.pending_disconnect_at, p.liabilities_status
    FROM bank_accounts a LEFT JOIN plaid_items p ON p.item_id = a.teller_enrollment_id
    WHERE a.status = 'active' AND COALESCE(a.cfo_hidden,0) = 0`).all();
  for (const a of accts) {
    const label = `${a.institution_name} ··${a.last_four}`;
    if (a.item_status && a.item_status !== 'active' || a.provider_error_code || a.pending_disconnect_at) {
      issues.push({ id: `conn:${a.id}`, kind: 'connection', severity: 'high', unitId: storeUnit(a.store_id), title: `${label} needs reconnecting`, detail: a.provider_error_code || a.item_status || 'pending disconnect', count: 1, cents: null, href: '/dashboard/banking', source: 'Plaid' });
    } else {
      const h = hoursSince(a.balance_updated_at, now);
      if (h == null || h > FRESH_HOURS.bank) {
        issues.push({ id: `stale:${a.id}`, kind: 'stale_source', severity: 'medium', unitId: storeUnit(a.store_id), title: `${label} balance is ${h == null ? 'never' : Math.round(h / 24) + 'd'} old`, detail: 'last-known balance is used and labelled stale', count: 1, cents: a.balance_updated_at ? null : null, href: '/dashboard/banking', source: 'Plaid' });
      }
    }
    if (a.account_type === 'credit' && a.liabilities_status && a.liabilities_status !== 'ok' && a.liabilities_status !== 'active') {
      issues.push({ id: `liab:${a.id}`, kind: 'connection', severity: 'low', unitId: storeUnit(a.store_id), title: `${label}: no statement/due-date consent`, detail: `liabilities ${a.liabilities_status} — reconnect to grant`, count: 1, cents: null, href: '/dashboard/credit-cards', source: 'Plaid liabilities' });
    }
  }

  // 2. Charges paired to no store, this period, per account (same rule as the overview)
  const activeIds = accts.map(a => a.id);
  const { charges } = unpairedOutflows(db, activeIds, period);
  const byAcct = new Map<string, { n: number; cents: number; a: any }>();
  for (const c of charges) {
    const cur = byAcct.get(c.bank_account_id) || { n: 0, cents: 0, a: accts.find(x => x.id === c.bank_account_id) };
    cur.n++; cur.cents += -c.amount_cents; byAcct.set(c.bank_account_id, cur);
  }
  for (const [id, u] of [...byAcct.entries()].sort((x, y) => y[1].cents - x[1].cents)) {
    issues.push({ id: `unalloc:${id}`, kind: 'unallocated', severity: u.cents > 100000 ? 'high' : 'medium', unitId: storeUnit(u.a.store_id), title: `${u.n} charges on ${u.a.institution_name} ··${u.a.last_four} paired to no store`, detail: 'nobody is billed for these; they are outside every store P&L', count: u.n, cents: u.cents, href: `/dashboard/transactions?accountId=${id}&store=unattributed`, source: 'categoriser' });
  }

  // 3. Payments in flight overdue (logged 4+ days ago, no bank movement)
  for (const s of db.prepare('SELECT id, name FROM stores').all() as any[]) {
    const f = getPaymentsInFlight(db, s.id, 21);
    const overdue = f.rows.filter(r => r.status === 'not_taken');
    if (overdue.length) issues.push({ id: `inflight:${s.id}`, kind: 'in_flight_overdue', severity: 'medium', unitId: storeUnit(s.id), title: `${s.name}: ${overdue.length} logged payment${overdue.length > 1 ? 's' : ''} never reached the bank`, detail: overdue.map(r => `${r.date} $${(r.amount_cents / 100).toFixed(2)} → ${r.card_last4}`).join(' · '), count: overdue.length, cents: overdue.reduce((x, r) => x + r.amount_cents, 0), href: `/dashboard/cfo?storeId=${s.id}`, source: 'card_payments_log vs bank' });
  }

  // 4. Stores with no P&L rows in the period / provisional profit
  for (const s of db.prepare(`SELECT id, name, platform FROM stores WHERE is_active = 1 AND COALESCE(dashboard_hidden,0) = 0 AND name != 'ShipSourced'`).all() as any[]) {
    const r: any = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(fulfillment_est_cents),0) est FROM daily_pnl WHERE store_id = ? AND date BETWEEN ? AND ?').get(s.id, period.from, period.to);
    if (!r.n) issues.push({ id: `nopnl:${s.id}`, kind: 'missing_pnl', severity: 'medium', unitId: storeUnit(s.id), title: `${s.name}: no P&L rows for this period`, detail: 'the order sync has not written any day in the period', count: 1, cents: null, href: `/dashboard/stores/${s.id}`, source: 'daily_pnl' });
    else if (r.est > 0) issues.push({ id: `est:${s.id}`, kind: 'estimate', severity: 'low', unitId: storeUnit(s.id), title: `${s.name}: fulfilment still estimated`, detail: 'net profit excludes estimated fulfilment until ShipSourced bills it', count: 1, cents: r.est, href: `/dashboard/stores/${s.id}`, source: 'daily_pnl.fulfillment_est_cents' });
    const un: any = db.prepare(`SELECT COUNT(*) n FROM orders WHERE store_id = ? AND fulfillment_status IN ('unfulfilled','partial') AND COALESCE(ss_charge_cents,0) = 0`).get(s.id);
    if (un.n > 0) issues.push({ id: `noest:${s.id}`, kind: 'estimate', severity: 'low', unitId: storeUnit(s.id), title: `${s.name}: ${un.n} unfulfilled orders with no fulfilment estimate`, detail: 'the Position sheet projects these from the recent average', count: un.n, cents: null, href: `/dashboard/cfo?storeId=${s.id}`, source: 'orders' });
  }

  // 5. Meta: payment records stale on an active ad account; token errors
  for (const p of db.prepare(`SELECT p.id, p.store_id, p.profile_name, p.ad_account_id, p.last_sync_at, p.token_expires_at,
      (SELECT MAX(date) FROM ad_payments a WHERE a.account_id = p.ad_account_id) last_payment
      FROM fb_profiles p WHERE p.is_active = 1`).all() as any[]) {
    if (!p.ad_account_id) { issues.push({ id: `fbacct:${p.id}`, kind: 'fb_token', severity: 'medium', unitId: storeUnit(p.store_id), title: `${storeName(p.store_id)}: Facebook profile "${p.profile_name}" has no ad account`, detail: 'its ad payments are never pulled, so its card charges cannot pair', count: 1, cents: null, href: '/dashboard/ads/facebook', source: 'fb_profiles' }); continue; }
    const hp = hoursSince(p.last_payment ? p.last_payment + 'T00:00:00' : null, now);
    if (hp != null && hp > 24 * 30) issues.push({ id: `fbpay:${p.id}`, kind: 'ads_payments_stale', severity: 'low', unitId: storeUnit(p.store_id), title: `${storeName(p.store_id)}: no Meta payments pulled for "${p.profile_name}" since ${p.last_payment}`, detail: 'dormant account, or the token lost ads_read permission', count: 1, cents: null, href: '/dashboard/ads/facebook', source: 'ad_payments' });
  }

  // 6. Manual credit-card rows that duplicate an automatic in-flight payment
  for (const m of db.prepare(`SELECT c.id, c.store_id, c.card_name, c.amount_owed_cents FROM manual_credit_cards c`).all() as any[]) {
    const f = getPaymentsInFlight(db, m.store_id, 21);
    if (f.rows.some(r => r.amount_cents === m.amount_owed_cents)) {
      issues.push({ id: `dup:${m.id}`, kind: 'double_count', severity: 'high', unitId: storeUnit(m.store_id), title: `${storeName(m.store_id)}: manual card row "${m.card_name}" duplicates an in-flight payment`, detail: 'the same amount is now detected automatically — remove the manual row', count: 1, cents: m.amount_owed_cents, href: `/dashboard/cfo?storeId=${m.store_id}`, source: 'manual_credit_cards' });
    }
  }

  // 7. Reconciliation drift + missing snapshots
  for (const s of db.prepare(`SELECT id, name FROM stores WHERE is_active = 1 AND COALESCE(dashboard_hidden,0) = 0`).all() as any[]) {
    const rec: any = db.prepare('SELECT status, residual_cents, period_end FROM cfo_reconciliations WHERE store_id = ? ORDER BY created_at DESC LIMIT 1').get(s.id);
    if (rec && rec.status === 'flagged') issues.push({ id: `drift:${s.id}`, kind: 'recon_drift', severity: 'medium', unitId: storeUnit(s.id), title: `${s.name}: last snapshot does not tie to P&L`, detail: `unexplained $${(Math.abs(rec.residual_cents || 0) / 100).toFixed(2)} to ${rec.period_end}`, count: 1, cents: Math.abs(rec.residual_cents || 0), href: `/dashboard/cfo?storeId=${s.id}&tab=recon`, source: 'cfo_reconciliations' });
    const snap: any = db.prepare('SELECT created_at FROM cfo_snapshots WHERE store_id = ? AND COALESCE(excluded,0)=0 ORDER BY created_at DESC LIMIT 1').get(s.id);
    const hs = hoursSince(snap?.created_at, now);
    if (hs == null) issues.push({ id: `nosnap:${s.id}`, kind: 'no_snapshot', severity: 'low', unitId: storeUnit(s.id), title: `${s.name}: no balance-sheet snapshot saved`, detail: 'net assets unknown until one is saved on Position', count: 1, cents: null, href: `/dashboard/cfo?storeId=${s.id}`, source: 'cfo_snapshots' });
    else if (hs > FRESH_HOURS.snapshot) issues.push({ id: `oldsnap:${s.id}`, kind: 'stale_source', severity: 'low', unitId: storeUnit(s.id), title: `${s.name}: snapshot is ${Math.round(hs / 24)} days old`, detail: 'net assets shown are as of that date', count: 1, cents: null, href: `/dashboard/cfo?storeId=${s.id}`, source: 'cfo_snapshots' });
  }

  // 8. Unresolved mapping decisions
  for (const sc of scopes.filter(s => s.mapping.status === 'unresolved')) {
    for (const [i, d] of sc.mapping.decisions.entries()) {
      issues.push({ id: `map:${sc.id}:${i}`, kind: 'mapping', severity: 'medium', unitId: sc.id, title: `${sc.label}: mapping decision needed`, detail: d, count: 1, cents: null, href: null, source: 'business structure' });
    }
  }

  // 9. ShipSourced Billing Duty flags — their identity and status, never re-keyed
  const feed = await ssFlags().catch((e): SsBillingFlagFeed => ({ available: false, reason: e?.message || String(e) }));
  if (!feed.available) {
    issues.push({ id: 'ss:flags:unavailable', kind: 'source_unavailable', severity: 'medium', unitId: 'ss', title: 'ShipSourced Billing Duty tickets not connected', detail: feed.reason || 'no integration endpoint yet — counts unknown, not zero', count: 0, cents: null, href: null, source: 'ShipSourced' });
  } else {
    for (const f of feed.flags || []) {
      if (f.suppressed) continue;
      issues.push({ id: `ss:flag:${f.ruleKey}:${f.clientId || 'all'}`, kind: 'ss_billing_flag', severity: f.severity === 'critical' ? 'high' : f.severity === 'warning' ? 'medium' : 'low', unitId: 'ss', title: `ShipSourced: ${f.count} ${f.ruleKey.replace(/_/g, ' ')}${f.company ? ` — ${f.company}` : ''}`, detail: `status ${f.status}; amount ${f.amountCents == null ? 'unknown' : '$' + (f.amountCents / 100).toFixed(2)}`, count: f.count, cents: f.amountCents, href: null, source: 'ShipSourced Billing Duty', externalId: `${f.ruleKey}:${f.clientId || ''}`, externalStatus: f.status });
    }
  }

  return issues;
}

export function countByUnit(issues: Issue[], scopes: Scope[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of issues) m.set(i.unitId, (m.get(i.unitId) || 0) + 1);
  // roll store issues up to their groups
  for (const sc of scopes) {
    if (sc.kind === 'group' || sc.id === 'ss') {
      const children = scopes.filter(c => c.parentId === sc.id || (sc.id === 'all' && c.id !== 'all'));
      m.set(sc.id, (m.get(sc.id) || 0) + children.reduce((s, c) => s + (i => i)(m.get(c.id) || 0), 0));
    }
  }
  return m;
}

/** Issues that belong to a scope: its own plus its descendants'. */
export function issuesForScope(issues: Issue[], scope: Scope, scopes: Scope[]): Issue[] {
  const ids = new Set<string>([scope.id]);
  let grew = true;
  while (grew) { grew = false; for (const s of scopes) if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); grew = true; } }
  if (scope.id === 'all') ids.add('all');
  return issues.filter(i => ids.has(i.unitId));
}
