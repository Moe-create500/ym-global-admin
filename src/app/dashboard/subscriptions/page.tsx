'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

/** Subscriptions & recurring charges — detected from the real bank and
 *  card ledger (src/lib/subscriptions). Every row opens the transactions
 *  that made YM call it recurring; totals reconcile to those rows. */

const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
interface Sub { id: string; merchantKey: string; name: string; accountId: string; accountLabel: string; cadence: string; intervalDays: number | null; regularity: number; amountKind: 'fixed' | 'variable'; currentAmountCents: number; previousAmountCents: number | null; priceChangePct: number | null; monthlyCents: number; annualCents: number; firstDate: string; lastDate: string; nextExpectedDate: string | null; chargeCount: number; totalCents: number; status: 'active' | 'possibly_active' | 'cancelled' | 'needs_review'; statusReason: string; attribution: { storeId: string | null; confidence: number; basis: string; needsAttribution: boolean; suggestedStoreId: string | null; votes: Record<string, number> }; flags: string[]; duplicateOf: string[]; evidence: string[]; txnIds: string[]; descriptions: string[]; storeName: string | null; suggestedStoreName: string | null; review: { status: string; note: string | null; actor: string | null; updatedAt: string } | null }
interface Data { subscriptions: Sub[]; total: number; hiddenCount: number; summary: { monthlyRecurringCents: number; annualizedCents: number; activeCount: number; possiblyActiveCount: number; needsReviewCount: number; needsAttributionCount: number; newCount: number; priceIncreaseCount: number; possibleDuplicateCount: number; ledgerCheck: { subscriptions: number; sourceRows: number; totalCents: number; problems: string[] } }; savings: { potentialMonthlyCents: number; potentialAnnualCents: number; duplicateSpendMonthlyCents: number; priceIncreaseMonthlyCents: number; items: { id: string; name: string; reason: string; monthlyCents: number; detail: string; action: string }[] }; stores: { id: string; name: string }[]; accounts: { id: string; label: string }[] }

const STATUS: Record<Sub['status'], { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-500/10 text-emerald-300' },
  possibly_active: { label: 'Possibly active', cls: 'bg-sky-500/10 text-sky-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-500/10 text-slate-400' },
  needs_review: { label: 'Needs review', cls: 'bg-amber-500/10 text-amber-300' },
};
const FILTERS: [string, string][] = [['all', 'All'], ['active', 'Active'], ['new', 'New'], ['price_increased', 'Price increased'], ['possible_duplicate', 'Possible duplicate'], ['needs_attribution', 'Needs attribution'], ['needs_review', 'Needs review'], ['cancelled', 'Cancelled']];
const cadenceLabel = (c: string) => ({ weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', bimonthly: 'Every 2 months', quarterly: 'Quarterly', semiannual: 'Every 6 months', yearly: 'Yearly', irregular: 'Irregular' } as Record<string, string>)[c] || c;

function SubscriptionsContent() {
  const sp = useSearchParams(); const router = useRouter();
  const filter = sp.get('filter') || 'all', store = sp.get('store') || '', account = sp.get('account') || '', q = sp.get('q') || '';
  const view = sp.get('view') || 'list';
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(sp.get('open'));
  const [reloadKey, setReloadKey] = useState(0);
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp.toString()); if (v) n.set(k, v); else n.delete(k); router.replace(`/dashboard/subscriptions?${n}`); };
  useEffect(() => {
    setErr('');
    fetch(`/api/subscriptions?filter=${filter}&store=${encodeURIComponent(store)}&account=${encodeURIComponent(account)}&q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || r.status))).then(setData).catch(e => setErr(String(e)));
  }, [filter, store, account, q, reloadKey]);
  const rows = data?.subscriptions || [];
  const s = data?.summary;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Subscriptions</h1>
          <p className="text-sm text-slate-400 mt-1">Every recurring charge found in the bank and card ledger, who it belongs to, and what it costs. Click a row for the transactions behind it.</p>
        </div>
        <div className="flex gap-1 text-[12px]">
          {[['list', 'Subscriptions'], ['savings', 'Optimization & savings']].map(([v, l]) => (
            <button key={v} onClick={() => setParam('view', v === 'list' ? '' : v)} className={`px-3 py-1.5 rounded-full font-medium ${view === v ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-white bg-slate-900/70'}`}>{l}</button>
          ))}
        </div>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {[
            ['Monthly recurring spend', money(s.monthlyRecurringCents), `${s.activeCount} active · ${s.possiblyActiveCount} possibly`],
            ['Annualized spend', money(s.annualizedCents), 'active + possibly active × 12'],
            ['Active subscriptions', String(s.activeCount), `${s.newCount} new in 60 days`],
            ['Potential savings', money(data!.savings.potentialMonthlyCents) + '/mo', `${money(data!.savings.potentialAnnualCents)}/yr · duplicates + price rises`],
            ['Needs review', String(s.needsReviewCount + s.needsAttributionCount), `${s.needsAttributionCount} need a store · ${s.needsReviewCount} to review`],
          ].map(([l, v, sub]) => (
            <div key={l} className="rounded-xl bg-slate-900/60 p-4"><p className="text-[10px] uppercase tracking-wider text-slate-500">{l}</p><p className="text-xl font-semibold text-white tabular-nums mt-1">{v}</p><p className="text-[11px] text-slate-500 mt-0.5">{sub}</p></div>
          ))}
        </div>
      )}
      {s && (
        <p className={`text-[11px] mb-4 ${s.ledgerCheck.problems.length ? 'text-red-300' : 'text-slate-500'}`}>
          Ledger check: {s.ledgerCheck.subscriptions} subscriptions built from {s.ledgerCheck.sourceRows} transactions totalling {money(s.ledgerCheck.totalCents)} — {s.ledgerCheck.problems.length ? `${s.ledgerCheck.problems.length} problems: ${s.ledgerCheck.problems.slice(0, 3).join('; ')}` : 'every total equals its source rows, no transaction counted twice'}{data!.hiddenCount ? ` · ${data!.hiddenCount} marked "not a subscription" (hidden)` : ''}.
        </p>
      )}
      {err && <p className="text-red-300 text-[13px] mb-4">Could not load: {err}</p>}

      {view === 'savings' && data && <SavingsView data={data} onOpen={setOpenId} />}

      {view !== 'savings' && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3 text-[12px]">
            {FILTERS.map(([id, l]) => <button key={id} onClick={() => setParam('filter', id === 'all' ? '' : id)} className={`px-2.5 py-1 rounded-full ${filter === id ? 'bg-slate-100 text-slate-900' : 'bg-slate-900/70 text-slate-400 hover:text-white'}`}>{l}</button>)}
            <select value={store} onChange={e => setParam('store', e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"><option value="">All companies</option>{(data?.stores || []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <select value={account} onChange={e => setParam('account', e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"><option value="">All accounts / cards</option>{(data?.accounts || []).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
            <input type="search" defaultValue={q} placeholder="Search vendor, card, store…" onKeyDown={e => { if (e.key === 'Enter') setParam('q', (e.target as HTMLInputElement).value); }} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 min-w-[220px]" />
            <span className="text-slate-500 ml-auto">{rows.length} of {data?.total ?? '…'}</span>
          </div>
          <div className="rounded-xl bg-slate-900/60 overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                <th className="text-left px-4 py-2.5">Subscription</th><th className="text-left px-3 py-2.5">Store</th><th className="text-right px-3 py-2.5">Monthly</th><th className="text-right px-3 py-2.5">Annual</th><th className="text-left px-3 py-2.5">Card / account</th><th className="text-left px-3 py-2.5">Last charge</th><th className="text-left px-3 py-2.5">Next</th><th className="text-right px-3 py-2.5">Change</th><th className="text-left px-3 py-2.5">Status</th><th className="text-left px-3 py-2.5">Actions</th>
              </tr></thead>
              <tbody>
                {!data && !err && <tr><td colSpan={10} className="px-4 py-8 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400 inline-block" /></td></tr>}
                {data && rows.length === 0 && <tr><td colSpan={10} className="px-4 py-6 text-slate-500">Nothing matches this filter.</td></tr>}
                {rows.map(r => {
                  const st = STATUS[r.status];
                  return (
                    <tr key={r.id} className="border-b border-slate-800/40 hover:bg-slate-800/30 cursor-pointer" onClick={() => setOpenId(r.id)}>
                      <td className="px-4 py-2.5">
                        <span className="text-slate-100 font-medium">{r.name}</span>
                        <span className="block text-[11px] text-slate-500">{cadenceLabel(r.cadence)} · {money(r.currentAmountCents)}{r.amountKind === 'variable' ? ' avg' : ''} · {r.chargeCount} charges · {money(r.totalCents)} total</span>
                        <span className="flex flex-wrap gap-1 mt-1">
                          {r.flags.includes('possible_duplicate') && <span className="px-1.5 rounded bg-amber-500/10 text-amber-300 text-[10px]">POSSIBLE DUPLICATE</span>}
                          {r.flags.includes('new') && <span className="px-1.5 rounded bg-sky-500/10 text-sky-300 text-[10px]">NEW</span>}
                          {r.flags.includes('same_vendor') && <span className="px-1.5 rounded bg-slate-500/10 text-slate-300 text-[10px]">SAME VENDOR, OTHER PLAN</span>}
                          {r.flags.includes('variable') && <span className="px-1.5 rounded bg-slate-500/10 text-slate-300 text-[10px]">VARIABLE BILL</span>}
                          {r.review?.status === 'review_for_cancellation' && <span className="px-1.5 rounded bg-red-500/10 text-red-300 text-[10px]">REVIEW FOR CANCELLATION</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{r.storeName ? <span className="text-slate-200">{r.storeName}<span className="block text-[10px] text-slate-500">{r.attribution.basis === 'mapping' ? 'assigned' : `${Math.round(r.attribution.confidence * 100)}% from charges`}</span></span> : <span className="text-amber-300 text-[11px]">NEEDS ATTRIBUTION{r.suggestedStoreName && <span className="block text-slate-500">likely {r.suggestedStoreName}</span>}</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-100">{money(r.monthlyCents)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{money(r.annualCents)}</td>
                      <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{r.accountLabel}</td>
                      <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{r.lastDate}</td>
                      <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{r.nextExpectedDate || '—'}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${r.priceChangePct ? (r.priceChangePct > 0 ? 'text-red-300' : 'text-emerald-300') : 'text-slate-600'}`}>{r.priceChangePct ? `${r.priceChangePct > 0 ? '+' : ''}${r.priceChangePct}%` : '—'}</td>
                      <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[11px] ${st.cls}`} title={r.statusReason}>{st.label}</span></td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">Open →</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {openId && data && <Drawer id={openId} stores={data.stores} onClose={() => setOpenId(null)} onChanged={() => setReloadKey(k => k + 1)} />}
    </div>
  );
}

function SavingsView({ data, onOpen }: { data: Data; onOpen: (id: string) => void }) {
  const { savings, summary } = data;
  const tiles: [string, string][] = [
    ['Current monthly recurring spend', money(summary.monthlyRecurringCents)], ['Annualized recurring spend', money(summary.annualizedCents)],
    ['Potential duplicate spend', money(savings.duplicateSpendMonthlyCents) + '/mo'], ['Recent price increases', `${summary.priceIncreaseCount} · +${money(savings.priceIncreaseMonthlyCents)}/mo`],
    ['New subscriptions (60d)', String(summary.newCount)], ['Needing attribution', String(summary.needsAttributionCount)], ['Needing review', String(summary.needsReviewCount)],
    ['Potential savings', `${money(savings.potentialMonthlyCents)}/mo · ${money(savings.potentialAnnualCents)}/yr`],
  ];
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">{tiles.map(([l, v]) => <div key={l} className="rounded-xl bg-slate-900/60 p-4"><p className="text-[10px] uppercase tracking-wider text-slate-500">{l}</p><p className="text-lg font-semibold text-white tabular-nums mt-1">{v}</p></div>)}</div>
      <p className="text-[12px] text-slate-400 mb-3">Ranked by monthly impact. Nothing here says a subscription is unused — a duplicate or a price rise is a reason to <em>review</em>, and only usage evidence can justify cancelling.</p>
      <div className="rounded-xl bg-slate-900/60 overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60"><th className="text-left px-4 py-2.5">Subscription</th><th className="text-left px-3 py-2.5">Why</th><th className="text-right px-3 py-2.5">Monthly impact</th><th className="text-left px-3 py-2.5">Action</th></tr></thead>
          <tbody>
            {savings.items.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-slate-500">No opportunities found.</td></tr>}
            {savings.items.map(i => (
              <tr key={i.id + i.reason} className="border-b border-slate-800/40 hover:bg-slate-800/30 cursor-pointer" onClick={() => onOpen(i.id)}>
                <td className="px-4 py-2.5 text-slate-100">{i.name}</td>
                <td className="px-3 py-2.5 text-slate-300 max-w-[560px]">{i.detail}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-100">{i.monthlyCents ? money(i.monthlyCents) : <span className="text-slate-500">—</span>}</td>
                <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-[10px] ${i.action === 'REVIEW FOR CANCELLATION' ? 'bg-red-500/10 text-red-300' : i.action === 'ASSIGN STORE' ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-500/10 text-slate-300'}`}>{i.action}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Drawer({ id, stores, onClose, onChanged }: { id: string; stores: { id: string; name: string }[]; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<{ subscription: Sub; transactions: any[]; related: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [storeSel, setStoreSel] = useState('');
  const load = () => fetch(`/api/subscriptions/${encodeURIComponent(id)}`).then(r => r.json()).then(j => { setD(j); setStoreSel(j.subscription?.attribution?.storeId || j.subscription?.attribution?.suggestedStoreId || ''); });
  useEffect(() => { setD(null); load(); }, [id]);
  const act = async (body: any) => { setBusy(true); try { await fetch('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) }); await load(); onChanged(); } finally { setBusy(false); } };
  const s = d?.subscription;
  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <aside className="w-full max-w-2xl h-full overflow-y-auto bg-slate-950 border-l border-slate-800 p-6 text-[13px]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Subscription</p>
            <h2 className="text-lg font-semibold text-white mt-1">{s?.name || '…'}</h2>
            {s && <p className="text-slate-400 text-[12px] mt-0.5">{cadenceLabel(s.cadence)} · {s.accountLabel} · {STATUS[s.status].label} — {s.statusReason}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-[12px] px-2 py-1 rounded border border-slate-700">Close</button>
        </div>
        {!d && <p className="text-slate-500">Loading…</p>}
        {s && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
              {([['Current amount', money(s.currentAmountCents) + (s.amountKind === 'variable' ? ' (latest)' : '')], ['Monthly estimate', money(s.monthlyCents)], ['Annualized', money(s.annualCents)], ['Previous amount', s.previousAmountCents != null ? money(s.previousAmountCents) : '—'],
                ['Price change', s.priceChangePct != null ? `${s.priceChangePct > 0 ? '+' : ''}${s.priceChangePct}%` : '—'], ['Last charge', s.lastDate], ['Next expected', s.nextExpectedDate || '—'], ['First detected', s.firstDate],
                ['Charges', String(s.chargeCount)], ['Total spent', money(s.totalCents)], ['Interval', s.intervalDays ? `${s.intervalDays} days · ${Math.round(s.regularity * 100)}% regular` : '—'], ['Attribution confidence', `${Math.round(s.attribution.confidence * 100)}% · ${s.attribution.basis}`]] as [string, string][]).map(([l, v]) => (
                <div key={l} className="rounded-lg bg-slate-900/60 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-500">{l}</p><p className="text-slate-100 tabular-nums mt-0.5">{v}</p></div>
              ))}
            </div>
            <section className="rounded-lg bg-slate-900/60 p-4">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Store / company</p>
              <p className="text-slate-300 mb-2">{s.storeName ? <>Belongs to <b className="text-white">{s.storeName}</b> ({s.attribution.basis === 'mapping' ? 'assigned by a worker — remembered for future charges' : `${Math.round(s.attribution.confidence * 100)}% of its charges are paired to this store`})</> : <span className="text-amber-300">NEEDS ATTRIBUTION — {s.suggestedStoreName ? `charges suggest ${s.suggestedStoreName}, not confirmed` : 'no evidence links this to a store'}</span>}</p>
              {Object.keys(s.attribution.votes).length > 0 && <p className="text-[11px] text-slate-500 mb-2">Paired charges: {Object.entries(s.attribution.votes).map(([sid, n]) => `${stores.find(x => x.id === sid)?.name || sid} ×${n}`).join(' · ')}</p>}
              <div className="flex gap-2 items-center">
                <select value={storeSel} onChange={e => setStoreSel(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"><option value="">— pick a store —</option>{stores.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <button disabled={busy || !storeSel} onClick={() => act({ action: 'assign', storeId: storeSel })} className="px-3 py-1 rounded bg-slate-100 text-slate-900 text-[12px] font-medium disabled:opacity-50">Assign store (remember for {s.name})</button>
                {s.attribution.basis === 'mapping' && <button disabled={busy} onClick={() => act({ action: 'assign', storeId: null })} className="text-[12px] text-slate-400 hover:text-white">clear</button>}
              </div>
            </section>
            {(s.evidence.length > 0 || d!.related.length > 0) && (
              <section className="rounded-lg bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">{s.flags.includes('possible_duplicate') ? 'Possible duplicate — evidence' : 'Other plans from this vendor'}</p>
                <ul className="list-disc pl-5 text-slate-300 space-y-1">{s.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
                {d!.related.length > 0 && <ul className="mt-2 space-y-1 text-[12px]">{d!.related.map(r => <li key={r.id} className="flex justify-between gap-3 text-slate-400"><span>{r.name} · {r.accountLabel} · {r.storeName || 'no store'} · {r.firstDate} → {r.lastDate} · {STATUS[r.status as Sub['status']].label}</span><span className="tabular-nums">{money(r.monthlyCents)}/mo</span></li>)}</ul>}
                <p className="text-[11px] text-slate-500 mt-2">The same vendor can legitimately bill several plans. Treat this as a question, not a verdict.</p>
              </section>
            )}
            <section className="rounded-lg bg-slate-900/60 p-4">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Review</p>
              <div className="flex flex-wrap gap-2">
                {([['keep', 'Keep'], ['review_for_cancellation', 'Review for cancellation'], ['cancelled', 'Mark cancelled'], ['not_subscription', 'Not a subscription']] as [string, string][]).map(([v, l]) => (
                  <button key={v} disabled={busy} onClick={() => act({ action: 'review', status: v })} className={`px-2.5 py-1 rounded text-[12px] border ${s.review?.status === v ? 'bg-slate-100 text-slate-900 border-slate-100' : 'border-slate-700 text-slate-300 hover:text-white'}`}>{l}</button>
                ))}
                {s.review && <button disabled={busy} onClick={() => act({ action: 'review', status: null })} className="text-[12px] text-slate-500 hover:text-white">clear review</button>}
              </div>
              {s.review && <p className="text-[11px] text-slate-500 mt-2">{s.review.status.replace(/_/g, ' ')} by {s.review.actor || '—'} · {s.review.updatedAt}</p>}
            </section>
            <section>
              <div className="flex items-baseline justify-between mb-1.5"><p className="text-[11px] uppercase tracking-wider text-slate-500">Source transactions ({d!.transactions.length})</p><p className="text-slate-200 tabular-nums">total {money(s.totalCents)}</p></div>
              <p className="text-[11px] text-slate-500 mb-2">Descriptions seen: {s.descriptions.join(' · ')}</p>
              <div className="overflow-x-auto rounded border border-slate-800">
                <table className="min-w-full text-[12px]">
                  <thead className="bg-slate-900/60 text-slate-500 uppercase text-[10px] tracking-wider"><tr><th className="px-2.5 py-1.5 text-left">Date</th><th className="px-2.5 py-1.5 text-left">Description</th><th className="px-2.5 py-1.5 text-left">Account</th><th className="px-2.5 py-1.5 text-left">Store</th><th className="px-2.5 py-1.5 text-right">Amount</th><th className="px-2.5 py-1.5"></th></tr></thead>
                  <tbody>{d!.transactions.map(t => (
                    <tr key={t.id} className="border-t border-slate-800/60">
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-300">{t.date}</td><td className="px-2.5 py-1.5 text-slate-200 max-w-[300px] truncate" title={t.description}>{t.description}</td><td className="px-2.5 py-1.5 whitespace-nowrap text-slate-400">{t.account}</td><td className="px-2.5 py-1.5 text-slate-400">{t.store_name || '—'}</td><td className="px-2.5 py-1.5 text-right tabular-nums text-slate-100">{money(Math.abs(t.amount_cents))}</td>
                      <td className="px-2.5 py-1.5"><Link href={`/dashboard/transactions?q=${encodeURIComponent((t.description || '').slice(0, 20))}`} className="text-[11px] text-slate-500 hover:text-white">ledger →</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

export default function SubscriptionsPage() {
  return <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}><SubscriptionsContent /></Suspense>;
}
