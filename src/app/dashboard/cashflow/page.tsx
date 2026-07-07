'use client';

import { useEffect, useState } from 'react';

function cents(n: number): string {
  return (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const KIND_STYLE: Record<string, { chip: string; label: string }> = {
  in_transit: { chip: 'bg-blue-900/50 text-blue-300', label: 'in transit' },
  scheduled: { chip: 'bg-emerald-900/50 text-emerald-300', label: 'scheduled' },
};

export default function CashflowPage() {
  const [projection, setProjection] = useState<any>(null);
  const [storeId, setStoreId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<any>(null);
  const [planMeta, setPlanMeta] = useState<{ created_at?: string } | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');

  const load = (sid: string) => {
    setLoading(true);
    const url = `/api/cashflow${sid ? `?storeId=${sid}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (!d.projection) console.warn('[cashflow] no projection in response');
        setProjection(d.projection || null);
      })
      .catch(e => console.error('[cashflow] fetch failed:', e))
      .finally(() => setLoading(false));
    fetch(`/api/cashflow/ai?storeId=${sid || 'all'}`)
      .then(r => r.json())
      .then(d => { setPlan(d.plan || null); setPlanMeta(d.plan ? { created_at: d.created_at } : null); })
      .catch(e => console.error('[cashflow/ai] fetch failed:', e));
  };

  useEffect(() => { load(storeId); }, [storeId]);

  // Initial load: fetch all stores to populate the selector
  useEffect(() => {
    if (!projection) load('');
  }, []);

  const runPlan = async () => {
    setPlanLoading(true); setPlanError('');
    try {
      const r = await fetch('/api/cashflow/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storeId ? { storeId } : {}),
      });
      const d = await r.json();
      if (d.error) setPlanError(d.error);
      else { setPlan(d.plan); setPlanMeta({ created_at: new Date().toISOString() }); }
    } catch (e: any) { setPlanError(e?.message || 'failed'); }
    finally { setPlanLoading(false); }
  };

  const toggleDate = (d: string) => setExpandedDates(prev => {
    const next = new Set(prev);
    if (next.has(d)) next.delete(d); else next.add(d);
    return next;
  });

  const t = projection?.totals;
  const stores = projection?.stores || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Cashflow</h1>
          <p className="text-sm text-slate-400 mt-1">When money lands, per date — from your payout exports, bank landings, and revenue run-rate</p>
        </div>
        <select value={storeId} onChange={e => setStoreId(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-3 py-2">
          <option value="">All stores</option>
          {stores.map((s: any) => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500 animate-pulse">Building projection…</p>}

      {!loading && !projection && <p className="text-sm text-red-400">No data loaded. Check console for errors.</p>}

      {!loading && projection && (
        <>
          {/* Totals strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <div className="bg-slate-900 border border-blue-900/40 rounded-xl p-3">
              <p className="text-[10px] text-blue-400 uppercase tracking-wider">In transit</p>
              <p className="text-lg font-bold text-white">{cents(t.in_transit_cents)}</p>
              <p className="text-[10px] text-slate-500">sent, lands in days</p>
            </div>
            <div className="bg-slate-900 border border-emerald-900/40 rounded-xl p-3">
              <p className="text-[10px] text-emerald-400 uppercase tracking-wider">Scheduled</p>
              <p className="text-lg font-bold text-white">{cents(t.scheduled_cents)}</p>
              <p className="text-[10px] text-slate-500">queued by Shopify</p>
            </div>
            <div className="bg-slate-900 border border-rose-900/40 rounded-xl p-3">
              <p className="text-[10px] text-rose-400 uppercase tracking-wider">Refunds + chargebacks 30d</p>
              <p className="text-lg font-bold text-white">{cents((t.refunds_30d_cents || 0) + (t.chargebacks_30d_cents || 0))}</p>
              <p className="text-[10px] text-slate-500">{cents(t.refunds_30d_cents || 0)} refunds · {cents(t.chargebacks_30d_cents || 0)} chargebacks</p>
            </div>
            <div className="bg-slate-900 border border-amber-900/40 rounded-xl p-3">
              <p className="text-[10px] text-amber-400 uppercase tracking-wider">Reserves held</p>
              <p className="text-lg font-bold text-white">{cents(t.reserves_held_cents)}</p>
              <p className="text-[10px] text-slate-500">Shopify holdbacks — not spendable</p>
            </div>
          </div>

          {/* Data gaps */}
          {projection.data_gaps.length > 0 && (
            <div className="mb-4 bg-amber-950/20 border border-amber-900/40 rounded-lg px-4 py-2">
              {projection.data_gaps.map((g: string, i: number) => (
                <p key={i} className="text-[11px] text-amber-300">⚠ {g}</p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
            {/* Landing calendar */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-white">Landing calendar</h2>
                <p className="text-[10px] text-slate-500">Every dollar comes from your exports — payout dates Shopify has committed, with charge/refund/chargeback/reserve breakdown. Click a day for detail.</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase">
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-right px-2 py-2">Landing</th>
                    <th className="text-right px-4 py-2">Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {projection.calendar.map((day: any) => (
                    <>
                      <tr key={day.date} onClick={() => day.events.length && toggleDate(day.date)}
                        className={`border-t border-slate-800/60 ${day.events.length ? 'cursor-pointer hover:bg-slate-800/40' : ''} ${day.confirmed_cents > 0 ? 'bg-emerald-950/10' : ''}`}>
                        <td className="px-4 py-2 text-slate-300">
                          {dayLabel(day.date)}
                          {day.date === projection.generated_at_date && <span className="ml-1.5 text-[9px] bg-blue-900/50 text-blue-300 px-1 rounded">today</span>}
                          {day.events.length > 0 && <span className="ml-1.5 text-slate-600">{expandedDates.has(day.date) ? '▾' : '▸'}</span>}
                        </td>
                        <td className={`px-2 py-2 text-right font-mono ${day.confirmed_cents > 0 ? 'text-emerald-400 font-bold' : 'text-slate-600'}`}>
                          {day.confirmed_cents !== 0 ? cents(day.confirmed_cents) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-slate-300">{cents(day.cumulative_cents)}</td>
                      </tr>
                      {expandedDates.has(day.date) && day.events.map((e: any, i: number) => (
                        <tr key={`${day.date}-${i}`} className="bg-slate-800/30">
                          <td className="px-4 py-1 pl-8 text-slate-400">{e.store_name}</td>
                          <td className="px-2 py-1 text-slate-500">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded mr-1.5 ${(KIND_STYLE[e.kind] || KIND_STYLE.scheduled).chip}`}>{(KIND_STYLE[e.kind] || KIND_STYLE.scheduled).label}</span>
                            {e.source}
                          </td>
                          <td className="px-4 py-1 text-right font-mono text-slate-300">{cents(e.amount_cents)}</td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-5">
              {/* Per-store snapshot */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800">
                  <h2 className="text-sm font-semibold text-white">Stores</h2>
                </div>
                <div className="divide-y divide-slate-800/60">
                  {stores.map((s: any) => (
                    <div key={s.store_id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-white">{s.store_name}
                          {!s.has_evidence && <span className="ml-1.5 text-[9px] bg-amber-900/40 text-amber-400 px-1 rounded" title="Upload the Shopify transactions + bank exports to get landing dates">no data</span>}
                          {s.landing_lag_days != null && <span className="ml-1.5 text-[9px] text-slate-500">lands +{s.landing_lag_days}d ({s.matched_payouts} matched)</span>}
                        </span>
                        <span className="text-xs font-mono text-emerald-400">{cents(s.in_transit_cents + s.scheduled_cents)}</span>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-slate-500">
                        <span>ad burn/day {cents(s.avg_daily_ad_burn_cents)}</span>
                        {s.reserves_held_cents > 0 && <span className="text-amber-500">reserve {cents(s.reserves_held_cents)}</span>}
                        {(s.refunds_30d_cents !== 0 || s.chargebacks_30d_cents !== 0) && (
                          <span className="text-rose-400/80">30d: refunds {cents(s.refunds_30d_cents)} · chargebacks {cents(s.chargebacks_30d_cents)}</span>
                        )}
                        {s.last_export_payout_date && <span>export covers → {s.last_export_payout_date}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI payment plan */}
              <div className="bg-slate-900 border border-violet-900/40 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-violet-300">🧠 Fable payment plan</h2>
                  <button onClick={runPlan} disabled={planLoading}
                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
                    {planLoading ? 'Planning… (1-2 min)' : plan ? 'Re-plan' : 'Build plan'}
                  </button>
                </div>
                <div className="p-4">
                  {planError && <p className="text-[11px] text-red-400 mb-2">{planError}</p>}
                  {planLoading && <p className="text-[11px] text-slate-500 animate-pulse">Matching card obligations against landing dates…</p>}
                  {!plan && !planLoading && (
                    <p className="text-[11px] text-slate-500">Builds a day-by-day plan: which card to pay, how much, on which date — covered by cash that has actually landed.</p>
                  )}
                  {plan && !planLoading && (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-200 bg-violet-950/30 rounded-lg px-3 py-2">{plan.summary}</p>
                      {(plan.daily_plan || []).filter((d: any) => (d.payments || []).length > 0).map((d: any, i: number) => (
                        <div key={i} className="bg-slate-800/50 rounded-lg px-3 py-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-white font-medium">{dayLabel(d.date)}</span>
                            <span className="text-slate-500 font-mono">landed by then: {cents(d.expected_landed_cents || 0)}</span>
                          </div>
                          {(d.payments || []).map((p: any, j: number) => (
                            <div key={j} className="flex items-center justify-between mt-1 text-[11px]">
                              <span className="text-slate-300">→ pay <span className="text-white">{p.card_name}</span> <span className="text-slate-500">({p.store})</span></span>
                              <span className="font-mono text-emerald-400 font-bold">{cents(p.amount_cents)}</span>
                            </div>
                          ))}
                          {d.note && <p className="text-[10px] text-slate-500 mt-1">{d.note}</p>}
                        </div>
                      ))}
                      {(plan.risks || []).length > 0 && (
                        <div className="text-[10px] text-amber-400 space-y-0.5">
                          {plan.risks.map((r: string, i: number) => <p key={i}>⚠ {r}</p>)}
                        </div>
                      )}
                      {(plan.data_gaps || []).length > 0 && (
                        <div className="text-[10px] text-slate-500 space-y-0.5">
                          {plan.data_gaps.map((g: string, i: number) => <p key={i}>· {g}</p>)}
                        </div>
                      )}
                      {planMeta?.created_at && <p className="text-[9px] text-slate-600">{planMeta.created_at}</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
