'use client';
import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CfoTabs } from '@/components/cfo/CfoTabs';
import { FigureCell, type FigureDto, money, ageLabel } from '@/components/cfo/FigureCell';
import { TraceDrawer } from '@/components/cfo/TraceDrawer';
import { readGlobalStore, writeGlobalStore, onGlobalStoreChange } from '@/components/GlobalStore';

/** CFO Overview (v2). One screen: position now, performance for a period,
 *  each business side by side, what is reliable and what needs fixing.
 *  Every number opens its own drilldown. The detailed Position sheet,
 *  reconciliation and history stay on the existing CFO page (tabs). */

interface Row { unit: { id: string; label: string; kind: string; mapping: { status: string; decisions: string[] } }; revenue: FigureDto; netProfit: FigureDto; grossProfit: FigureDto; overhead: FigureDto; cash: FigureDto; cardDebt: FigureDto; netAssets: FigureDto; status: 'ok' | 'attention' | 'stale' | 'unmapped' | 'no-data'; statusReason: string; issueCount: number }
interface Issue { id: string; kind: string; severity: 'high' | 'medium' | 'low'; unitId: string; title: string; detail: string; count: number; cents: number | null; href: string | null; source: string; externalStatus?: string }
interface Overview {
  enabled: boolean; scope: Row['unit'] & { storeIds: string[] }; period: { from: string; to: string }; compare: { from: string; to: string }; currency: string; currencyNote: string;
  positionAsOf: string | null; performanceFor: string; freshness: Record<string, string | null>;
  headline: { availableCash: FigureDto; pendingPayouts: FigureDto; obligationsDueSoon: FigureDto; periodProfit: FigureDto; periodRevenue: FigureDto };
  rows: Row[]; unallocated: { figure: FigureDto; byAccount: { account: string; last4: string; count: number; cents: number }[]; movementsCents: number };
  totals: { revenue: FigureDto; netProfit: FigureDto; cash: FigureDto; netAssets: FigureDto };
  issues: Issue[]; scopes: { id: string; label: string; kind: string; parentId: string | null; mapping: string }[];
}

const STATUS: Record<Row['status'], { label: string; cls: string }> = {
  ok: { label: 'Reliable', cls: 'bg-emerald-500/10 text-emerald-300' },
  attention: { label: 'Needs attention', cls: 'bg-amber-500/10 text-amber-300' },
  stale: { label: 'Stale source', cls: 'bg-amber-500/10 text-amber-300' },
  unmapped: { label: 'Mapping pending', cls: 'bg-violet-500/10 text-violet-300' },
  'no-data': { label: 'No data', cls: 'bg-slate-500/10 text-slate-400' },
};
const SEV = { high: 'bg-red-500/10 text-red-300', medium: 'bg-amber-500/10 text-amber-300', low: 'bg-slate-500/10 text-slate-300' };

const iso = (d: Date) => d.toISOString().slice(0, 10);
function presetPeriod(p: string): { from: string; to: string } {
  const now = new Date();
  if (p === 'last-month') { const f = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); return { from: iso(f), to: iso(t) }; }
  if (p === '30d') return { from: iso(new Date(now.getTime() - 29 * 86_400_000)), to: iso(now) };
  if (p === 'qtd') { const q = Math.floor(now.getUTCMonth() / 3) * 3; return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), q, 1))), to: iso(now) }; }
  if (p === 'ytd') return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: iso(now) };
  return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: iso(now) };
}

function OverviewContent() {
  const sp = useSearchParams(); const router = useRouter();
  // Scope from the URL; else the globally pinned store; else everything.
  const scope = sp.get('scope') || (sp.get('storeId') ? `store:${sp.get('storeId')}` : '') || (typeof window !== 'undefined' && readGlobalStore() ? `store:${readGlobalStore()}` : 'all');
  const preset = sp.get('period') || 'mtd';
  const custom = sp.get('from') && sp.get('to') ? { from: sp.get('from')!, to: sp.get('to')! } : null;
  const period = useMemo(() => custom || presetPeriod(preset), [preset, custom?.from, custom?.to]);
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState('');
  const [trace, setTrace] = useState<{ key: string; scope: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(sp.toString()); if (v == null) n.delete(k); else n.set(k, v); router.replace(`/dashboard/cfo/overview?${n.toString()}`); };
  // Picking a store scope pins it globally (same as the store selector); a
  // global pick elsewhere moves this page too. One selection, every surface.
  const setScope = (id: string) => { if (id.startsWith('store:')) writeGlobalStore(id.slice(6)); setParam('scope', id); };
  useEffect(() => onGlobalStoreChange(id => { if (id) setParam('scope', `store:${id}`); }), [sp]);

  useEffect(() => {
    setErr(''); setData(null);
    const v2 = sp.get('v2') ? `&v2=${sp.get('v2')}` : '';
    fetch(`/api/cfo/v2/overview?scope=${encodeURIComponent(scope)}&from=${period.from}&to=${period.to}${v2}`)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || `HTTP ${r.status}`)))
      .then(j => { if (j.enabled === false) setErr('CFO v2 is off'); else setData(j); }).catch(e => setErr(String(e)));
  }, [scope, period.from, period.to]);

  const issues = useMemo(() => (data?.issues || []).filter(i => issueFilter === 'all' || i.severity === issueFilter).sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity])), [data, issueFilter]);
  const storeIdForTabs = data?.scope.kind === 'store' ? data.scope.storeIds[0] : undefined;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">CFO Overview</h1>
          <p className="text-sm text-slate-400 mt-1">Position now, performance for a period, every business side by side — each number opens where it came from.</p>
        </div>
        <Link href={`/dashboard/cfo${storeIdForTabs ? `?storeId=${storeIdForTabs}` : ''}`} className="text-[12px] text-slate-400 hover:text-white border border-slate-700 rounded px-2.5 py-1.5 whitespace-nowrap">Open the full Position sheet →</Link>
      </div>
      <CfoTabs active="overview" storeId={storeIdForTabs} />

      {/* Header controls: scope, period, comparison, currency, freshness */}
      <div className="rounded-xl bg-slate-900/60 px-4 py-3 mb-5 flex flex-wrap items-end gap-x-6 gap-y-3 text-[12px]">
        <label className="flex flex-col gap-1"><span className="text-[10px] uppercase tracking-wider text-slate-500">Business scope</span>
          <select value={scope} onChange={e => setScope(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100 min-w-[220px]">
            {(data?.scopes || [{ id: 'all', label: 'Everything', kind: 'group', parentId: null, mapping: 'resolved' }]).map(s => (
              <option key={s.id} value={s.id}>{s.parentId && s.parentId !== 'all' ? '   ' : ''}{s.label}{s.mapping === 'unresolved' ? ' (mapping pending)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[10px] uppercase tracking-wider text-slate-500">Reporting period</span>
          <select value={custom ? 'custom' : preset} onChange={e => { if (e.target.value === 'custom') return; const n = new URLSearchParams(sp.toString()); n.delete('from'); n.delete('to'); n.set('period', e.target.value); router.replace(`/dashboard/cfo/overview?${n}`); }} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100">
            <option value="mtd">This month to date</option><option value="last-month">Last month</option><option value="30d">Last 30 days</option><option value="qtd">Quarter to date</option><option value="ytd">Year to date</option>{custom && <option value="custom">Custom</option>}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[10px] uppercase tracking-wider text-slate-500">From / to</span>
          <span className="flex gap-1"><input type="date" value={period.from} onChange={e => { const n = new URLSearchParams(sp.toString()); n.set('from', e.target.value); n.set('to', period.to); router.replace(`/dashboard/cfo/overview?${n}`); }} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100" />
            <input type="date" value={period.to} onChange={e => { const n = new URLSearchParams(sp.toString()); n.set('from', period.from); n.set('to', e.target.value); router.replace(`/dashboard/cfo/overview?${n}`); }} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100" /></span>
        </label>
        <div className="flex flex-col gap-1"><span className="text-[10px] uppercase tracking-wider text-slate-500">Compared with</span><span className="text-slate-300 py-1.5">{data ? `${data.compare.from} → ${data.compare.to}` : '…'} <span className="text-slate-500">(prior period, same length)</span></span></div>
        <div className="flex flex-col gap-1"><span className="text-[10px] uppercase tracking-wider text-slate-500">Currency</span><span className="text-slate-300 py-1.5" title={data?.currencyNote}>USD <span className="text-slate-500">— no conversion applied</span></span></div>
        {data && (
          <div className="flex flex-col gap-1 ml-auto"><span className="text-[10px] uppercase tracking-wider text-slate-500">Data freshness</span>
            <span className="flex flex-wrap gap-x-3 text-slate-400 py-1.5">
              {Object.entries(data.freshness).map(([k, v]) => <span key={k} title={v || 'never'}>{k} <span className={v && (Date.now() - new Date(v.replace(' ', 'T') + 'Z').getTime()) < 36 * 3_600_000 ? 'text-emerald-300' : 'text-amber-300'}>{ageLabel(v)}</span></span>)}
            </span>
          </div>
        )}
      </div>

      {err && <div className="rounded-xl bg-red-900/20 border border-red-800/40 p-4 text-red-200 text-[13px] mb-5">{err === 'CFO v2 is off' ? 'The CFO overview is switched off. Turn it on in Settings → CFO v2, or add ?v2=1 to preview.' : `Could not load: ${err}`}</div>}
      {!data && !err && <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>}

      {data && (
        <>
          {/* Two different kinds of number, labelled as such */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            <section className="rounded-xl bg-slate-900/60 p-5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-3">Position as of <span className="text-slate-300 normal-case">{data.positionAsOf ? `${data.positionAsOf} (${ageLabel(data.positionAsOf)})` : 'unknown'}</span></p>
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-[11px] text-slate-500 mb-1">Available cash</p><FigureCell f={data.headline.availableCash} size="lg" align="left" onTrace={k => setTrace({ key: k, scope })} /></div>
                <div><p className="text-[11px] text-slate-500 mb-1">Pending payouts</p><FigureCell f={data.headline.pendingPayouts} size="lg" align="left" onTrace={k => setTrace({ key: k, scope })} /></div>
                <div><p className="text-[11px] text-slate-500 mb-1">Due in 14 days</p><FigureCell f={data.headline.obligationsDueSoon} size="lg" align="left" onTrace={k => setTrace({ key: k, scope })} /></div>
              </div>
            </section>
            <section className="rounded-xl bg-slate-900/60 p-5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-3">Performance for <span className="text-slate-300 normal-case">{data.performanceFor}</span></p>
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-[11px] text-slate-500 mb-1">Revenue</p><FigureCell f={data.headline.periodRevenue} size="lg" align="left" showCompare onTrace={k => setTrace({ key: k, scope })} /></div>
                <div><p className="text-[11px] text-slate-500 mb-1">Net profit</p><FigureCell f={data.headline.periodProfit} size="lg" align="left" showCompare signed onTrace={k => setTrace({ key: k, scope })} /></div>
                <div><p className="text-[11px] text-slate-500 mb-1">Charges paired to no store</p><FigureCell f={data.unallocated.figure} size="lg" align="left" onTrace={k => setTrace({ key: k, scope })} />
                  {data.unallocated.movementsCents > 0 && <p className="text-[10px] text-slate-500 mt-1">+ {money(data.unallocated.movementsCents)} moved between our own accounts (not spend)</p>}</div>
              </div>
            </section>
          </div>

          {/* Business comparison table */}
          <section className="rounded-xl bg-slate-900/60 overflow-hidden mb-5">
            <div className="px-5 py-3 border-b border-slate-800/60 flex items-baseline justify-between gap-4">
              <h2 className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">{data.scope.label}</h2>
              <p className="text-[11px] text-slate-500">Revenue and profit are for the period · cash is as of the bank feed · net assets are each business&apos;s latest saved snapshot</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-[13px]">
                <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                  <th className="text-left px-4 py-2.5">Business</th><th className="text-right px-4 py-2.5">Revenue</th><th className="text-right px-4 py-2.5">Net profit</th><th className="text-right px-4 py-2.5">Cash</th><th className="text-right px-4 py-2.5">Net assets</th><th className="text-left px-4 py-2.5">Status</th><th className="text-right px-4 py-2.5">Issues</th>
                </tr></thead>
                <tbody>
                  {data.rows.map(r => {
                    const isOpen = open === r.unit.id; const st = STATUS[r.status];
                    return (
                      <Fragment key={r.unit.id}>
                        <tr className={`border-b border-slate-800/40 hover:bg-slate-800/30 ${isOpen ? 'bg-slate-800/30' : ''}`}>
                          <td className="px-4 py-2.5">
                            <button onClick={() => setOpen(isOpen ? null : r.unit.id)} className="text-left text-slate-100 font-medium hover:underline underline-offset-4 decoration-slate-500" aria-expanded={isOpen}>{isOpen ? '▾' : '▸'} {r.unit.label}</button>
                            {r.unit.kind === 'store' && <Link href={`/dashboard/cfo/overview?scope=${r.unit.id}&period=${preset}`} className="ml-2 text-[10px] text-slate-500 hover:text-slate-300">focus</Link>}
                          </td>
                          <td className="px-4 py-2.5 text-right"><FigureCell f={r.revenue} showCompare onTrace={k => setTrace({ key: k, scope: r.unit.id })} /></td>
                          <td className="px-4 py-2.5 text-right"><FigureCell f={r.netProfit} showCompare signed onTrace={k => setTrace({ key: k, scope: r.unit.id })} /></td>
                          <td className="px-4 py-2.5 text-right"><FigureCell f={r.cash} onTrace={k => setTrace({ key: k, scope: r.unit.id })} /></td>
                          <td className="px-4 py-2.5 text-right"><FigureCell f={r.netAssets} signed onTrace={k => setTrace({ key: k, scope: r.unit.id })} /></td>
                          <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${st.cls}`} title={r.statusReason}>{st.label}</span></td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{r.issueCount ? <button onClick={() => { setIssueFilter('all'); document.getElementById('issues')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-amber-300 hover:underline">{r.issueCount}</button> : <span className="text-slate-600">0</span>}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-slate-800/40 bg-slate-950/40">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[12px]">
                                <div><p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Gross profit</p><FigureCell f={r.grossProfit} align="left" showCompare signed onTrace={k => setTrace({ key: k, scope: r.unit.id })} /></div>
                                <div><p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Overhead (tracked)</p><FigureCell f={r.overhead} align="left" showCompare onTrace={k => setTrace({ key: k, scope: r.unit.id })} /></div>
                                <div><p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Card debt</p><FigureCell f={r.cardDebt} align="left" onTrace={k => setTrace({ key: k, scope: r.unit.id })} /></div>
                                <div><p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Status</p><p className="text-slate-300">{r.statusReason}</p>
                                  {r.unit.mapping.status === 'unresolved' && <ul className="mt-1 list-disc pl-4 text-slate-400">{r.unit.mapping.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>}
                                </div>
                              </div>
                              {r.unit.kind === 'store' && <p className="mt-2 text-[11px]"><Link href={`/dashboard/cfo?storeId=${r.unit.id.slice(6)}&tab=position`} className="text-slate-400 hover:text-white">Position sheet →</Link> <Link href={`/dashboard/cfo?storeId=${r.unit.id.slice(6)}&tab=pnl`} className="ml-3 text-slate-400 hover:text-white">P&amp;L →</Link> <Link href={`/dashboard/cfo?storeId=${r.unit.id.slice(6)}&tab=recon`} className="ml-3 text-slate-400 hover:text-white">Reconciliation →</Link></p>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot><tr className="bg-slate-800/30 font-medium">
                  <td className="px-4 py-2.5 text-slate-200">Total — {data.scope.label}</td>
                  <td className="px-4 py-2.5 text-right"><FigureCell f={data.totals.revenue} showCompare onTrace={k => setTrace({ key: k, scope })} /></td>
                  <td className="px-4 py-2.5 text-right"><FigureCell f={data.totals.netProfit} showCompare signed onTrace={k => setTrace({ key: k, scope })} /></td>
                  <td className="px-4 py-2.5 text-right"><FigureCell f={data.totals.cash} onTrace={k => setTrace({ key: k, scope })} /></td>
                  <td className="px-4 py-2.5 text-right"><FigureCell f={data.totals.netAssets} signed onTrace={k => setTrace({ key: k, scope })} /></td>
                  <td className="px-4 py-2.5" colSpan={2}>{data.totals.netAssets.mixedAsOf && <span className="text-[11px] text-amber-300">Net assets add snapshots saved on different dates — not one synchronized balance.</span>}</td>
                </tr></tfoot>
              </table>
            </div>
            {data.unallocated.byAccount.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-800/60 text-[12px] text-slate-400">
                <span className="text-amber-300 font-medium">Unallocated shared costs:</span> {data.unallocated.byAccount.map(b => `${b.account} ··${b.last4} ${b.count} × ${money(b.cents)}`).join(' · ')} — <button className="underline underline-offset-4 hover:text-white" onClick={() => setTrace({ key: 'unallocated', scope })}>see every charge</button>
              </div>
            )}
          </section>

          {/* Issues */}
          <section id="issues" className="rounded-xl bg-slate-900/60 overflow-hidden mb-5">
            <div className="px-5 py-3 border-b border-slate-800/60 flex items-center justify-between gap-4">
              <h2 className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">What needs fixing <span className="text-slate-500 normal-case">({data.issues.length})</span></h2>
              <div className="flex gap-1 text-[11px]">{(['all', 'high', 'medium', 'low'] as const).map(f => <button key={f} onClick={() => setIssueFilter(f)} className={`px-2 py-0.5 rounded ${issueFilter === f ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-white'}`}>{f}</button>)}</div>
            </div>
            <ul className="divide-y divide-slate-800/40">
              {issues.length === 0 && <li className="px-5 py-4 text-slate-500 text-[13px]">Nothing open for this scope and period.</li>}
              {issues.map(i => (
                <li key={i.id} className="px-5 py-2.5 flex items-start gap-3 text-[13px]">
                  <span className={`mt-0.5 px-1.5 rounded text-[10px] uppercase ${SEV[i.severity]}`}>{i.severity}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-100">{i.href ? <Link href={i.href} className="hover:underline underline-offset-4">{i.title}</Link> : i.title}</p>
                    <p className="text-slate-500 text-[12px] truncate" title={i.detail}>{i.detail} <span className="text-slate-600">· {i.source}{i.externalStatus ? ` · ${i.externalStatus}` : ''}</span></p>
                  </div>
                  <span className="text-right tabular-nums text-slate-300 whitespace-nowrap">{i.cents != null ? money(i.cents) : <span className="text-slate-600" title="the source does not know the amount">amount unknown</span>}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* AI Investigator: reuse the existing per-store investigator */}
          <section className="rounded-xl bg-slate-900/40 border border-slate-800/60 p-4 text-[12px] text-slate-400">
            <span className="text-slate-200 font-medium">AI Investigator</span> — the deep analysis of a store&apos;s snapshot gap runs on its Reconciliation tab{storeIdForTabs ? <> — <Link href={`/dashboard/cfo?storeId=${storeIdForTabs}&tab=recon`} className="text-slate-200 hover:underline underline-offset-4">open it for {data.scope.label}</Link></> : '; pick a store scope to open it'}. Cross-business briefings arrive in Phase 3.
          </section>
        </>
      )}

      <TraceDrawer traceKey={trace?.key || null} scope={trace?.scope || scope} period={period} onClose={() => setTrace(null)} />
    </div>
  );
}

export default function CfoOverviewPage() {
  return <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}><OverviewContent /></Suspense>;
}
