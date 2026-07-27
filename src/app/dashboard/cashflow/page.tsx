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
  landed: { chip: 'bg-green-800/60 text-green-200', label: '✓ landed' },
  in_transit: { chip: 'bg-blue-900/50 text-blue-300', label: 'in transit' },
  scheduled: { chip: 'bg-emerald-900/50 text-emerald-300', label: 'scheduled' },
  projected: { chip: 'bg-violet-900/50 text-violet-300', label: 'projected' },
};

export default function CashflowPage() {
  const [projection, setProjection] = useState<any>(null);
  const [storeId, setStoreId] = useState<string>('');
  const [gapsOpen, setGapsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<any>(null);
  const [planMeta, setPlanMeta] = useState<{ created_at?: string } | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');
  const [connections, setConnections] = useState<any[]>([]);
  const [connOpen, setConnOpen] = useState(false);
  const [connForm, setConnForm] = useState<{ storeId: string; domain: string; clientId: string; secret: string }>({ storeId: '', domain: '', clientId: '', secret: '' });
  const [connBusy, setConnBusy] = useState('');
  const [connMsg, setConnMsg] = useState('');
  const [syncing, setSyncing] = useState('');

  const load = (sid: string) => {
    setLoading(true);
    // cache-bust: defeat any edge/proxy cache so a fresh sync shows immediately
    const bust = Date.now();
    const url = `/api/cashflow?_=${bust}${sid ? `&storeId=${sid}` : ''}`;
    fetch(url, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!d.projection) console.warn('[cashflow] no projection in response');
        setProjection(d.projection || null);
      })
      .catch(e => console.error('[cashflow] fetch failed:', e))
      .finally(() => setLoading(false));
    fetch(`/api/cashflow/ai?storeId=${sid || 'all'}&_=${bust}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setPlan(d.plan || null); setPlanMeta(d.plan ? { created_at: d.created_at } : null); })
      .catch(e => console.error('[cashflow/ai] fetch failed:', e));
    fetch(`/api/shopify/credentials?_=${bust}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setConnections(d.credentials || []))
      .catch(() => {});
  };

  useEffect(() => { load(storeId); }, [storeId]);

  const saveConnection = async () => {
    const isPermanent = connForm.secret.trim().startsWith('shpat_');
    if (!connForm.storeId || !connForm.domain || !connForm.secret || (!isPermanent && !connForm.clientId)) {
      setConnMsg(isPermanent ? 'Store, domain and token required' : 'All four fields required (or paste a shpat_ permanent token as the secret)');
      return;
    }
    setConnBusy('saving'); setConnMsg('');
    try {
      const r = await fetch('/api/shopify/credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isPermanent
          ? { storeId: connForm.storeId, shopDomain: connForm.domain, permanentToken: connForm.secret.trim() }
          : { storeId: connForm.storeId, shopDomain: connForm.domain, clientId: connForm.clientId, clientSecret: connForm.secret }),
      });
      const d = await r.json();
      if (d.error) setConnMsg(`✗ ${d.error}`);
      else setConnMsg(`✓ Connected to ${d.probe?.shop} — payouts ${d.probe?.payouts_visible ? 'visible' : 'NOT visible (add the payments read scope)'}${d.warning ? ` · ${d.warning}` : ''}`);
      if (!d.error) { setConnForm({ storeId: '', domain: '', clientId: '', secret: '' }); load(storeId); }
    } catch (e: any) { setConnMsg(`✗ ${e?.message || 'failed'}`); }
    finally { setConnBusy(''); }
  };

  const syncNow = async (sid: string) => {
    setSyncing(sid);
    try {
      const r = await fetch('/api/shopify/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: sid }),
      });
      const d = await r.json();
      if (d.error) setConnMsg(`✗ sync: ${d.error}`);
      load(storeId);
    } catch (e: any) { setConnMsg(`✗ sync: ${e?.message || 'failed'}`); }
    finally { setSyncing(''); }
  };

  const connByStore = new Map(connections.map((c: any) => [c.store_id, c]));
  const agoLabel = (ts?: string | null) => {
    if (!ts) return 'never';
    const mins = Math.round((Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };

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
  // Unfiltered Shopify store list — the connections panel must show stores
  // with no data yet (that's what connecting is FOR); falls back for old API
  const allStores: { store_id: string; store_name: string }[] = projection?.all_stores || stores;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Cashflow</h1>
          <p className="text-sm text-slate-400 mt-1">When money lands, per date — live from Shopify, auto-synced every 30 min</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setConnOpen(v => !v)}
            className={`px-3 py-2 text-xs font-medium rounded-lg ${connOpen ? 'bg-slate-700 text-white' : 'bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
            ⚙ Connections{connections.length ? ` (${connections.length})` : ''}
          </button>
          {storeId && connByStore.has(storeId) && (
            <button onClick={() => syncNow(storeId)} disabled={!!syncing}
              className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
              {syncing ? 'Syncing…' : `↻ Sync now · last ${agoLabel(connByStore.get(storeId)?.last_synced_at)}`}
            </button>
          )}
          <select value={storeId} onChange={e => setStoreId(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-3 py-2">
            <option value="">All stores</option>
            {allStores.map((s: any) => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}
          </select>
        </div>
      </div>

      {connOpen && (
        <div className="mb-5 bg-slate-900 border border-slate-700 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-1">Shopify connections</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Paste each store&apos;s custom-app credentials once. The server mints a fresh 24-hour access token automatically whenever the old one expires — payouts, reserves, and chargebacks stay live forever with no re-entry.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              {allStores.map((s: any) => {
                const c = connByStore.get(s.store_id);
                return (
                  <div key={s.store_id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${c ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                      <span className="text-white font-medium">{s.store_name}</span>
                      {c && <span className="text-slate-500 font-mono text-[10px]">{c.shop_domain}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {c ? (
                        <>
                          <span className="text-slate-500 text-[10px]">synced {agoLabel(c.last_synced_at)}</span>
                          <button onClick={() => syncNow(s.store_id)} disabled={!!syncing}
                            className="px-2 py-1 bg-emerald-800/60 hover:bg-emerald-700 disabled:opacity-50 text-emerald-200 rounded text-[10px]">
                            {syncing === s.store_id ? 'syncing…' : '↻ sync'}
                          </button>
                        </>
                      ) : (
                        <button onClick={() => { setConnForm(f => ({ ...f, storeId: s.store_id })); }}
                          className="px-2 py-1 bg-blue-800/60 hover:bg-blue-700 text-blue-200 rounded text-[10px]">
                          + connect
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2">
              <select value={connForm.storeId} onChange={e => setConnForm(f => ({ ...f, storeId: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2">
                <option value="">Select store…</option>
                {allStores.map((s: any) => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}
              </select>
              <input value={connForm.domain} onChange={e => setConnForm(f => ({ ...f, domain: e.target.value }))}
                placeholder="Store domain — e.g. pc0bqy-zv.myshopify.com"
                className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 font-mono" />
              <input value={connForm.clientId} onChange={e => setConnForm(f => ({ ...f, clientId: e.target.value }))}
                placeholder={connForm.secret.trim().startsWith('shpat_') ? 'Client ID — not needed for shpat_ tokens' : 'Client ID'}
                disabled={connForm.secret.trim().startsWith('shpat_')}
                className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 font-mono disabled:opacity-40" />
              <input value={connForm.secret} onChange={e => setConnForm(f => ({ ...f, secret: e.target.value }))}
                placeholder="Secret (shpss_…) or permanent token (shpat_…)" type="password"
                className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 font-mono" />
              {connForm.secret.trim().startsWith('shpat_') && (
                <p className="text-[10px] text-emerald-400">Permanent token detected — saved as-is, never re-minted. Don&apos;t re-save this store with shpss_ creds later unless the app is installed.</p>
              )}
              <button onClick={saveConnection} disabled={connBusy === 'saving'}
                className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">
                {connBusy === 'saving' ? 'Connecting + verifying…' : 'Save & verify connection'}
              </button>
              {connMsg && <p className={`text-[11px] ${connMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{connMsg}</p>}
              <p className="text-[10px] text-slate-600">
                From the store&apos;s Shopify admin: Settings → Apps → Develop apps → your app → API credentials. Saving runs a live test against Shopify before accepting.
              </p>
            </div>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500 animate-pulse">Building projection…</p>}

      {!loading && !projection && <p className="text-sm text-red-400">No data loaded. Check console for errors.</p>}

      {!loading && projection && (
        <>
          {/* THE MATH — position, obligations, verdict */}
          {projection.position && (() => {
            const p = projection.position;
            const healthy = p.after_obligations_7d_cents >= 0;
            return (
              <div className={`mb-4 rounded-xl border px-4 py-3 ${healthy ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-rose-950/20 border-rose-800/50'}`}>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-2">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Cash now</p>
                    <p className="text-lg font-bold text-white">{cents(p.cash_available_cents)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">+ Incoming 7d</p>
                    <p className="text-lg font-bold text-emerald-400">{cents(p.incoming_7d_cents)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">− Ad burn × 7d</p>
                    <p className="text-lg font-bold text-orange-400">{cents(p.ad_burn_daily_cents * 7)}</p>
                    <p className="text-[10px] text-slate-500">{cents(p.ad_burn_daily_cents)}/day</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">− Owed (cards + FB)</p>
                    <p className="text-lg font-bold text-amber-400">{cents(p.cards_owed_cents + p.fb_unbilled_cents)}</p>
                    <p className="text-[10px] text-slate-500">{cents(p.cards_owed_cents)} cards · {cents(p.fb_unbilled_cents)} FB unbilled</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">= Net in 7 days</p>
                    <p className={`text-lg font-bold ${healthy ? 'text-emerald-400' : 'text-rose-400'}`}>{p.after_obligations_7d_cents < 0 ? '−' : ''}{cents(Math.abs(p.after_obligations_7d_cents))}</p>
                    <p className="text-[10px] text-slate-500">after everything owed</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Safe to pay today</p>
                    <p className="text-lg font-bold text-blue-300">{cents(p.safe_to_pay_today_cents)}</p>
                    <p className="text-[10px] text-slate-500">keeps 7 days of ad spend</p>
                  </div>
                </div>
                <p className="text-[11px] mt-2 text-slate-400">
                  {healthy
                    ? `✓ Covered — cash + this week's landings clear all obligations${p.clear_date ? ` by ${dayLabel(p.clear_date)}` : ''} while funding ads.`
                    : p.clear_date
                      ? `⚠ Short this week — obligations are fully covered by ${dayLabel(p.clear_date)} as landings arrive. Pay cards in steps, not all at once.`
                      : `⚠ Obligations exceed cash + the entire ${projection.horizon_days}-day horizon of landings — money must come from outside this projection.`}
                </p>
              </div>
            );
          })()}

          {/* Total incoming headline */}
          <div className="mb-4 bg-gradient-to-r from-emerald-950/40 to-slate-900 border border-emerald-800/40 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-emerald-400 uppercase tracking-wider">Total incoming</p>
              <p className="text-2xl font-bold text-white">{cents((t.landed_today_cents || 0) + t.in_transit_cents + t.scheduled_cents + (t.projected_cents || 0))}</p>
            </div>
            <p className="text-[11px] text-slate-400 text-right max-w-md">
              Every dollar Shopify is holding or moving for you, dated.<br />
              <span className="text-green-300">landed</span> = bank-confirmed · <span className="text-blue-300">arriving</span> = Shopify sent it (±1 day) · <span className="text-emerald-300">scheduled</span> = date committed · <span className="text-violet-300">projected</span> = your sales, dated by measured delay
            </p>
          </div>

          {/* Totals strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <div className="bg-slate-900 border border-green-800/50 rounded-xl p-3">
              <p className="text-[10px] text-green-400 uppercase tracking-wider">✓ Landed today</p>
              <p className="text-lg font-bold text-white">{cents(t.landed_today_cents || 0)}</p>
              <p className="text-[10px] text-slate-500">bank-confirmed deposits</p>
            </div>
            <div className="bg-slate-900 border border-blue-900/40 rounded-xl p-3">
              <p className="text-[10px] text-blue-400 uppercase tracking-wider">Paid out — arriving</p>
              <p className="text-lg font-bold text-white">{cents(t.in_transit_cents)}</p>
              <p className="text-[10px] text-slate-500">Shopify sent it; bank not confirmed yet</p>
            </div>
            <div className="bg-slate-900 border border-emerald-900/40 rounded-xl p-3">
              <p className="text-[10px] text-emerald-400 uppercase tracking-wider">Scheduled</p>
              <p className="text-lg font-bold text-white">{cents(t.scheduled_cents)}</p>
              <p className="text-[10px] text-slate-500">date committed by Shopify</p>
            </div>
            <div className="bg-slate-900 border border-violet-900/40 rounded-xl p-3">
              <p className="text-[10px] text-violet-400 uppercase tracking-wider">Projected</p>
              <p className="text-lg font-bold text-white">{cents(t.projected_cents || 0)}</p>
              <p className="text-[10px] text-slate-500">sales made, payout date pending</p>
            </div>
            <div className="bg-slate-900 border border-amber-900/40 rounded-xl p-3">
              <p className="text-[10px] text-amber-400 uppercase tracking-wider">Reserves held</p>
              <p className="text-lg font-bold text-white">{cents(t.reserves_held_cents)}</p>
              <p className="text-[10px] text-slate-500">held by Shopify — not spendable</p>
            </div>
            <div className="bg-slate-900 border border-rose-900/40 rounded-xl p-3">
              <p className="text-[10px] text-rose-400 uppercase tracking-wider">Losses 30d</p>
              <p className="text-lg font-bold text-white">{cents((t.refunds_30d_cents || 0) + (t.chargebacks_30d_cents || 0))}</p>
              <p className="text-[10px] text-slate-500">{cents(t.refunds_30d_cents || 0)} refunds · {cents(t.chargebacks_30d_cents || 0)} chargebacks</p>
            </div>
          </div>

          {/* Data notes — collapsed by default; the math above is the signal */}
          {projection.data_gaps.length > 0 && (
            <div className="mb-4 bg-slate-900/60 border border-slate-800 rounded-lg">
              <button onClick={() => setGapsOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2 text-left">
                <span className="text-[11px] text-amber-400/90">⚠ {projection.data_gaps.length} data note{projection.data_gaps.length === 1 ? '' : 's'} <span className="text-slate-500">— coverage &amp; verification, not incoming money</span></span>
                <span className="text-slate-500 text-xs">{gapsOpen ? '▾ hide' : '▸ show'}</span>
              </button>
              {gapsOpen && (
                <div className="px-4 pb-3 max-h-56 overflow-y-auto">
                  {projection.data_gaps.map((g: string, i: number) => (
                    <p key={i} className="text-[11px] text-amber-300/80 mt-0.5">⚠ {g}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
            {/* Landing calendar */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-white">Landing calendar</h2>
                <p className="text-[10px] text-slate-500">Live from Shopify — what arrives in your bank, each day. Click a day for the breakdown.</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase">
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-right px-2 py-2">Landing</th>
                    <th className="text-right px-2 py-2">Cumulative</th>
                    <th className="text-right px-4 py-2" title="cash now + landings through this day − daily ad burn">Position</th>
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
                        <td className="px-2 py-2 text-right font-mono text-slate-400">{cents(day.cumulative_cents)}</td>
                        <td className={`px-4 py-2 text-right font-mono ${day.position_cents >= 0 ? 'text-slate-200' : 'text-rose-400 font-bold'}`}>
                          {day.position_cents != null ? cents(day.position_cents) : '—'}
                        </td>
                      </tr>
                      {expandedDates.has(day.date) && day.events.map((e: any, i: number) => (
                        <tr key={`${day.date}-${i}`} className="bg-slate-800/30">
                          <td className="px-4 py-1 pl-8 text-slate-400">{e.store_name}</td>
                          <td className="px-2 py-1 text-slate-500" colSpan={2}>
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
