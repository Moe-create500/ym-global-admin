'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

interface Store { id: string; name: string }
interface Product { id: string; title: string; price_cents: number | null }
interface FBProfile { id: string; profile_name: string; ad_account_id: string; ad_account_name: string | null; fb_page_id: string | null; fb_page_name: string | null; pixel_id: string | null }
interface FBPage { id: string; name: string }
interface Step { key: string; label: string; status: 'pending' | 'done' | 'error'; detail?: string }
interface Workflow {
  id: string; storeId: string; productId: string; name: string; status: string;
  steps: Step[]; config: any; result: any; error: string | null; createdAt: string;
}

const HIDDEN_STORES = ['apex loom', 'neeyahpure', 'vitaedge', 'ymo - amazon', 'zen essential', 'zenchoice'];

export default function LaunchWorkflowPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');

  const [profiles, setProfiles] = useState<FBProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [pages, setPages] = useState<FBPage[]>([]);
  const [pageId, setPageId] = useState('');
  const [pagesLoading, setPagesLoading] = useState(false);

  const [landingUrl, setLandingUrl] = useState('');
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [adCount, setAdCount] = useState(10);
  const [dailyBudget, setDailyBudget] = useState('10');
  const [launchActive, setLaunchActive] = useState(false);

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [active, setActive] = useState<Workflow | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const runningRef = useRef(false);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => {
      const s = (d.stores || []).filter((st: Store) => !HIDDEN_STORES.includes(st.name.trim().toLowerCase()));
      setStores(s);
      if (s.length) setStoreId(s[0].id);
    }).catch(() => {});
  }, []);

  const loadStoreData = useCallback((sid: string) => {
    fetch(`/api/products?storeId=${sid}&onBrand=1`).then(r => r.json()).then(d => setProducts(d.products || [])).catch(() => {});
    fetch(`/api/static-ads/workflow?storeId=${sid}`).then(r => r.json()).then(d => {
      setWorkflows(d.workflows || []);
      setProfiles(d.profiles || []);
      setShopifyDomain(d.shopifyDomain || '');
      if (d.shopifyDomain) setLandingUrl(`https://${d.shopifyDomain}/`);
      if ((d.profiles || []).length === 1) setProfileId(d.profiles[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!storeId) return;
    setProductId(''); setProfileId(''); setPages([]); setPageId(''); setActive(null);
    loadStoreData(storeId);
  }, [storeId, loadStoreData]);

  useEffect(() => {
    if (!profileId) { setPages([]); setPageId(''); return; }
    setPagesLoading(true);
    fetch(`/api/static-ads/workflow?profileId=${profileId}&pages=1`).then(r => r.json()).then(d => {
      setPages(d.pages || []);
      const saved = d.savedPageId;
      if (saved && (d.pages || []).some((p: FBPage) => p.id === saved)) setPageId(saved);
      else if ((d.pages || []).length === 1) setPageId(d.pages[0].id);
      setPagesLoading(false);
    }).catch(() => setPagesLoading(false));
  }, [profileId]);

  const ready = storeId && productId && profileId && pageId && landingUrl.startsWith('http');
  const profile = profiles.find(p => p.id === profileId);

  async function advanceLoop(wfId: string) {
    runningRef.current = true;
    setRunning(true);
    while (runningRef.current) {
      try {
        const res = await fetch('/api/static-ads/workflow', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'advance', id: wfId }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'advance failed');
        setActive(d.workflow);
        if (d.workflow.status !== 'running') break;
      } catch (e: any) {
        setError(e.message);
        break;
      }
    }
    runningRef.current = false;
    setRunning(false);
    loadStoreData(storeId);
  }

  async function startWorkflow() {
    if (!ready) return;
    setError('');
    try {
      const res = await fetch('/api/static-ads/workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', storeId, productId,
          config: {
            profileId, pageId, landingUrl, adCount,
            dailyBudgetCents: Math.round(parseFloat(dailyBudget || '10') * 100),
            launchStatus: launchActive ? 'ACTIVE' : 'PAUSED',
          },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'create failed');
      setActive(d.workflow);
      void advanceLoop(d.workflow.id);
    } catch (e: any) { setError(e.message); }
  }

  async function retryWorkflow(wf: Workflow) {
    setError('');
    const res = await fetch('/api/static-ads/workflow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry', id: wf.id }),
    });
    const d = await res.json();
    if (res.ok) { setActive(d.workflow); void advanceLoop(wf.id); }
    else setError(d.error || 'retry failed');
  }

  const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500';
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5';

  const doneCount = active ? active.steps.filter(s => s.status === 'done').length : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">🚀 Launch Workflow</h1>
          <p className="text-sm text-slate-400 mt-1">Product in → audience + copy + picture ads + live FB campaign out. Every step resumable.</p>
        </div>
        <Link href="/dashboard/static-ads" className="text-xs text-blue-400 hover:text-blue-300">← Picture Ads</Link>
      </div>

      {error && <div className="mb-4 bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 h-fit">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Store</label>
              <select value={storeId} onChange={e => setStoreId(e.target.value)} className={inputCls}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Product</label>
              <select value={productId} onChange={e => setProductId(e.target.value)} className={inputCls}>
                <option value="">— select —</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>FB Ad Account</label>
              <select value={profileId} onChange={e => setProfileId(e.target.value)} className={inputCls}>
                <option value="">— select —</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.profile_name || p.ad_account_name || p.ad_account_id}</option>)}
              </select>
              {profile && !profile.pixel_id && (
                <p className="text-[10px] text-amber-400 mt-1">No pixel on this profile — ad set will optimize for link clicks</p>
              )}
            </div>
            <div>
              <label className={labelCls}>FB Page</label>
              <select value={pageId} onChange={e => setPageId(e.target.value)} className={inputCls} disabled={pagesLoading}>
                <option value="">{pagesLoading ? 'loading pages…' : '— select —'}</option>
                {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Landing page URL</label>
            <input value={landingUrl} onChange={e => setLandingUrl(e.target.value)}
              placeholder={shopifyDomain ? `https://${shopifyDomain}/products/…` : 'https://…'} className={inputCls} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Picture ads</label>
              <input type="number" min={1} max={20} value={adCount}
                onChange={e => setAdCount(Math.min(Math.max(Number(e.target.value) || 1, 1), 20))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Daily budget $</label>
              <input type="number" min={1} step="1" value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Go live?</label>
              <button onClick={() => setLaunchActive(v => !v)}
                className={`w-full rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
                  launchActive ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                {launchActive ? 'ACTIVE on launch' : 'Launch PAUSED'}
              </button>
            </div>
          </div>

          <button onClick={startWorkflow} disabled={!ready || running}
            className="w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 text-white font-semibold rounded-lg py-3 transition-colors">
            {running ? 'Workflow running…' : `Launch: audience + copy + ${adCount} ads + campaign`}
          </button>
          {launchActive && (
            <p className="text-[11px] text-amber-400">Ads go LIVE immediately at ${dailyBudget}/day. Launch paused instead to review in Ads Manager first.</p>
          )}
        </div>

        {/* Progress */}
        <div className="space-y-4">
          {active && (
            <div className="bg-slate-900 border border-blue-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-white font-medium">{active.name}</p>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                  active.status === 'done' ? 'bg-emerald-900/50 text-emerald-400'
                  : active.status === 'error' ? 'bg-red-900/50 text-red-400'
                  : 'bg-blue-900/50 text-blue-400'
                }`}>{active.status === 'running' && running ? `running ${doneCount}/${active.steps.length}` : active.status}</span>
              </div>
              <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
                {active.steps.map(s => (
                  <div key={s.key} className="flex items-start gap-2 text-sm py-0.5">
                    <span className="w-4 flex-shrink-0 mt-0.5">
                      {s.status === 'done' ? <span className="text-emerald-400">✓</span>
                        : s.status === 'error' ? <span className="text-red-400">✗</span>
                        : running && active.steps.find(x => x.status !== 'done')?.key === s.key
                          ? <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                          : <span className="text-slate-600">○</span>}
                    </span>
                    <span className={s.status === 'done' ? 'text-slate-300' : s.status === 'error' ? 'text-red-300' : 'text-slate-500'}>
                      {s.label}
                      {s.detail && <span className="text-slate-500"> — {s.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
              {active.status === 'error' && !running && (
                <button onClick={() => retryWorkflow(active)}
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg py-2">
                  Retry failed step + continue
                </button>
              )}
              {active.status === 'done' && active.result?.campaignId && (
                <a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${(profiles.find(p => p.id === active.config?.profileId)?.ad_account_id || '').replace('act_', '')}`}
                  target="_blank" rel="noreferrer"
                  className="mt-3 block text-center bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg py-2">
                  ✓ Done — open Ads Manager
                </a>
              )}
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className={labelCls}>Past workflows</p>
            {workflows.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">None yet for this store.</p>
            ) : (
              <div className="space-y-2">
                {workflows.map(w => (
                  <div key={w.id} className="flex items-center gap-3 bg-slate-800/50 rounded-lg px-3 py-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      w.status === 'done' ? 'bg-emerald-400' : w.status === 'error' ? 'bg-red-400' : w.status === 'cancelled' ? 'bg-slate-500' : 'bg-blue-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 truncate">{w.name}</p>
                      <p className="text-[10px] text-slate-500">{w.createdAt} · {w.steps.filter(s => s.status === 'done').length}/{w.steps.length} steps · {w.status}</p>
                    </div>
                    {(w.status === 'error' || w.status === 'running') && !running && (
                      <button onClick={() => { setActive(w); w.status === 'error' ? void retryWorkflow(w) : void advanceLoop(w.id); }}
                        className="text-[11px] text-blue-400 hover:text-blue-300 whitespace-nowrap">resume</button>
                    )}
                    {w.status !== 'error' && w.status !== 'running' && (
                      <button onClick={() => setActive(w)} className="text-[11px] text-slate-400 hover:text-white whitespace-nowrap">view</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
