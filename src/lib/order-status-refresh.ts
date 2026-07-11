// Fulfillment-status refresh against ShipSourced (source of truth).
//
// The order sync only INSERTS new orders — an order imported as 'unfulfilled'
// was never updated when it shipped, so statuses rot and the CFO "Unfulfilled
// Orders Est. Fulfillment Bill" counts long-shipped orders. This pass fixes
// that cheaply: instead of re-reading every order, it fetches ShipSourced's
// CURRENTLY-OPEN orders per client (a small set) plus recent cancellations,
// and flips any local open order that no longer appears there.

import type Database from 'better-sqlite3';
import { getClientOrdersList } from '@/lib/shipsourced';

// Every ShipSourced status that means "not shipped yet"
const OPEN_STATUSES = ['NEW', 'PENDING', 'ON_HOLD', 'PICKED', 'PROCESSING', 'LABELED', 'ESCALATION'];
const MAX_PAGES_PER_STATUS = 10; // 200/page — a client with >2000 open orders is a data problem, not a paging one

function normalizeOrderNumber(externalOrderId: string): string {
  const raw = externalOrderId || '';
  const hashIdx = raw.lastIndexOf('#');
  const n = hashIdx >= 0 ? raw.slice(hashIdx + 1) : raw;
  return n.replace(/^(SHIPHERO-|SH-)?/, '').trim();
}

async function fetchOrderNumbersByStatus(clientId: string, status: string): Promise<Set<string>> {
  const numbers = new Set<string>();
  for (let page = 1; page <= MAX_PAGES_PER_STATUS; page++) {
    const data = await getClientOrdersList(clientId, page, 200, status);
    for (const o of data.orders || []) {
      const n = normalizeOrderNumber(o.externalOrderId || '');
      if (n) numbers.add(n);
    }
    if (!data.orders || data.orders.length < 200) break;
  }
  return numbers;
}

/** Refresh statuses of locally-open shipsourced orders for one store.
 *  Returns counts of flips made. */
export async function refreshOrderStatuses(db: Database.Database, storeId: string, clientId: string): Promise<{ checked: number; fulfilled: number; cancelled: number }> {
  const localOpen: any[] = db.prepare(
    `SELECT order_number FROM orders
     WHERE store_id = ? AND source = 'shipsourced' AND fulfillment_status IN ('unfulfilled', 'partial')`
  ).all(storeId);
  if (localOpen.length === 0) return { checked: 0, fulfilled: 0, cancelled: 0 };

  const ssOpen = new Set<string>();
  for (const status of OPEN_STATUSES) {
    const s = await fetchOrderNumbersByStatus(clientId, status);
    s.forEach(n => ssOpen.add(n));
  }
  const ssCancelled = await fetchOrderNumbersByStatus(clientId, 'CANCELLED');

  let fulfilled = 0, cancelled = 0;
  const markFulfilled = db.prepare(
    "UPDATE orders SET fulfillment_status = 'fulfilled' WHERE store_id = ? AND order_number = ?"
  );
  const markCancelled = db.prepare(
    "UPDATE orders SET fulfillment_status = 'cancelled' WHERE store_id = ? AND order_number = ?"
  );

  for (const row of localOpen) {
    const n = String(row.order_number);
    if (ssOpen.has(n)) continue; // genuinely still open
    if (ssCancelled.has(n)) { markCancelled.run(storeId, n); cancelled++; }
    else { markFulfilled.run(storeId, n); fulfilled++; }
  }

  return { checked: localOpen.length, fulfilled, cancelled };
}

/** Refresh every store that has a ShipSourced client id. */
export async function refreshAllOrderStatuses(db: Database.Database): Promise<{ stores: number; fulfilled: number; cancelled: number; errors: string[] }> {
  const stores: any[] = db.prepare(
    "SELECT id, name, shipsourced_client_id FROM stores WHERE shipsourced_client_id IS NOT NULL AND shipsourced_client_id != ''"
  ).all();

  let fulfilled = 0, cancelled = 0;
  const errors: string[] = [];
  for (const s of stores) {
    try {
      const r = await refreshOrderStatuses(db, s.id, s.shipsourced_client_id);
      fulfilled += r.fulfilled; cancelled += r.cancelled;
      if (r.fulfilled || r.cancelled) {
        console.log(`[status-refresh] ${s.name}: ${r.checked} open locally → ${r.fulfilled} fulfilled, ${r.cancelled} cancelled`);
      }
    } catch (e: any) {
      errors.push(`${s.name}: ${String(e?.message || e).slice(0, 150)}`);
    }
  }
  return { stores: stores.length, fulfilled, cancelled, errors };
}
