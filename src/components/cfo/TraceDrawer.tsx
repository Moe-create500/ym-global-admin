'use client';
import { useEffect, useState } from 'react';
import { money, ageLabel } from './FigureCell';

/** The drilldown behind a number: definition, formula, sources with last
 *  sync, the included records (same helpers as the overview, so the total
 *  matches), what was excluded, and how to read the kind. */

interface Trace {
  key: string; title: string; definition: string; formula: string;
  scope: { id: string; label: string }; period: { from: string; to: string } | null;
  sources: { system: string; table: string; lastSync: string | null; reference?: string }[];
  included: { columns: string[]; rows: (string | number | null)[][]; total: number | null; truncated: boolean };
  excluded: string[]; adjustments: { note: string }[]; kinds: string;
}

export function TraceDrawer({ traceKey, scope, period, onClose }: { traceKey: string | null; scope: string; period: { from: string; to: string }; onClose: () => void }) {
  const [t, setT] = useState<Trace | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!traceKey) return;
    setT(null); setErr('');
    fetch(`/api/cfo/v2/trace?key=${traceKey}&scope=${encodeURIComponent(scope)}&from=${period.from}&to=${period.to}`)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || r.status)))
      .then(setT).catch(e => setErr(String(e)));
  }, [traceKey, scope, period.from, period.to]);
  if (!traceKey) return null;
  const amtIdx = t?.included.columns.indexOf('amount') ?? -1;
  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label={t?.title || 'Figure detail'}>
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <aside className="w-full max-w-2xl h-full overflow-y-auto bg-slate-950 border-l border-slate-800 p-6 text-[13px]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Where this number comes from</p>
            <h2 className="text-lg font-semibold text-white mt-1">{t?.title || traceKey}</h2>
            <p className="text-slate-400 text-[12px] mt-0.5">{t?.scope.label}{t?.period ? ` · ${t.period.from} → ${t.period.to}` : ' · as of now'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-[12px] px-2 py-1 rounded border border-slate-700" aria-label="Close">Close</button>
        </div>
        {err && <p className="text-red-300">{err}</p>}
        {!t && !err && <p className="text-slate-500">Loading…</p>}
        {t && (
          <div className="space-y-5">
            <section>
              <p className="text-slate-300">{t.definition}</p>
              <p className="mt-2 font-mono text-[12px] text-slate-400 bg-slate-900/60 rounded px-3 py-2 overflow-x-auto">{t.formula}</p>
              <p className="mt-2 text-[12px] text-slate-500">How to read it: {t.kinds}</p>
            </section>
            <section>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Sources</p>
              <ul className="space-y-1">
                {t.sources.length === 0 && <li className="text-slate-500">none — this figure has no source in scope</li>}
                {t.sources.map((s, i) => (
                  <li key={i} className="flex justify-between gap-4 text-slate-300"><span>{s.system} <span className="text-slate-500">· {s.table}</span></span><span className="text-slate-500 whitespace-nowrap" title={s.lastSync || ''}>last sync {ageLabel(s.lastSync)}</span></li>
                ))}
              </ul>
            </section>
            <section>
              <div className="flex items-baseline justify-between mb-1.5">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Included records <span className="normal-case">({t.included.rows.length}{t.included.truncated ? ', first 300 shown' : ''})</span></p>
                {t.included.total != null && <p className="text-slate-200 font-medium tabular-nums">total {money(t.included.total)}</p>}
              </div>
              <div className="overflow-x-auto rounded border border-slate-800">
                <table className="min-w-full text-[12px]">
                  <thead className="bg-slate-900/60 text-slate-500 uppercase text-[10px] tracking-wider">
                    <tr>{t.included.columns.map(c => <th key={c} className={`px-2.5 py-1.5 text-left ${/amount|revenue|profit|balance|assets|liabilities|payout|fulfil/.test(c) ? 'text-right' : ''}`}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {t.included.rows.length === 0 && <tr><td colSpan={t.included.columns.length} className="px-2.5 py-3 text-slate-500">no records in this period / scope</td></tr>}
                    {t.included.rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-800/60">
                        {r.map((v, j) => {
                          const isMoney = typeof v === 'number' && /amount|revenue|profit|balance|assets|liabilities|payout|fulfil/.test(t.included.columns[j]);
                          return <td key={j} className={`px-2.5 py-1.5 ${isMoney ? 'text-right tabular-nums' : ''} ${j === amtIdx ? 'text-slate-100 font-medium' : 'text-slate-300'} whitespace-nowrap max-w-[340px] truncate`} title={String(v ?? '')}>{isMoney ? money(v as number) : String(v ?? '')}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {t.excluded.length > 0 && (
              <section>
                <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Excluded</p>
                <ul className="list-disc pl-5 text-slate-400 space-y-0.5">{t.excluded.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </section>
            )}
            {t.adjustments.length > 0 && (
              <section>
                <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Adjustments</p>
                <ul className="list-disc pl-5 text-slate-400">{t.adjustments.map((a, i) => <li key={i}>{a.note}</li>)}</ul>
              </section>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
