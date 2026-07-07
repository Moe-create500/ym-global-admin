/**
 * Cashflow projection engine
 * ==========================
 * Answers: "how much money lands on which date, per store and overall, and what do I
 * owe on cards?" — so card payments can be planned against real incoming cash.
 *
 * Two tiers, both straight from the exports — nothing is estimated:
 *   in_transit — payout marked paid in the store's payouts export with NO bank landing
 *                yet: money is on the rail, lands at payout_date + measured lag.
 *   scheduled  — a payout date Shopify has already committed: scheduled rows in the
 *                payouts summary, plus pending charges in the per-transaction export
 *                grouped by their stamped Payout Date (with charge/refund/chargeback/
 *                reserve composition per payout).
 *
 * Landing lag is MEASURED per store by matching paid payouts to bank-statement deposits
 * (same amount, deposit date within payout_date..+7d); median lag, default 2 days.
 * Evidence rows come from cfo_evidence (deduped at upload), so nothing double counts.
 */

import type BetterSqlite3 from 'better-sqlite3';

type DB = BetterSqlite3.Database;

export interface CashEvent {
  date: string;              // expected landing date YYYY-MM-DD
  kind: 'in_transit' | 'scheduled';
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
  reserves_held_cents: number;       // Shopify holdbacks not yet released
  refunds_30d_cents: number;         // refunds in the last 30 days (per-transaction export)
  chargebacks_30d_cents: number;     // chargebacks + fees in the last 30 days
  avg_daily_ad_burn_cents: number;   // last 7d ad spend accrual
  last_export_payout_date: string | null; // exports know nothing past this — re-upload to extend
  cards: { card_name: string; owed_cents: number }[];
  events: CashEvent[];
  notes: string[];
}

export interface CashflowProjection {
  generated_at_date: string;
  horizon_days: number;
  stores: StoreCashflow[];
  calendar: { date: string; confirmed_cents: number; cumulative_cents: number; events: CashEvent[] }[];
  totals: {
    in_transit_cents: number;
    scheduled_cents: number;
    reserves_held_cents: number;
    refunds_30d_cents: number;
    chargebacks_30d_cents: number;
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Business "today" in the store's timezone (Pacific) — pure UTC would flip to tomorrow
 *  from 5pm PDT onward and hide the current day's landings from an evening user. */
function todayPacific(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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
  const today = todayPacific();
  const horizonEnd = addDays(today, horizonDays);
  const dataGaps: string[] = [];

  const stores: any[] = db.prepare(
    `SELECT id, name FROM stores WHERE platform = 'shopify' ${storeIdFilter ? 'AND id = ?' : ''} ORDER BY name`
  ).all(...(storeIdFilter ? [storeIdFilter] : []));

  const storeResults: StoreCashflow[] = [];

  for (const store of stores) {
    const notes: string[] = [];
    const payoutRows = evidenceRows(db, store.id, ['shopify_payouts']);
    const bankRows = evidenceRows(db, store.id, ['bank_statement']);
    const txRows = evidenceRows(db, store.id, ['shopify_payments']);
    const hasEvidence = payoutRows.length > 0 || txRows.length > 0;

    // ── Measure landing lag: match paid payouts to bank rows (amount + nearest date) ──
    // Positive payouts match deposits; negative (refund-heavy) payouts match withdrawals.
    // Window [pdate−1, pdate+7] tolerates timezone off-by-one; nearest-date-first pairing
    // prevents an older same-amount payout from stealing a newer payout's landing.
    const bankMovements = bankRows
      .filter(r => (r.amount_cents ?? 0) !== 0 && ISO_DATE.test(r.date || ''))
      .map(r => ({ date: r.date as string, amount: r.amount_cents as number, used: false }));
    const bankMaxDate = bankMovements.reduce((m, d) => (d.date > m ? d.date : m), '');

    const lags: number[] = [];
    const paidPayouts = payoutRows
      .filter(r => /paid/i.test(r.payout_status || '') && r.amount_cents != null && ISO_DATE.test((r.payout_date || r.date) || ''))
      .map(r => ({ ...r, pdate: (r.payout_date || r.date) as string }))
      .sort((a, b) => (a.pdate < b.pdate ? -1 : 1));

    for (const p of paidPayouts) {
      const candidates = bankMovements.filter(d =>
        !d.used && d.amount === p.amount_cents &&
        toDate(d.date) - toDate(p.pdate) >= -1 * DAY_MS && toDate(d.date) - toDate(p.pdate) <= 7 * DAY_MS
      );
      if (candidates.length) {
        const hit = candidates.reduce((best, d) => Math.abs(toDate(d.date) - toDate(p.pdate)) < Math.abs(toDate(best.date) - toDate(p.pdate)) ? d : best);
        hit.used = true;
        (p as any).landed = hit.date;
        lags.push(Math.max(0, Math.round((toDate(hit.date) - toDate(p.pdate)) / DAY_MS)));
      }
    }
    const lag = median(lags) ?? 2;
    if (hasEvidence && lags.length === 0 && bankRows.length > 0) {
      notes.push('No payout↔bank matches found — landing lag defaulted to 2 days.');
    }

    const events: CashEvent[] = [];

    // ── In-transit: paid, never landed, recent enough to still be on the rail.
    // If the bank export DOES cover the expected landing window and there's still no
    // match, that is potentially missing money — the one thing this engine must flag.
    let inTransit = 0;
    for (const p of paidPayouts) {
      if ((p as any).landed) continue;
      const expectedLand = rollToBusinessDay(addDays(p.pdate, lag));
      if (bankMaxDate && bankMaxDate >= addDays(expectedLand, 2)) {
        dataGaps.push(`${store.name}: payout ${p.pdate}${p.reference ? ` ref ${p.reference}` : ''} of $${(p.amount_cents / 100).toFixed(2)} is marked PAID but has no matching bank landing even though the bank export covers that period — verify with Shopify/bank.`);
        continue; // not on the rail — it's missing until proven otherwise
      }
      if (toDate(p.pdate) < toDate(today) - 10 * DAY_MS) continue; // stale unmatched = bank export just doesn't cover it
      inTransit += p.amount_cents;
      events.push({
        date: expectedLand < today ? today : expectedLand, kind: 'in_transit', amount_cents: p.amount_cents,
        store_id: store.id, store_name: store.name,
        source: `payout ${p.pdate}${p.reference ? ` ref ${p.reference}` : ''} (sent, not landed)`,
      });
    }
    const paidPayoutDates = new Set(paidPayouts.map(p => p.pdate));

    // ── Upcoming payouts. PRIMARY source: the per-transaction export — every not-yet-paid
    // row (status scheduled OR pending) carries its Payout Date, and grouping by that date
    // naturally handles multiple payouts on the same day (e.g. a regular payout AND a
    // reserve-release payout both on Jul 7). The payouts summary only fills dates the
    // transaction export has no rows for. Composition per landing: charges / refunds /
    // chargebacks / reserves.
    let scheduled = 0;
    let beyondHorizon = 0;
    let lastKnownPayoutDate = today;
    let unassignedPending = 0;
    let failedTotal = 0;
    const txByPayout = new Map<string, { net: number; charges: number; nCharges: number; refunds: number; nRefunds: number; chargebacks: number; nChargebacks: number; reserved: number; other: number; committed: number; estimated: number }>();
    for (const r of txRows) {
      const status = (r.payout_status || '').toLowerCase();
      if (/fail/.test(status)) { failedTotal += r.net_cents ?? 0; continue; }
      if (!/pending|sched|transit/.test(status)) continue; // paid rows are not upcoming
      if ((r.type || '').toLowerCase() === 'payout') continue; // payout-movement row = −sum of its own charges; would zero the group
      if (r.net_cents == null) continue;
      if (!r.payout_date || !ISO_DATE.test(r.payout_date)) { unassignedPending += r.net_cents; continue; }
      // a payout date the summary export already shows as PAID = these tx rows are a stale
      // copy from an older export; counting them would double the money across tiers
      if (paidPayoutDates.has(r.payout_date)) continue;
      const g = txByPayout.get(r.payout_date) || { net: 0, charges: 0, nCharges: 0, refunds: 0, nRefunds: 0, chargebacks: 0, nChargebacks: 0, reserved: 0, other: 0, committed: 0, estimated: 0 };
      g.net += r.net_cents;
      // 'scheduled' = Shopify assigned a payout ID (date committed); 'pending' = Shopify's
      // estimate — with reserves the actual release may slide to a later payout.
      if (/sched|transit/.test(status)) g.committed += r.net_cents; else g.estimated += r.net_cents;
      const t = (r.type || '').toLowerCase();
      if (t === 'charge') { g.charges += r.net_cents; g.nCharges++; }
      else if (/refund/.test(t)) { g.refunds += r.net_cents; g.nRefunds++; }
      else if (/chargeback|dispute/.test(t)) { g.chargebacks += r.net_cents; g.nChargebacks++; }
      else if (/reserve/.test(t)) { g.reserved += r.net_cents; }
      else { g.other += r.net_cents; }
      txByPayout.set(r.payout_date, g);
    }
    for (const [pdate, g] of [...txByPayout.entries()].sort()) {
      if (pdate > lastKnownPayoutDate) lastKnownPayoutDate = pdate;
      if (pdate < today || g.net === 0) continue;
      const land = rollToBusinessDay(addDays(pdate, lag));
      if (land > horizonEnd) { beyondHorizon += g.net; continue; } // totals must match the visible calendar
      scheduled += g.net;
      const parts = [`${g.nCharges} charges ${(g.charges / 100).toFixed(2)}`];
      if (g.nRefunds) parts.push(`${g.nRefunds} refunds ${(g.refunds / 100).toFixed(2)}`);
      if (g.nChargebacks) parts.push(`${g.nChargebacks} chargebacks ${(g.chargebacks / 100).toFixed(2)}`);
      if (g.reserved) parts.push(`reserve ${(g.reserved / 100).toFixed(2)}`);
      if (g.other) parts.push(`other ${(g.other / 100).toFixed(2)}`);
      const label = g.estimated > 0 && g.committed > 0
        ? ` — ${(g.committed / 100).toFixed(2)} committed + ${(g.estimated / 100).toFixed(2)} Shopify-estimated (reserve releases may slide later)`
        : g.estimated > 0 ? ' — Shopify-estimated date (reserve releases may slide later)' : ' — committed';
      events.push({
        date: land, kind: 'scheduled', amount_cents: g.net,
        store_id: store.id, store_name: store.name,
        source: `payout ${pdate}: ${parts.join(', ')}${label}`,
      });
    }
    // Summary export fills only the dates the transaction export doesn't cover.
    for (const r of payoutRows) {
      const pdate = (r.payout_date || r.date) as string | null;
      if (!pdate || !ISO_DATE.test(pdate)) continue;
      if (pdate > lastKnownPayoutDate) lastKnownPayoutDate = pdate;
      if (txByPayout.has(pdate)) continue;
      if (!/sched|transit/i.test(r.payout_status || '')) continue;
      if (r.amount_cents == null || pdate < today) continue;
      const land = rollToBusinessDay(addDays(pdate, lag));
      if (land > horizonEnd) { beyondHorizon += r.amount_cents; continue; }
      scheduled += r.amount_cents;
      events.push({
        date: land, kind: 'scheduled', amount_cents: r.amount_cents,
        store_id: store.id, store_name: store.name,
        source: `scheduled payout ${pdate} (payouts summary)`,
      });
    }
    if (beyondHorizon !== 0) notes.push(`$${(beyondHorizon / 100).toFixed(2)} of known payouts land beyond the ${horizonDays}-day view (not in totals) — widen the horizon to see them.`);
    if (unassignedPending !== 0) notes.push(`$${(unassignedPending / 100).toFixed(2)} of pending money has no payout date stamped yet — re-export later and it will appear with dates.`);
    if (failedTotal !== 0) dataGaps.push(`${store.name}: $${(failedTotal / 100).toFixed(2)} of transactions sit on FAILED payouts — Shopify will retry, but verify in the Payouts screen.`);

    // ── Refunds & chargebacks over the last 30 days (loss visibility) ──
    const cutoff30 = addDays(today, -30);
    let refunds30 = 0, chargebacks30 = 0;
    for (const r of txRows) {
      const day = (r.ts_utc || r.date || '').slice(0, 10);
      if (!day || day < cutoff30) continue;
      const t = (r.type || '').toLowerCase();
      if (/refund/.test(t)) refunds30 += r.net_cents ?? 0;
      else if (/chargeback|dispute/.test(t)) chargebacks30 += r.net_cents ?? 0;
    }

    // ── Reserves currently held: prefer the per-transaction export's reserved_funds rows
    // (event-level truth — Elvris: 26 events = $744.80 exactly); fall back to the payouts
    // summary's Reserved Funds column. Withhold is negative → adds to held; release subtracts.
    let reservesHeld = 0;
    const txReserveRows = txRows.filter(r => /reserve/.test((r.type || '').toLowerCase()));
    if (txReserveRows.length > 0) {
      for (const r of txReserveRows) reservesHeld -= r.net_cents ?? 0;
    } else {
      for (const r of payoutRows) {
        const rf = r.money?.['Reserved Funds'];
        if (typeof rf === 'number') reservesHeld -= rf;
      }
    }
    if (reservesHeld < 0) reservesHeld = 0;

    // Ad burn context for the payment planner (cards keep accruing daily)
    const adPnl: any = db.prepare(
      `SELECT COALESCE(SUM(ad_spend_cents),0) AS ad, COUNT(*) AS days
       FROM daily_pnl WHERE store_id = ? AND date >= ? AND date < ? AND ad_spend_cents > 0`
    ).get(store.id, addDays(today, -7), today);
    const avgDailyAd = adPnl.days > 0 ? Math.round(adPnl.ad / adPnl.days) : 0;

    if (!hasEvidence) {
      dataGaps.push(`${store.name}: no exports uploaded — no landing dates available. Upload the Shopify payments/transactions + bank exports via Bulk Upload.`);
      notes.push('No evidence uploaded; nothing to project.');
    } else {
      notes.push(`Exports know payouts through ${lastKnownPayoutDate} — re-upload a fresh transactions export to extend the calendar.`);
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
      reserves_held_cents: reservesHeld,
      refunds_30d_cents: refunds30,
      chargebacks_30d_cents: chargebacks30,
      avg_daily_ad_burn_cents: avgDailyAd,
      last_export_payout_date: hasEvidence ? lastKnownPayoutDate : null,
      cards: cards.map(c => ({ card_name: c.card_name, owed_cents: c.amount_owed_cents })),
      events,
      notes,
    };
    // skip dead stores with nothing to show
    if (hasEvidence || cards.length > 0) storeResults.push(sc);
  }

  // ── Merge into a per-date calendar (every dollar traces to an export row) ──
  const allEvents = storeResults.flatMap(s => s.events);
  const calendar: CashflowProjection['calendar'] = [];
  let cumulative = 0;
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(today, i);
    const dayEvents = allEvents.filter(e => e.date === date).sort((a, b) => b.amount_cents - a.amount_cents);
    const confirmed = dayEvents.reduce((s, e) => s + e.amount_cents, 0);
    cumulative += confirmed;
    calendar.push({ date, confirmed_cents: confirmed, cumulative_cents: cumulative, events: dayEvents });
  }

  return {
    generated_at_date: today,
    horizon_days: horizonDays,
    stores: storeResults,
    calendar,
    totals: {
      in_transit_cents: storeResults.reduce((s, x) => s + x.in_transit_cents, 0),
      scheduled_cents: storeResults.reduce((s, x) => s + x.scheduled_cents, 0),
      reserves_held_cents: storeResults.reduce((s, x) => s + x.reserves_held_cents, 0),
      refunds_30d_cents: storeResults.reduce((s, x) => s + x.refunds_30d_cents, 0),
      chargebacks_30d_cents: storeResults.reduce((s, x) => s + x.chargebacks_30d_cents, 0),
      cards_owed_cents: storeResults.reduce((s, x) => s + x.cards.reduce((c, y) => c + y.owed_cents, 0), 0),
    },
    data_gaps: dataGaps,
  };
}
