'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { readGlobalStore, writeGlobalStore, onGlobalStoreChange } from '@/components/GlobalStore';

/** Cashflow — one screen that answers, per Shopify store or for all of them:
 *  what is in the bank, what lands when, what is owed, and what is safe to
 *  pay today. Every number comes from the same source as the page that owns
 *  it (Bank Accounts, Credit Cards, CFO, Subscriptions, Ad accounts) and
 *  links back to it. Unknown is shown as unknown, never $0. */

const money = (n: number | null | undefined, opts: { sign?: boolean } = {}) =>
  n == null ? '—' : `${opts.sign && n < 0 ? '−' : ''}${(Math.abs(n) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
function ago(ts?: string | null) {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - new Date(ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z')).getTime()) / 60000);
  if (mins < 1) return 'just now'; if (mins < 60) return `${mins}m ago`; if (mins < 1440) return `${Math.round(mins / 60)}h ago`; return `${Math.round(mins / 1440)}d ago`;
}
const stale = (ts?: string | null, hours = 24) => !ts || Date.now() - new Date(ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z')).getTime() > hours * 3600e3;

const KIND: Record<string, { chip: string; label: string }> = {
  landed: { chip: 'bg-emerald-500/15 text-emerald-300', label: 'landed ✓' },
  in_transit: { chip: 'bg-blue-500/15 text-blue-300', label: 'arriving' },
  scheduled: { chip: 'bg-teal-500/15 text-teal-300', label: 'scheduled' },
  projected: { chip: 'bg-violet-500/15 text-violet-300', label: 'projected' },
};

type Figure = { cents: number | null; asOf?: string | null; note?: string; href?: string; rows?: { label: string; cents: number; note?: string }[] };

function Tile({ label, value, tone = 'text-slate-100', sub, href }: { label: string; value: string; tone?: string; sub?: string; href?: string }) {
  const body = (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums leading-tight mt-0.5 ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-lg -m-2 p-2 hover:bg-slate-800/40">{body}</Link> : body;
}

function ObligationRow({ name, f, included, open, onToggle }: { name: string; f: Figure; included: boolean; open: boolean; onToggle: () => void }) {
  const hasRows = !!f.rows?.length;
  return (
    <>
      <tr className={`border-t border-slate-800/50 ${hasRows ? 'cursor-pointer hover:bg-slate-800/30' : ''}`} onClick={hasRows ? onToggle : undefined}>
        <td className="px-4 py-2.5">
          <span className="text-[13px] text-slate-100 font-medium">{name}</span>
          {hasRows && <span className="ml-1.5 text-slate-600 text-xs">{open ? '▾' : '▸'}</span>}
          {f.note && <span className="block text-[11px] text-slate-500">{f.note}</span>}
        </td>
        <td className="px-3 py-2.5 text-[11px] text-slate-500 whitespace-nowrap">{f.asOf ? <span className={stale(f.asOf) ? 'text-amber-400' : ''}>{ago(f.asOf)}</span> : ''}</td>
        <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${f.cents == null ? 'text-slate-500' : included ? 'text-slate-100' : 'text-slate-400'}`} title={included ? 'in the 7-day total' : 'shown for context, not in the 7-day total'}>
          {money(f.cents)}{!included && f.cents != null && <span className="ml-1 text-[10px] font-normal text-slate-500">info</span>}
        </td>
        <td className="pr-4 py-2.5 text-right">{f.href && <Link href={f.href} className="text-[11px] text-blue-300 hover:text-blue-200" onClick={e => e.stopPropagation()}>open →</Link>}</td>
      </tr>
      {open && f.rows?.map((r, i) => (
        <tr key={i} className="bg-slate-950/40">
          <td className="pl-8 pr-4 py-1.5 text-[12px] text-slate-300 truncate max-w-[420px]" title={r.label}>{r.label}</td>
          <td className="px-3 py-1.5 text-[11px] text-slate-500">{r.note || ''}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-[12px] text-slate-300">{money(r.cents)}</td>
          <td />
        </tr>
      ))}
    </>
  );
}

export default function CashflowPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storeId, setStoreId] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [gapsOpen, setGapsOpen] = useState(false);
  const [feedsOpen, setFeedsOpen] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState<any[]>([]);
  const [connForm, setConnForm] = useState({ storeId: '', domain: '', clientId: '', secret: '' });
  const [connBusy, setConnBusy] = useState('');
  const [connMsg, setConnMsg] = useState('');
  const [syncing, setSyncing] = useState('');

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('storeId');
    if (fromUrl) { writeGlobalStore(fromUrl); setStoreId(fromUrl); } else setStoreId(readGlobalStore());
    return onGlobalStoreChange(setStoreId);
  }, []);

  const load = useCallback((sid: string) => {
    setLoading(true); setError('');
    fetch(`/api/cashflow?_=${Date.now()}${sid ? `&storeId=${sid}` : ''}`, { cache: 'no-store' })
      .then(r => r.json()).then(d => { if (d.error) setError(d.error); setData(d.error ? null : d); })
      .catch(e => setError(e?.message || 'failed')).finally(() => setLoading(false));
    fetch(`/api/shopify/credentials?_=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).then(d => setConnections(d.credentials || [])).catch(() => {});
  }, []);
  useEffect(() => { load(storeId); }, [storeId, load]);

  const selectStore = (sid: string) => { setStoreId(sid); writeGlobalStore(sid); const u = new URL(window.location.href); sid ? u.searchParams.set('storeId', sid) : u.searchParams.delete('storeId'); window.history.replaceState(null, '', u.toString()); };
  const toggle = (k: string) => setOpen(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleDate = (d: string) => setExpandedDates(p => { const n = new Set(p); n.has(d) ? n.delete(d) : n.add(d); return n; });

  const syncNow = async (sid: string) => {
    setSyncing(sid);
    try { const d = await fetch('/api/shopify/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: sid }) }).then(r => r.json()); if (d.error) setConnMsg(`✗ sync: ${d.error}`); load(storeId); }
    catch (e: any) { setConnMsg(`✗ sync: ${e?.message || 'failed'}`); } finally { setSyncing(''); }
  };
  const saveConnection = async () => {
    const permanent = connForm.secret.trim().startsWith('shpat_');
    if (!connForm.storeId || !connForm.domain || !connForm.secret || (!permanent && !connForm.clientId)) { setConnMsg(permanent ? 'Store, domain and token required' : 'All four fields required (or paste a shpat_ permanent token as the secret)'); return; }
    setConnBusy('saving'); setConnMsg('');
    try {
      const d = await fetch('/api/shopify/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(permanent ? { storeId: connForm.storeId, shopDomain: connForm.domain, permanentToken: connForm.secret.trim() } : { storeId: connForm.storeId, shopDomain: connForm.domain, clientId: connForm.clientId, clientSecret: connForm.secret }) }).then(r => r.json());
      if (d.error) setConnMsg(`✗ ${d.error}`); else { setConnMsg(`✓ Connected to ${d.probe?.shop} — payouts ${d.probe?.payouts_visible ? 'visible' : 'NOT visible (add the payments read scope)'}`); setConnForm({ storeId: '', domain: '', clientId: '', secret: '' }); load(storeId); }
    } catch (e: any) { setConnMsg(`✗ ${e?.message || 'failed'}`); } finally { setConnBusy(''); }
  };

  const p = data?.position; const pr = data?.projection; const pos = pr?.position; const t = pr?.totals; const ob = p?.obligations;
  const allStores: { store_id: string; store_name: string }[] = pr?.all_stores || [];
  const connByStore = new Map(connections.map((c: any) => [c.store_id, c]));
  const incoming14 = t ? (t.landed_today_cents || 0) + t.in_transit_cents + t.scheduled_cents + (t.projected_cents || 0) : 0;
  const net7 = pos?.after_obligations_7d_cents as number | undefined;
  const cashUnknown = !!pos?.cash_unknown;
  const healthy = !cashUnknown && net7 != null && net7 >= 0;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Cashflow{p ? <span className="text-slate-400 font-medium"> · {p.scope.storeName}</span> : null}</h1>
          <p className="text-sm text-slate-400 mt-1">Shopify stores only: cash in the bank, what lands when, what is owed, and what is safe to pay today.</p>
          {p?.scope?.note && <p className="text-[12px] text-amber-300 mt-1">{p.scope.note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p && (
            <div className="flex items-center gap-1.5 text-[11px] mr-1">
              {[['Bank', p.freshness.bank, 24], ['Shopify', p.freshness.shopify, 2], ['Meta', p.freshness.fb, 12]].map(([n, ts, h]: any) => (
                <span key={n} className={`px-2 py-1 rounded-md border ${stale(ts, h) ? 'border-amber-500/40 text-amber-300' : 'border-slate-700 text-slate-400'}`} title={ts || 'never synced'}>{n} {ago(ts)}</span>
              ))}
              {data?.syncing?.length > 0 && <span className="text-slate-500">syncing…</span>}
            </div>
          )}
          <button onClick={() => load(storeId)} className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800">↻ Refresh</button>
          {storeId && connByStore.has(storeId) && (
            <button onClick={() => syncNow(storeId)} disabled={!!syncing} className="px-3 py-2 text-xs font-medium rounded-lg bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-50 text-white">{syncing ? 'Syncing…' : 'Sync Shopify now'}</button>
          )}
          <button onClick={() => setFeedsOpen(v => !v)} className={`px-3 py-2 text-xs font-medium rounded-lg border ${feedsOpen ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'}`}>Feeds{connections.length ? ` (${connections.length})` : ''}</button>
        </div>
      </div>

      {feedsOpen && (
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
          <p className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider mb-1">Shopify feeds</p>
          <p className="text-[11px] text-slate-500 mb-3">One custom-app credential per store. Payouts, reserves and chargebacks sync every 30 minutes and whenever a page finds them stale. Bank balances come from Bank Accounts; Meta balances from Facebook Accounts.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              {allStores.map(s => { const c = connByStore.get(s.store_id); return (
                <div key={s.store_id} className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2 text-xs">
                  <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${c ? (stale(c.last_synced_at, 2) ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-slate-600'}`} /><span className="text-white font-medium">{s.store_name}</span>{c && <span className="text-slate-500 font-mono text-[10px]">{c.shop_domain}</span>}</span>
                  <span className="flex items-center gap-2">
                    {c ? <><span className="text-slate-500 text-[10px]">synced {ago(c.last_synced_at)}</span><button onClick={() => syncNow(s.store_id)} disabled={!!syncing} className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 text-[10px]">{syncing === s.store_id ? 'syncing…' : '↻ sync'}</button></>
                      : <button onClick={() => setConnForm(f => ({ ...f, storeId: s.store_id }))} className="px-2 py-1 rounded bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 text-[10px]">+ connect</button>}
                  </span>
                </div>); })}
            </div>
            <div className="space-y-2">
              <select value={connForm.storeId} onChange={e => setConnForm(f => ({ ...f, storeId: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2"><option value="">Select store…</option>{allStores.map(s => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}</select>
              <input value={connForm.domain} onChange={e => setConnForm(f => ({ ...f, domain: e.target.value }))} placeholder="Store domain — e.g. pc0bqy-zv.myshopify.com" className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 font-mono" />
              <input value={connForm.clientId} onChange={e => setConnForm(f => ({ ...f, clientId: e.target.value }))} placeholder={connForm.secret.trim().startsWith('shpat_') ? 'Client ID — not needed for shpat_ tokens' : 'Client ID'} disabled={connForm.secret.trim().startsWith('shpat_')} className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 font-mono disabled:opacity-40" />
              <input value={connForm.secret} onChange={e => setConnForm(f => ({ ...f, secret: e.target.value }))} placeholder="Secret (shpss_…) or permanent token (shpat_…)" type="password" className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 font-mono" />
              <button onClick={saveConnection} disabled={connBusy === 'saving'} className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">{connBusy === 'saving' ? 'Connecting + verifying…' : 'Save & verify connection'}</button>
              {connMsg && <p className={`text-[11px] ${connMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{connMsg}</p>}
            </div>
          </div>
        </div>
      )}

      {loading && !data && <p className="text-sm text-slate-500 animate-pulse">Loading position…</p>}
      {error && <p className="text-sm text-red-400">Could not load: {error}</p>}

      {data && p && pos && (
        <>
          {/* ── Position today ── */}
          <section className={`rounded-xl border px-5 py-4 ${cashUnknown ? 'bg-slate-900/60 border-slate-800' : healthy ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-rose-500/5 border-rose-500/25'}`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">Position today · {p.scope.storeName}</p>
              <p className="text-[11px] text-slate-500">{dayLabel(pr.generated_at_date)} · {data.took_ms} ms</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-4">
              <Tile label="Cash in bank" value={money(p.cash.cents)} href={p.cash.href}
                sub={p.cash.cents == null ? p.cash.note : `${p.cash.rows?.length || 0} account${p.cash.rows?.length === 1 ? '' : 's'} · ${ago(p.cash.asOf)}`} />
              <Tile label="+ Landing next 7 days" value={money(pos.incoming_7d_cents, { sign: true })} tone="text-emerald-300" sub={`${money(incoming14)} over ${pr.horizon_days} days`} />
              <Tile label="− Owed in 7 days" value={money(ob.totalCents)} tone="text-amber-300" sub={`cards ${money(ob.cardCharges.cents)} · Meta ${money(ob.fbUnbilled.cents)} · ads ${money(ob.adBurn7d.cents)}`} />
              <Tile label="= Net after 7 days" value={cashUnknown ? '—' : money(net7, { sign: true })} tone={cashUnknown ? 'text-slate-500' : healthy ? 'text-emerald-300' : 'text-rose-300'} sub={cashUnknown ? 'needs a bank account on this store' : 'cash + landings − everything owed'} />
              <Tile label="Safe to pay today" value={money(pos.safe_to_pay_today_cents)} tone="text-blue-300" sub="keeps 7 days of ad spend in the bank" />
              <Tile label="Obligations clear by" value={pos.clear_date ? dayLabel(pos.clear_date) : cashUnknown ? '—' : 'beyond ' + pr.horizon_days + 'd'} tone={pos.clear_date ? 'text-slate-100' : 'text-rose-300'} sub={pos.clear_date ? 'first day landings cover what is owed' : cashUnknown ? '' : 'money must come from outside this view'} />
            </div>
            <p className="text-[12px] mt-3 text-slate-300">
              {cashUnknown
                ? <>No bank account is assigned to {p.scope.storeName}, so its position cannot be computed. Assign one on <Link href="/dashboard/banking" className="text-blue-300">Bank Accounts</Link>.</>
                : healthy
                  ? <>✓ Covered. Cash plus this week&apos;s landings clear everything owed{pos.clear_date ? ` by ${dayLabel(pos.clear_date)}` : ''} while funding ads.</>
                  : pos.clear_date
                    ? <>⚠ Short this week. Landings cover what is owed by {dayLabel(pos.clear_date)}. Pay cards in steps as money lands, not all at once.</>
                    : <>⚠ What is owed exceeds cash plus every landing in the next {pr.horizon_days} days.</>}
            </p>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.1fr] gap-5">
            {/* ── What is owed ── */}
            <section className="rounded-xl bg-slate-900/60 overflow-hidden self-start">
              <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between">
                <p className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">What is owed</p>
                <p className="text-[11px] text-slate-500">each line is the same number its own page shows</p>
              </div>
              <table className="w-full">
                <tbody>
                  <ObligationRow name={storeId && !p.scope.note ? 'Card charges paired to this store' : 'Card charges paired to Shopify stores'} f={ob.cardCharges} included open={open.has('cards')} onToggle={() => toggle('cards')} />
                  <ObligationRow name="Card payments already leaving" f={{ ...ob.inFlight, note: ob.inFlight.note || 'logged payments the bank has not debited yet — inside card debt, shown so you do not pay twice' }} included={false} open={open.has('inflight')} onToggle={() => toggle('inflight')} />
                  <ObligationRow name="Meta unbilled ad spend" f={ob.fbUnbilled} included open={open.has('fb')} onToggle={() => toggle('fb')} />
                  <ObligationRow name="Subscriptions due in 14 days" f={ob.recurringDue14d} included open={open.has('subs')} onToggle={() => toggle('subs')} />
                  <ObligationRow name="Ad spend, next 7 days" f={ob.adBurn7d} included open={false} onToggle={() => {}} />
                  {ob.manualCards.cents > 0 && <ObligationRow name="Manual liabilities (no due date)" f={ob.manualCards} included={false} open={open.has('manual')} onToggle={() => toggle('manual')} />}
                  <tr className="border-t border-slate-700/60 bg-slate-950/40">
                    <td className="px-4 py-2.5 text-[13px] font-semibold text-slate-100">Owed in the next 7 days</td><td />
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold text-amber-300">{money(ob.totalCents)}</td><td />
                  </tr>
                </tbody>
              </table>
            </section>

            {/* ── Incoming ── */}
            <section className="rounded-xl bg-slate-900/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between">
                <p className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">Landing calendar</p>
                <p className="text-[11px] text-slate-500">from Shopify · click a day for the breakdown</p>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-slate-800/40 border-b border-slate-800/60 text-center">
                {[['Landed today', t.landed_today_cents || 0, 'text-emerald-300'], ['Arriving', t.in_transit_cents, 'text-blue-300'], ['Scheduled', t.scheduled_cents, 'text-teal-300'], ['Projected', t.projected_cents || 0, 'text-violet-300'], ['Reserves held', t.reserves_held_cents, 'text-amber-300'], ['Losses 30d', (t.refunds_30d_cents || 0) + (t.chargebacks_30d_cents || 0), 'text-rose-300']].map(([l, v, c]: any) => (
                  <div key={l} className="bg-slate-900/80 px-2 py-2"><p className="text-[10px] uppercase tracking-wider text-slate-500">{l}</p><p className={`text-[13px] font-semibold tabular-nums ${c}`}>{money(v, { sign: true })}</p></div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500"><th className="text-left px-4 py-2">Day</th><th className="text-right px-2 py-2">Lands</th><th className="text-right px-2 py-2">Cumulative</th><th className="text-right px-4 py-2" title="cash + landings through this day − daily ad spend">Bank position</th></tr></thead>
                  <tbody>
                    {pr.calendar.map((day: any) => (
                      <FragmentRow key={day.date} day={day} today={pr.generated_at_date} open={expandedDates.has(day.date)} onToggle={() => day.events.length && toggleDate(day.date)} showStore={!storeId} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* ── Stores (all-stores view) ── */}
          {p.storeRows && (
            <section className="rounded-xl bg-slate-900/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between">
                <p className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">Per store</p>
                <p className="text-[11px] text-slate-500">click a store for its own position</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="text-left px-4 py-2">Store</th><th className="text-right px-2 py-2">Cash</th><th className="text-right px-2 py-2">Landing {pr.horizon_days}d</th><th className="text-right px-2 py-2">Card charges</th><th className="text-right px-2 py-2">Meta unbilled</th><th className="text-right px-2 py-2">Subs 14d</th><th className="text-right px-2 py-2">Ads / day</th><th className="text-right px-2 py-2">Reserves</th><th className="text-right px-4 py-2">Losses 30d</th>
                  </tr></thead>
                  <tbody>
                    {p.storeRows.map((r: any) => {
                      const s = (pr.stores || []).find((x: any) => x.store_id === r.storeId);
                      const landing = s ? (s.landed_today_cents || 0) + s.in_transit_cents + s.scheduled_cents + (s.projected_cents || 0) : null;
                      return (
                        <tr key={r.storeId} onClick={() => selectStore(r.storeId)} className="border-t border-slate-800/50 cursor-pointer hover:bg-slate-800/30">
                          <td className="px-4 py-2 text-slate-100 font-medium">{r.storeName}{s?.landing_lag_days != null && <span className="ml-1.5 text-[10px] text-slate-500">lands +{s.landing_lag_days}d</span>}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-200" title={r.cashCents == null ? 'no bank account assigned' : ''}>{money(r.cashCents)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-emerald-300">{money(landing, { sign: true })}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-200">{money(r.cardChargesCents)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-200">{money(r.fbCents)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-200">{money(r.recurring14dCents)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-400">{money(s?.avg_daily_ad_burn_cents ?? null)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-amber-300">{money(s?.reserves_held_cents ?? null)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-rose-300">{s ? money((s.refunds_30d_cents || 0) + (s.chargebacks_30d_cents || 0), { sign: true }) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {pr.data_gaps?.length > 0 && (
            <div className="rounded-xl bg-slate-900/60">
              <button onClick={() => setGapsOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-2.5 text-left">
                <span className="text-[11px] text-amber-300">⚠ {pr.data_gaps.length} data note{pr.data_gaps.length === 1 ? '' : 's'} <span className="text-slate-500">— coverage and verification, not incoming money</span></span>
                <span className="text-slate-500 text-xs">{gapsOpen ? 'hide' : 'show'}</span>
              </button>
              {gapsOpen && <div className="px-4 pb-3 max-h-56 overflow-y-auto">{pr.data_gaps.map((g: string, i: number) => <p key={i} className="text-[11px] text-amber-300/80 mt-0.5">⚠ {g}</p>)}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FragmentRow({ day, today, open, onToggle, showStore }: { day: any; today: string; open: boolean; onToggle: () => void; showStore: boolean }) {
  return (
    <>
      <tr onClick={onToggle} className={`border-t border-slate-800/50 ${day.events.length ? 'cursor-pointer hover:bg-slate-800/30' : ''} ${day.confirmed_cents > 0 ? 'bg-emerald-500/5' : ''}`}>
        <td className="px-4 py-1.5 text-slate-300 whitespace-nowrap">{dayLabel(day.date)}{day.date === today && <span className="ml-1.5 text-[9px] bg-blue-500/15 text-blue-300 px-1 rounded">today</span>}{day.events.length > 0 && <span className="ml-1.5 text-slate-600">{open ? '▾' : '▸'}</span>}</td>
        <td className={`px-2 py-1.5 text-right tabular-nums ${day.confirmed_cents > 0 ? 'text-emerald-300 font-semibold' : day.confirmed_cents < 0 ? 'text-rose-300' : 'text-slate-600'}`}>{day.confirmed_cents !== 0 ? money(day.confirmed_cents, { sign: true }) : '—'}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{money(day.cumulative_cents, { sign: true })}</td>
        <td className={`px-4 py-1.5 text-right tabular-nums ${day.position_cents == null ? 'text-slate-600' : day.position_cents >= 0 ? 'text-slate-200' : 'text-rose-300 font-semibold'}`}>{money(day.position_cents, { sign: true })}</td>
      </tr>
      {open && day.events.map((e: any, i: number) => (
        <tr key={i} className="bg-slate-950/40">
          <td className="pl-8 pr-2 py-1 text-slate-400 whitespace-nowrap">{showStore ? e.store_name : ''}</td>
          <td className="px-2 py-1 text-slate-500" colSpan={2}><span className={`text-[9px] px-1.5 py-0.5 rounded mr-1.5 ${(KIND[e.kind] || KIND.scheduled).chip}`}>{(KIND[e.kind] || KIND.scheduled).label}</span>{e.source}</td>
          <td className="px-4 py-1 text-right tabular-nums text-slate-300">{money(e.amount_cents, { sign: true })}</td>
        </tr>
      ))}
    </>
  );
}
