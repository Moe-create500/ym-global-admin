'use client';

import { useEffect, useState, useCallback } from 'react';
import { fmtCents } from '@/components/finance-ui';

// CFO Monthly — month-first store expenses + credit-card allocation.
// Read-only lens over existing financial truth (classification_results +
// daily_pnl). LOADING ≠ ZERO and FAILED ≠ ZERO: skeletons + explicit errors.

const monthLabel = (m: string) =>
  new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split('-').map(Number);
  const nd = new Date(Date.UTC(y, mo - 1 + d, 15));
  return nd.toISOString().slice(0, 7);
};

export default function CfoMonthlyPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [prev, setPrev] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openStore, setOpenStore] = useState<string | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true); setError(''); setOpenStore(null);
    const [cur, pv] = await Promise.all([
      fetch(`/api/cfo/monthly?month=${m}`).then(r => r.json()).catch(() => ({ error: 'request failed' })),
      fetch(`/api/cfo/monthly?month=${shiftMonth(m, -1)}`).then(r => r.json()).catch(() => null),
    ]);
    if (cur?.error) { setError(cur.error); setData(null); }
    else { setData(cur); setPrev(pv?.error ? null : pv); }
    setLoading(false);
  }, []);
  useEffect(() => { load(month); }, [month, load]);

  const prevStore = (storeId: string | null) =>
    prev?.store_expenses?.find((r: any) => (r.store_id ?? null) === storeId)?.cents ?? null;

  return (
    <div>
      {/* Header + month navigation — every section inherits this period */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">CFO — Monthly</h1>
          <p className="text-sm text-slate-400 mt-1">Store expenses, card allocation, and P&L cross-check · <a href="/dashboard/cfo" className="text-blue-400 hover:text-blue-300">balance sheet →</a></p>
        </div>
        <div className="flex items-center gap-1 bg-slate-900/70 rounded-xl px-1.5 py-1">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="px-3 py-1.5 text-slate-400 hover:text-white text-sm rounded-lg hover:bg-slate-800">←</button>
          <span className="px-3 text-sm font-semibold text-white min-w-[140px] text-center">{monthLabel(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="px-3 py-1.5 text-slate-400 hover:text-white text-sm rounded-lg hover:bg-slate-800">→</button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 px-4 py-3 text-red-300 text-sm mb-6">
          Failed to load this month: {error} — the numbers below are NOT zero, they are unavailable.
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map(i => <div key={i} className="rounded-xl bg-slate-900/60 h-32 animate-pulse" />)}
        </div>
      ) : data && (
        <>
          {/* Headline: existing P&L truth + attribution coverage */}
          <div className="flex flex-wrap items-end gap-x-12 gap-y-4 mb-8">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Revenue (P&L)</p>
              <p className="text-3xl font-semibold text-white tabular-nums">{fmtCents(data.pnl.revenue_cents)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Net profit (P&L)</p>
              <p className={`text-3xl font-semibold tabular-nums ${data.pnl.net_profit_cents >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{fmtCents(data.pnl.net_profit_cents)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Bank/card outflows</p>
              <p className="text-2xl font-semibold text-slate-200 tabular-nums">{fmtCents(data.totals.expense_cents)}</p>
              <p className="text-[11px] text-slate-500 mt-1">transfers & card payments excluded (not expenses)</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Paired to stores</p>
              <p className="text-2xl font-semibold text-emerald-300 tabular-nums">{data.totals.attribution_pct}%</p>
              <p className="text-[11px] text-amber-300/80 mt-1 tabular-nums">{fmtCents(data.totals.unattributed_cents)} unattributed</p>
            </div>
          </div>

          {/* Store expenses — click to drill into merchants + accounts */}
          <div className="rounded-xl bg-slate-900/60 overflow-hidden mb-6">
            <div className="px-4 py-2.5 border-b border-slate-800/60 flex items-center justify-between">
              <p className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">Store expenses · {monthLabel(month)}</p>
              <p className="text-[11px] text-slate-500">click a store to drill down</p>
            </div>
            {data.store_expenses.length === 0 && <p className="px-4 py-8 text-center text-slate-500 text-sm">No expenses this month</p>}
            {data.store_expenses.map((r: any) => {
              const key = r.store_id ?? 'unattributed';
              const pv = prevStore(r.store_id ?? null);
              const delta = pv != null && pv > 0 ? ((r.cents - pv) / pv) * 100 : null;
              const detail = data.store_detail[key];
              const isOpen = openStore === key;
              const maxCents = data.store_expenses[0]?.cents || 1;
              return (
                <div key={key} className="border-b border-slate-800/40 last:border-b-0">
                  <button onClick={() => setOpenStore(isOpen ? null : key)}
                    className="w-full px-4 py-3 flex items-center gap-4 hover:bg-slate-800/30 transition-colors text-left">
                    <span className={`w-32 text-sm truncate ${r.store_id ? 'text-slate-100' : 'text-amber-300'}`}>{r.store}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div className={`h-full rounded-full ${r.store_id ? 'bg-gradient-to-r from-blue-400 to-indigo-300' : 'bg-amber-400/60'}`}
                        style={{ width: `${Math.max(2, (r.cents / maxCents) * 100)}%` }} />
                    </div>
                    <span className="text-sm font-medium text-slate-100 tabular-nums w-28 text-right">{fmtCents(r.cents)}</span>
                    <span className={`text-[11px] tabular-nums w-16 text-right ${delta == null ? 'text-slate-600' : delta > 10 ? 'text-amber-300' : 'text-slate-500'}`}>
                      {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`}
                    </span>
                    <span className="text-slate-600 text-xs">{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && detail && (
                    <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-6 bg-slate-950/40">
                      <div className="pt-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">By merchant</p>
                        {detail.by_merchant.map((m: any, i: number) => (
                          <div key={i} className="flex justify-between text-[12px] py-0.5">
                            <span className="text-slate-300 truncate mr-4">{m.merchant} <span className="text-slate-600">×{m.n}</span></span>
                            <span className="text-slate-200 tabular-nums">{fmtCents(m.cents)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="pt-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">By account</p>
                        {detail.by_account.map((acc: any, i: number) => (
                          <div key={i} className="flex justify-between text-[12px] py-0.5">
                            <span className="text-slate-300 truncate mr-4">{acc.account}{acc.account_type === 'credit' && <span className="ml-1 text-[9px] px-1 rounded bg-slate-800 text-slate-500">card</span>}</span>
                            <span className="text-slate-200 tabular-nums">{fmtCents(acc.cents)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Credit-card store allocation — whose charges sit on each card */}
          <div className="rounded-xl bg-slate-900/60 overflow-hidden mb-6">
            <div className="px-4 py-2.5 border-b border-slate-800/60">
              <p className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">Credit-card store allocation · {monthLabel(month)}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Charges split by proven attribution; card payments shown as settlements, never expenses</p>
            </div>
            {data.card_allocation.length === 0 && <p className="px-4 py-8 text-center text-slate-500 text-sm">No card activity this month</p>}
            {data.card_allocation.map((c: any) => (
              <div key={c.id} className="px-4 py-3 border-b border-slate-800/40 last:border-b-0">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-sm text-slate-100">{c.card}</p>
                  <p className="text-[12px] text-slate-400 tabular-nums">
                    charges <span className="text-slate-100 font-medium">{fmtCents(c.charges_cents)}</span>
                    {c.payments_cents > 0 && <> · payments <span className="text-blue-300">{fmtCents(c.payments_cents)}</span> <span className="text-slate-600">(P&L $0)</span></>}
                  </p>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden bg-slate-800 mb-1.5">
                  {c.stores.map((s: any, i: number) => (
                    <div key={i} title={`${s.store}: ${fmtCents(s.cents)}`}
                      className={s.store.includes('Unattributed') ? 'bg-amber-400/70' : ['bg-blue-400', 'bg-indigo-400', 'bg-purple-400', 'bg-pink-400', 'bg-teal-400', 'bg-cyan-400'][i % 6]}
                      style={{ width: `${(s.cents / (c.charges_cents || 1)) * 100}%` }} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {c.stores.map((s: any, i: number) => (
                    <span key={i} className={`text-[11px] tabular-nums ${s.store.includes('Unattributed') ? 'text-amber-300' : 'text-slate-400'}`}>
                      {s.store} <span className="text-slate-200">{fmtCents(s.cents)}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
