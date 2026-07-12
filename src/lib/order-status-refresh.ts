// Fulfillment-status refresh against ShipSourced (source of truth).
//
// The order sync only INSERTS new orders — an order imported as 'unfulfilled'
// was never updated when it shipped, so statuses rot and the CFO "Unfulfilled
// Orders Est. Fulfillment Bill" counts long-shipped orders. This pass fixes
// that cheaply: instead of re-reading every order, it fetches ShipSourced's
// CURRENTLY-OPEN orders per client (a small set) plus recent cancellations,
// and reconciles local statuses both ways.
//
// Identity is number+date (ssOrderKey): order numbers alone collide across
// store migrations — Purebite's new SHIPHERO numbering restarted below the
// old csv-import numbers.

import type Database from 'better-sqlite3';
import { getClientOrdersList, normalizeSSOrderNumber, ssOrderDatePacific, ssOrderKey } from '@/lib/shipsourced';

// Every ShipSourced status that means "not shipped yet"
const OPEN_STATUSES = ['NEW', 'PENDING', 'ON_HOLD', 'PICKED', 'PROCESSING', 'LABELED', 'ESCALATION'];
const MAX_PAGES_PER_STATUS = 10; // 200/page — a client with >2000 open orders is a data problem, not a paging one

// Local fulfillment_status values that mean "not shipped yet". Beyond
// unfulfilled/partial, the importer historically wrote lowercased SS statuses
// (escalation, on_hold, labeled…) which the CFO query can't see — treat them
// as open and normalize them to 'unfulfilled' when SS confirms they're open.
const LOCAL_OPEN_STATUSES = new Set([
  'unfulfilled', 'partial', 'new', 'pending', 'on_hold', 'picked', 'processing', 'labeled', 'escalation',
]);

// Per store per run: bounded individual lookups for orders SS's bulk sets
// can't classify (csv/shopify imports that are neither open nor cancelled)
const MAX_SEARCH_LOOKUPS = 40;

async function fetchOrderKeysByStatus(clientId: string, status: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let page = 1; page <= MAX_PAGES_PER_STATUS; page++) {
    const data = await getClientOrdersList(clientId, page, 200, status);
    for (const o of data.orders || []) {
      const n = normalizeSSOrderNumber(o.externalOrderId || '');
      if (n) keys.add(ssOrderKey(n, ssOrderDatePacific(o)));
    }
    if (!data.orders || data.orders.length < 200) break;
  }
  return keys;
}

/** Refresh fulfillment statuses for one store against ShipSourced, both ways:
 *  - locally open but closed in SS → fulfilled/cancelled (over-count fix)
 *  - locally closed or variant-status but open in SS → unfulfilled (under-count fix)
 *  - non-shipsourced-source leftovers → individual search lookups, capped   */
export async function refreshOrderStatuses(db: Database.Database, storeId: string, clientId: string): Promise<{ checked: number; fulfilled: number; cancelled: number; reopened: number }> {
  const localAll: any[] = db.prepare(
    `SELECT order_number, order_date, fulfillment_status, source FROM orders WHERE store_id = ?`
  ).all(storeId);
  if (localAll.length === 0) return { checked: 0, fulfilled: 0, cancelled: 0, reopened: 0 };
  const isOpen = (s: string) => LOCAL_OPEN_STATUSES.has(s);
  const localOpen = localAll.filter(r => isOpen(String(r.fulfillment_status)));

  const ssOpen = new Set<string>();
  for (const status of OPEN_STATUSES) {
    const s = await fetchOrderKeysByStatus(clientId, status);
    s.forEach(k => ssOpen.add(k));
  }
  const ssCancelled = await fetchOrderKeysByStatus(clientId, 'CANCELLED');

  let fulfilled = 0, cancelled = 0, reopened = 0;
  const setStatus = db.prepare(
    'UPDATE orders SET fulfillment_status = ? WHERE store_id = ? AND order_number = ? AND order_date = ?'
  );

  // Pass A — locally open orders that SS says are done (or that SS confirms
  // open but sit under a variant status the CFO query can't see)
  const needLookup: { n: string; d: string }[] = [];
  for (const row of localOpen) {
    const n = String(row.order_number);
    const d = String(row.order_date || '');
    const key = ssOrderKey(n, d);
    const st = String(row.fulfillment_status);
    if (ssOpen.has(key)) {
      // genuinely still open — normalize variant statuses so CFO counts them
      if (st !== 'unfulfilled' && st !== 'partial') { setStatus.run('unfulfilled', storeId, n, d); reopened++; }
      continue;
    }
    if (ssCancelled.has(key)) { setStatus.run('cancelled', storeId, n, d); cancelled++; continue; }
    if (row.source === 'shipsourced') { setStatus.run('fulfilled', storeId, n, d); fulfilled++; continue; }
    // csv/shopify import — SS may simply not know this order; verify individually
    needLookup.push({ n, d });
  }

  // Pass B — bounded per-order lookups for import-sourced leftovers.
  // A match must agree on BOTH number and date, else it's a different order.
  for (const { n, d } of needLookup.slice(0, MAX_SEARCH_LOOKUPS)) {
    try {
      const data = await getClientOrdersList(clientId, 1, 50, undefined, n);
      const match = (data.orders || []).find(o =>
        normalizeSSOrderNumber(o.externalOrderId || '') === n && ssOrderDatePacific(o) === d
      );
      if (!match) continue; // SS never saw it — leave alone
      if (match.status === 'SHIPPED') { setStatus.run('fulfilled', storeId, n, d); fulfilled++; }
      else if (match.status === 'CANCELLED') { setStatus.run('cancelled', storeId, n, d); cancelled++; }
    } catch { /* transient — retry next run */ }
  }

  // Pass C — locally closed orders that SS says are still open (under-count)
  for (const row of localAll) {
    const st = String(row.fulfillment_status);
    if (isOpen(st) || st === 'cancelled') continue; // open handled above; don't resurrect cancellations
    const n = String(row.order_number);
    const d = String(row.order_date || '');
    if (ssOpen.has(ssOrderKey(n, d))) { setStatus.run('unfulfilled', storeId, n, d); reopened++; }
  }

  return { checked: localOpen.length, fulfilled, cancelled, reopened };
}

/** Refresh every store that has a ShipSourced client id. */
export async function refreshAllOrderStatuses(db: Database.Database): Promise<{ stores: number; fulfilled: number; cancelled: number; reopened: number; errors: string[] }> {
  const stores: any[] = db.prepare(
    "SELECT id, name, shipsourced_client_id FROM stores WHERE shipsourced_client_id IS NOT NULL AND shipsourced_client_id != ''"
  ).all();

  let fulfilled = 0, cancelled = 0, reopened = 0;
  const errors: string[] = [];
  for (const s of stores) {
    try {
      const r = await refreshOrderStatuses(db, s.id, s.shipsourced_client_id);
      fulfilled += r.fulfilled; cancelled += r.cancelled; reopened += r.reopened;
      if (r.fulfilled || r.cancelled || r.reopened) {
        console.log(`[status-refresh] ${s.name}: ${r.checked} open locally → ${r.fulfilled} fulfilled, ${r.cancelled} cancelled, ${r.reopened} reopened`);
      }
    } catch (e: any) {
      errors.push(`${s.name}: ${String(e?.message || e).slice(0, 150)}`);
    }
  }
  return { stores: stores.length, fulfilled, cancelled, reopened, errors };
}
