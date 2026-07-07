/**
 * Cashflow projection engine
 * ==========================
 * Answers: "how much money lands on which date, per store and overall, and what do I
 * owe on cards?" — so card payments can be planned against real incoming cash.
 *
 * Three confidence tiers, never mixed silently:
 *   in_transit — payout marked paid in the store's payouts export with NO bank landing
 *                yet: money is on the rail, lands at payout_date + measured lag.
 *   scheduled  — payout Shopify has already scheduled (from the export), lands at
 *                payout_date + measured lag.
 *   forecast   — estimated future payouts from recent daily net revenue (P&L), for
 *                dates beyond what the export covers. Clearly labeled an estimate.
 *
 * Landing lag is MEASURED per store by matching paid payouts to bank-statement deposits
 * (same amount, deposit date within payout_date..+7d); median lag, default 2 days.
 * Evidence rows come from cfo_evidence (deduped at upload), so nothing double counts.
 */

import type BetterSqlite3 from 'better-sqlite3';

type DB = BetterSqlite3.Database;

export interface CashEvent {
  date: string;              // expected landing date YYYY-MM-DD
  kind: 'in_transit' | 'scheduled' | 'forecast';
  amount_cents: number;
  store_id: string;
  store_name: string;
  source: string;            // human trace, e.g. "payout 2026-07-06 ref 1051484107741"
}

export interface StoreCashflow {
  store_id: string;
  store_name: string;
  has_evidence: boolean;
  landing_lag_days: number | null;   // measured median payout→bank lag
  matched_payouts: number;           // how many payout→bank pairs the lag is based on
  in_transit_cents: number;
  scheduled_cents: number;
  forecast_cents: number;
  reserves_held_cents: number;       // Shopify holdbacks not yet released
  avg_daily_net_revenue_cents: number; // basis of the forecast (last 14d revenue − fees)
  avg_daily_ad_burn_cents: number;     // last 7d ad spend accrual
  cards: { card_name: string; owed_cents: number }[];
  events: CashEvent[];
  notes: string[];
}

export interface CashflowProjection {
  generated_at_date: string;
  horizon_days: number;
  stores: StoreCashflow[];
  calendar: { date: string; confirmed_cents: number; forecast_cents: number; cumulative_cents: number; events: CashEvent[] }[];
  totals: {
    in_transit_cents: number;
    scheduled_cents: number;
    forecast_cents: number;
    reserves_held_cents: number;
    cards_owed_cents: number;
  };
  data_gaps: string[];
}

const DAY_MS = 86_400_000;

function toDate(s: string): number { return new Date(s.slice(0, 10) + 'T00:00:00Z').getTime(); }
function fmtDate(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
function addDays(dateStr: string, n: number): string { return fmtDate(toDate(dateStr) + n * DAY_MS); }
function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return d === 0 || d === 6;
}
/** Roll weekend landings forward to Monday (banks don't settle on weekends). */
function rollToBusinessDay(dateStr: string): string {
  let s = dateStr;
  while (isWeekend(s)) s = addDays(s, 1);
  return s;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Load every deduped evidence row of a kind for a store, across all uploads. */
function evidenceRows(db: DB, storeId: string, kinds: string[]): any[] {
  const placeholders = kinds.map(() => '?').join(',');
  const uploads: any[] = db.prepare(
    `SELECT rows_json FROM cfo_evidence WHERE store_id = ? AND kind IN (${placeholders})`
  ).all(storeId, ...kinds);
  const rows: any[] = [];
  for (const u of uploads) {
    try { rows.push(...(JSON.parse(u.rows_json) || [])); } catch { /* skip corrupt */ }
  }
  return rows;
}

export function buildCashflowProjection(db: DB, storeIdFilter?: string, horizonDays = 14): CashflowProjection {
  const today = fmtDate(Date.now() - (Date.now() % DAY_MS));
  const dataGaps: string[] = [];

  const stores: any[] = db.prepare(
    `SELECT id, name FROM stores WHERE platform = 'shopify' ${storeIdFilter ? 'AND id = ?' : ''} ORDER BY name`
  ).all(...(storeIdFilter ? [storeIdFilter] : []));

  const storeResults: StoreCashflow[] = [];

  for (const store of stores) {
    const notes: string[] = [];
    const payoutRows = evidenceRows(db, store.id, ['shopify_payouts']);
    const bankRows = evidenceRows(db, store.id, ['bank_statement']);
    const hasEvidence = payoutRows.length > 0;

    // ── Measure landing lag: match paid payouts to bank deposits (amount + date window) ──
    const bankDeposits = bankRows
      .filter(r => (r.amount_cents ?? 0) > 0)
      .map(r => ({ date: r.date as string, amount: r.amount_cents as number, used: false }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const lags: number[] = [];
    const paidPayouts = payoutRows
      .filter(r => /paid/i.test(r.payout_status || '') && r.amount_cents != null && (r.payout_date || r.date))
      .map(r => ({ ...r, pdate: (r.payout_date || r.date) as string }))
      .sort((a, b) => (a.pdate < b.pdate ? -1 : 1));

    for (const p of paidPayouts) {
      const hit = bankDeposits.find(d => !d.used && d.amount === p.amount_cents && d.date >= p.pdate && toDate(d.date) - toDate(p.pdate) <= 7 * DAY_MS);
      if (hit) {
        hit.used = true;
        (p as any).landed = hit.date;
        lags.push(Math.round((toDate(hit.date) - toDate(p.pdate)) / DAY_MS));
      }
    }
    const lag = median(lags) ?? 2;
    if (hasEvidence && lags.length === 0 && bankRows.length > 0) {
      notes.push('No payout↔bank matches found — landing lag defaulted to 2 days.');
    }

    const events: CashEvent[] = [];

    // ── In-transit: paid, never landed, recent enough to still be on the rail ──
    let inTransit = 0;
    for (const p of paidPayouts) {
      if ((p as any).landed) continue;
      if (toDate(p.pdate) < toDate(today) - 10 * DAY_MS) continue; // stale unmatched = bank export just doesn't cover it
      const land = rollToBusinessDay(addDays(p.pdate, lag));
      inTransit += p.amount_cents;
      events.push({
        date: land < today ? today : land, kind: 'in_transit', amount_cents: p.amount_cents,
        store_id: store.id, store_name: store.name,
        source: `payout ${p.pdate}${p.reference ? ` ref ${p.reference}` : ''} (sent, not landed)`,
      });
    }

    // ── Scheduled: Shopify has queued it; lands payout_date + lag ──
    let scheduled = 0;
    let lastKnownPayoutDate = today;
    const summaryPayoutDates = new Set<string>();
    for (const r of payoutRows) {
      const pdate = (r.payout_date || r.date) as string | null;
      if (!pdate) continue;
      if (pdate > lastKnownPayoutDate) lastKnownPayoutDate = pdate;
      summaryPayoutDates.add(pdate);
      if (!/sched|transit/i.test(r.payout_status || '')) continue;
      if (r.amount_cents == null || pdate < today) continue;
      const land = rollToBusinessDay(addDays(pdate, lag));
      scheduled += r.amount_cents;
      events.push({
        date: land, kind: 'scheduled', amount_cents: r.amount_cents,
        store_id: store.id, store_name: store.name,
        source: `scheduled payout ${pdate}`,
      });
    }

    // ── Pending transactions: the per-transaction export stamps every pending charge with
    // its exact future Payout Date — sales already made are CONFIRMED payouts, not forecast.
    // Group pending rows by payout_date; skip dates the payouts summary already covers.
    const txRows = evidenceRows(db, store.id, ['shopify_payments']);
    const pendingByPayout = new Map<string, number>();
    for (const r of txRows) {
      if (!/pending/i.test(r.payout_status || '')) continue;
      if (!r.payout_date || r.net_cents == null) continue;
      pendingByPayout.set(r.payout_date, (pendingByPayout.get(r.payout_date) || 0) + r.net_cents);
    }
    for (const [pdate, net] of [...pendingByPayout.entries()].sort()) {
      if (pdate > lastKnownPayoutDate) lastKnownPayoutDate = pdate;
      if (summaryPayoutDates.has(pdate) && /sched|transit/i.test(payoutRows.find(r => (r.payout_date || r.date) === pdate)?.payout_status || '')) continue; // summary already carries this payout
      if (pdate < today || net <= 0) continue;
      const land = rollToBusinessDay(addDays(pdate, lag));
      scheduled += net;
      events.push({
        date: land, kind: 'scheduled', amount_cents: net,
        store_id: store.id, store_name: store.name,
        source: `pending charges → payout ${pdate} (per-transaction export)`,
      });
    }

    // ── Reserves currently held (withholdings minus releases across the export) ──
    let reservesHeld = 0;
    for (const r of payoutRows) {
      const rf = r.money?.['Reserved Funds'];
      if (typeof rf === 'number') reservesHeld -= rf; // withhold is negative → adds to held
    }
    if (reservesHeld < 0) reservesHeld = 0;

    // ── Forecast: average daily net revenue continues; payouts initiate on business days ──
    const pnl: any = db.prepare(
      `SELECT COALESCE(SUM(revenue_cents - shopify_fees_cents),0) AS net, COUNT(*) AS days
       FROM daily_pnl WHERE store_id = ? AND date >= ? AND date < ? AND revenue_cents > 0`
    ).get(store.id, addDays(today, -14), today);
    const avgDailyNet = pnl.days > 0 ? Math.round(pnl.net / pnl.days) : 0;

    const adPnl: any = db.prepare(
      `SELECT COALESCE(SUM(ad_spend_cents),0) AS ad, COUNT(*) AS days
       FROM daily_pnl WHERE store_id = ? AND date >= ? AND date < ? AND ad_spend_cents > 0`
    ).get(store.id, addDays(today, -7), today);
    const avgDailyAd = adPnl.days > 0 ? Math.round(adPnl.ad / adPnl.days) : 0;

    let forecast = 0;
    if (avgDailyNet > 0) {
      // start after the last payout date the export already covers, so nothing double counts
      let d = addDays(lastKnownPayoutDate, 1);
      const end = addDays(today, horizonDays);
      while (d <= end) {
        if (!isWeekend(d)) {
          const land = rollToBusinessDay(addDays(d, lag));
          if (land <= end) {
            forecast += avgDailyNet;
            events.push({
              date: land, kind: 'forecast', amount_cents: avgDailyNet,
              store_id: store.id, store_name: store.name,
              source: `est. payout initiated ${d} (avg daily net revenue)`,
            });
          }
        }
        d = addDays(d, 1);
      }
    }

    if (!hasEvidence) {
      if (avgDailyNet > 0) dataGaps.push(`${store.name}: no payouts/bank exports uploaded — dates are pure forecast. Upload via Bulk Upload for exact landing dates.`);
      notes.push('No evidence uploaded; projection is P&L-based estimate only.');
    }

    const cards: any[] = db.prepare(
      'SELECT card_name, amount_owed_cents FROM manual_credit_cards WHERE store_id = ?'
    ).all(store.id);

    const sc: StoreCashflow = {
      store_id: store.id,
      store_name: store.name,
      has_evidence: hasEvidence,
      landing_lag_days: lags.length ? lag : null,
      matched_payouts: lags.length,
      in_transit_cents: inTransit,
      scheduled_cents: scheduled,
      forecast_cents: forecast,
      reserves_held_cents: reservesHeld,
      avg_daily_net_revenue_cents: avgDailyNet,
      avg_daily_ad_burn_cents: avgDailyAd,
      cards: cards.map(c => ({ card_name: c.card_name, owed_cents: c.amount_owed_cents })),
      events,
      notes,
    };
    // skip dead stores with nothing to show
    if (hasEvidence || avgDailyNet > 0 || cards.length > 0) storeResults.push(sc);
  }

  // ── Merge into a per-date calendar ──
  const allEvents = storeResults.flatMap(s => s.events);
  const calendar: CashflowProjection['calendar'] = [];
  let cumulative = 0;
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(today, i);
    const dayEvents = allEvents.filter(e => e.date === date).sort((a, b) => b.amount_cents - a.amount_cents);
    const confirmed = dayEvents.filter(e => e.kind !== 'forecast').reduce((s, e) => s + e.amount_cents, 0);
    const fc = dayEvents.filter(e => e.kind === 'forecast').reduce((s, e) => s + e.amount_cents, 0);
    cumulative += confirmed + fc;
    calendar.push({ date, confirmed_cents: confirmed, forecast_cents: fc, cumulative_cents: cumulative, events: dayEvents });
  }

  return {
    generated_at_date: today,
    horizon_days: horizonDays,
    stores: storeResults,
    calendar,
    totals: {
      in_transit_cents: storeResults.reduce((s, x) => s + x.in_transit_cents, 0),
      scheduled_cents: storeResults.reduce((s, x) => s + x.scheduled_cents, 0),
      forecast_cents: storeResults.reduce((s, x) => s + x.forecast_cents, 0),
      reserves_held_cents: storeResults.reduce((s, x) => s + x.reserves_held_cents, 0),
      cards_owed_cents: storeResults.reduce((s, x) => s + x.cards.reduce((c, y) => c + y.owed_cents, 0), 0),
    },
    data_gaps: dataGaps,
  };
}
