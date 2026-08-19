// ── Incoming cash — the authoritative payout-pipeline facts ──────────────────
// Single source for "money on its way to the banks": Shopify balances,
// reserves, the payout schedule, and confirmed landings. Consumed by the
// Brain's Incoming Cash tab AND the forward-cash engine — one implementation.

import type DatabaseType from 'better-sqlite3';

export interface IncomingCash {
  shopifyBalances: any[];
  reserves: any[];
  upcoming: { store: string; date: string; cents: number; status: string }[];
  landed: any[];
  stores: any[];
  totals: { atShopifyCents: number; reservesCents: number; upcoming7Cents: number; landed7Cents: number };
  /** avg daily landed over the last 7d — the payout run-rate used to forecast
   *  beyond the known schedule (label: forecast, never committed) */
  landedDailyAvgCents: number;
}

/** Business dates are Pacific — UTC "today" skews the schedule by a day
 *  every evening (found in audit 2026-08-19). */
function pacificToday(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86400000));
}

export function getIncomingCash(db: DatabaseType.Database): IncomingCash {
  const shopifyBalances: any[] = db.prepare(`
    SELECT a.id, a.account_name, s.name AS store_name,
           COALESCE(a.balance_available_cents, a.balance_ledger_cents, 0) AS available_cents,
           a.balance_updated_at
    FROM bank_accounts a LEFT JOIN stores s ON s.id = a.store_id
    WHERE a.status = 'active' AND a.institution_name LIKE '%Shopify%'
    ORDER BY available_cents DESC
  `).all();
  const reserves: any[] = db.prepare(`
    SELECT s.name AS store_name, SUM(r.amount_cents) AS cents
    FROM reserves r JOIN stores s ON s.id = r.store_id
    GROUP BY r.store_id HAVING cents > 0 ORDER BY cents DESC
  `).all();

  const today = pacificToday();
  const horizon = pacificToday(14);
  const upcoming: any[] = [];
  const seen = new Set<string>();
  const evRows: any[] = db.prepare(`
    SELECT e.store_id, s.name AS store_name, e.rows_json
    FROM cfo_evidence e JOIN stores s ON s.id = e.store_id WHERE e.kind = 'shopify_payouts'
  `).all();
  for (const ev of evRows) {
    let rows: any[] = [];
    try { rows = JSON.parse(ev.rows_json || '[]'); } catch { continue; }
    for (const r of rows) {
      const date = r.payout_date || r.date;
      const cents = r.net_cents ?? r.amount_cents;
      if (!date || !cents) continue;
      const status = r.payout_status || 'scheduled';
      if (!(date >= today && date <= horizon) && !(status !== 'paid' && date >= pacificToday(-3))) continue;
      const k = `${ev.store_id}|${r.reference || ''}|${date}|${cents}`;
      if (seen.has(k)) continue;
      seen.add(k);
      upcoming.push({ store: ev.store_name, date, cents, status });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || b.cents - a.cents);

  const landed: any[] = db.prepare(`
    SELECT t.date, s.name AS store_name, SUM(t.amount_cents) AS cents
    FROM bank_transactions t
    JOIN txn_links l ON l.txn_id = t.id AND l.class = 'shopify_payout'
    LEFT JOIN stores s ON s.id = l.store_id
    WHERE t.amount_cents > 0 AND t.status = 'posted' AND t.date >= date('now', '-7 days')
    GROUP BY t.date, l.store_id ORDER BY t.date DESC
  `).all();

  const in7 = pacificToday(7);
  const perStore = new Map<string, any>();
  const row = (store: string) => {
    if (!perStore.has(store)) perStore.set(store, { store, atShopifyCents: 0, reservedCents: 0, upcoming7Cents: 0, landed7Cents: 0, nextPayout: null });
    return perStore.get(store);
  };
  for (const b of shopifyBalances) row(b.store_name || b.account_name).atShopifyCents += b.available_cents;
  for (const r of reserves) row(r.store_name).reservedCents += r.cents;
  for (const u of upcoming) {
    const s = row(u.store);
    if (u.date <= in7 && u.status !== 'paid') s.upcoming7Cents += u.cents;
    if (!s.nextPayout || u.date < s.nextPayout.date) s.nextPayout = { date: u.date, cents: u.cents, status: u.status };
  }
  for (const l of landed) if (l.store_name) row(l.store_name).landed7Cents += l.cents;
  const stores = [...perStore.values()]
    .map(s => ({ ...s, totalIncomingCents: s.atShopifyCents + s.reservedCents + s.upcoming7Cents }))
    .sort((a, b) => b.totalIncomingCents - a.totalIncomingCents);

  const landed7 = landed.reduce((s, l) => s + l.cents, 0);
  return {
    shopifyBalances, reserves, upcoming, landed, stores,
    totals: {
      atShopifyCents: shopifyBalances.reduce((s, b) => s + b.available_cents, 0),
      reservesCents: reserves.reduce((s, r) => s + r.cents, 0),
      upcoming7Cents: upcoming.filter(u => u.date <= in7 && u.status !== 'paid').reduce((s, u) => s + u.cents, 0),
      landed7Cents: landed7,
    },
    landedDailyAvgCents: Math.round(landed7 / 7),
  };
}
