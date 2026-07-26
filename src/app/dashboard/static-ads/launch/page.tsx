'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, type Node, type Edge, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface Store { id: string; name: string }
interface Product { id: string; title: string; price_cents: number | null; image_url: string | null; images: string }
interface FBProfile { id: string; profile_name: string; ad_account_id: string; ad_account_name: string | null; fb_page_id: string | null; fb_page_name: string | null; pixel_id: string | null }
interface FBPage { id: string; name: string }
interface Step { key: string; label: string; status: 'pending' | 'done' | 'error'; detail?: string }
interface Workflow {
  id: string; storeId: string; productId: string; name: string; status: string;
  steps: Step[]; config: any; result: any; error: string | null; createdAt: string;
}

const HIDDEN_STORES = ['apex loom', 'neeyahpure', 'vitaedge', 'ymo - amazon', 'zen essential', 'zenchoice'];

// ─── Node definitions: each canvas node maps to one or many engine steps ───
type NodeStatus = 'idle' | 'pending' | 'running' | 'done' | 'error' | 'gate';
interface FlowNodeData extends Record<string, unknown> {
  icon: string; title: string; subtitle: string; status: NodeStatus; progress?: string; isGate?: boolean;
  tpos: Position; spos: Position;
}

const NODE_DEFS = [
  { id: 'product', icon: '📦', title: 'Product', stepKeys: [] as string[] },
  { id: 'audience', icon: '🧠', title: 'Audience', stepKeys: ['audience'] },
  { id: 'copy', icon: '✍️', title: 'Ad Copy', stepKeys: ['copy'] },
  { id: 'images', icon: '🖼️', title: 'Picture Ads', stepKeys: ['image_'] },
  { id: 'campaign', icon: '📣', title: 'Campaign', stepKeys: ['campaign'] },
  { id: 'adset', icon: '🎯', title: 'Ad Set', stepKeys: ['adset'] },
  { id: 'ads', icon: '🧩', title: 'Create Ads', stepKeys: ['ad_'] },
  { id: 'activate', icon: '⚡', title: 'Go Live', stepKeys: ['activate'] },
];

// New Product flow: same canvas, longer pipeline — brief → 7 listing images →
// Shopify product → lander, then the standard ad pipeline.
const NP_NODE_DEFS = [
  { id: 'np_brief', icon: '🧾', title: 'Product Brief', stepKeys: [] as string[] },
  { id: 'np_images', icon: '🖼️', title: 'Listing Images', stepKeys: ['np_image_'] },
  { id: 'np_product', icon: '🛍️', title: 'Shopify Product', stepKeys: ['np_product'] },
  { id: 'pixel', icon: '📡', title: 'FB Pixel', stepKeys: ['pixel'] },
  { id: 'np_lander', icon: '📄', title: 'Lander + Ad Copy', stepKeys: ['np_lander'] },
  { id: 'kalo', icon: '🎬', title: 'Kalo Video Ads', stepKeys: ['vdl_'] },
  { id: 'campaign', icon: '📣', title: 'Campaign', stepKeys: ['campaign'] },
  { id: 'adset', icon: '🎯', title: 'Ad Set', stepKeys: ['adset'] },
  { id: 'ads', icon: '🧩', title: 'Create Ads', stepKeys: ['vad_'] },
  { id: 'activate', icon: '⚡', title: 'Go Live', stepKeys: ['activate'] },
  { id: 'schedule_daily', icon: '📅', title: 'Daily Top-Up', stepKeys: ['schedule_daily'] },
];

function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const ring =
    data.status === 'done' ? 'border-emerald-500'
    : data.status === 'running' ? 'border-blue-400 shadow-[0_0_18px_rgba(96,165,250,0.45)]'
    : data.status === 'error' ? 'border-red-500'
    : data.status === 'gate' ? 'border-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.4)] animate-pulse'
    : 'border-slate-700';
  return (
    <div className={`w-44 rounded-xl border-2 bg-slate-900 px-3 py-2.5 ${ring} ${selected ? 'outline outline-2 outline-blue-500/60' : ''}`}>
      <Handle type="target" position={data.tpos} className="!bg-slate-500 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <span className="text-lg">{data.icon}</span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-white truncate">{data.title}</p>
          <p className="text-[10px] text-slate-400 truncate">{data.subtitle}</p>
        </div>
      </div>
      {data.progress && <p className="text-[10px] text-blue-300 mt-1">{data.progress}</p>}
      <div className="mt-1.5 flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${
          data.status === 'done' ? 'bg-emerald-400' : data.status === 'running' ? 'bg-blue-400 animate-pulse'
          : data.status === 'error' ? 'bg-red-400' : data.status === 'gate' ? 'bg-amber-400' : 'bg-slate-600'
        }`} />
        <span className="text-[9px] uppercase tracking-wider text-slate-500">
          {data.status === 'gate' ? 'needs approval' : data.status}
        </span>
      </div>
      <Handle type="source" position={data.spos} className="!bg-slate-500 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes = { flowNode: FlowNode };

export default function LaunchFlowPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [selectedImageUrl, setSelectedImageUrl] = useState('');
  const [profiles, setProfiles] = useState<FBProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [pages, setPages] = useState<FBPage[]>([]);
  const [pageId, setPageId] = useState('');
  const [pagesLoading, setPagesLoading] = useState(false);
  const [landingUrl, setLandingUrl] = useState('');
  const [landingOptions, setLandingOptions] = useState<{ label: string; url: string }[]>([]);
  const [landingResolved, setLandingResolved] = useState<{ validated: boolean; selectionReason: string; warnings: string[] } | null>(null);
  const [landingLoading, setLandingLoading] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [adCount, setAdCount] = useState(10);
  const [dailyBudget, setDailyBudget] = useState('10');
  const [goLive, setGoLive] = useState(true);
  const [countries, setCountries] = useState('US');
  // Multi-market launch: language drives copy + image text + FB locale targeting
  const LANGS: Record<string, { label: string; preset: string }> = {
    '': { label: '🇺🇸 English (default)', preset: 'US' },
    es: { label: '🇪🇸 Spanish', preset: 'MX, ES, CO, AR, CL, PE' },
    ar: { label: '🇸🇦 Arabic', preset: 'AE, SA, KW, QA, BH, OM' },
    fr: { label: '🇫🇷 French', preset: 'FR, BE, CH, CA' },
    de: { label: '🇩🇪 German', preset: 'DE, AT, CH' },
    pt: { label: '🇧🇷 Portuguese', preset: 'BR, PT' },
  };
  const [language, setLanguage] = useState('');
  const pickLanguage = (lang: string) => {
    setLanguage(lang);
    setCountries(LANGS[lang]?.preset || 'US'); // preset the market — editable after
  };
  const [minSpendTarget, setMinSpendTarget] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  // No end date — ads live in the campaign and run until turned off
  const durationDays = 0;

  // Batch mode: launched from the Picture Ads gallery with pre-selected ads
  const [batchCreatives, setBatchCreatives] = useState<{ id: string; imageUrl: string; templateName: string; productId: string | null }[] | null>(null);
  const [campaignMode, setCampaignMode] = useState<'new' | 'existing'>('new');
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([]);
  const [existingCampaignId, setExistingCampaignId] = useState('');
  const batchMode = !!batchCreatives?.length;

  const [flowTab, setFlowTab] = useState<'ads' | 'newProduct' | 'videos' | 'schedules'>('ads');

  // New Product Launch form
  const [npBrand, setNpBrand] = useState('');
  const [npName, setNpName] = useState('');
  const [npPrice, setNpPrice] = useState('29.99');
  const [npBrief, setNpBrief] = useState('');
  const [npRefUrls, setNpRefUrls] = useState('');
  const [npRefUploads, setNpRefUploads] = useState<string[]>([]);
  const [npUploading, setNpUploading] = useState(false);
  // Kalodata videos are imported under a batch token BEFORE the product exists;
  // the np_product step rebinds them to the real product id.
  const [npVideoBatch, setNpVideoBatch] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)));
  const [npVidCount, setNpVidCount] = useState(9);
  const [npKaloStats, setNpKaloStats] = useState<{ pending: number } | null>(null);
  const [npKaloMsg, setNpKaloMsg] = useState('');
  const [npKaloLinks, setNpKaloLinks] = useState('');
  const [npPixelMode, setNpPixelMode] = useState<'auto' | 'fresh' | 'reuse'>('auto');

  const loadNpKaloStats = useCallback((sid: string, batch: string) => {
    fetch(`/api/static-ads/videos?storeId=${sid}&productId=${batch}`).then(r => r.json())
      .then(d => setNpKaloStats(d.stats || null)).catch(() => {});
  }, []);
  useEffect(() => { if (storeId && flowTab === 'newProduct') loadNpKaloStats(storeId, npVideoBatch); }, [storeId, flowTab, npVideoBatch, loadNpKaloStats]);

  async function npImportKalo(file: File | null, links: string[]) {
    setNpKaloMsg('');
    let res: Response;
    if (file) {
      const fd = new FormData();
      fd.append('storeId', storeId); fd.append('productId', npVideoBatch); fd.append('file', file);
      res = await fetch('/api/static-ads/videos', { method: 'POST', body: fd });
    } else {
      res = await fetch('/api/static-ads/videos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, productId: npVideoBatch, links }),
      });
    }
    const d = await res.json();
    setNpKaloMsg(res.ok ? `✓ ${d.imported} videos imported for this launch (${d.skipped} already known)` : (d.error || 'import failed'));
    if (res.ok) setNpKaloLinks('');
    loadNpKaloStats(storeId, npVideoBatch);
  }

  async function uploadRefPhoto(file: File) {
    setNpUploading(true);
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/products/upload', { method: 'POST', body: fd });
    const d = await res.json();
    if (res.ok && d.url) setNpRefUploads(prev => [...prev, d.url].slice(0, 3));
    else setError(d.error || 'upload failed');
    setNpUploading(false);
  }

  // Video ads (Kalodata pool)
  const [vidStats, setVidStats] = useState<{ pending: number; used: number; failed: number } | null>(null);
  const [vidRecent, setVidRecent] = useState<any[]>([]);
  const [vidCount, setVidCount] = useState(9);
  const [vidUploading, setVidUploading] = useState(false);
  const [vidMsg, setVidMsg] = useState('');
  const [vidLinks, setVidLinks] = useState('');

  // Recurring launch schedules
  interface Schedule { id: string; name: string; storeName?: string; cadence: string; timeOfDay: string; dayOfWeek: number | null; autoLive: boolean; isActive: boolean; lastRunAt: string | null; lastResult: string | null; nextRunAt: string; config?: any }
  const [editSched, setEditSched] = useState<Schedule | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [editPages, setEditPages] = useState<FBPage[]>([]);
  const [editCampaigns, setEditCampaigns] = useState<{ id: string; name: string; status?: string }[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedModal, setSchedModal] = useState(false);
  const [schedName, setSchedName] = useState('');
  const [schedCadence, setSchedCadence] = useState<'daily' | 'weekly'>('daily');
  const [schedTime, setSchedTime] = useState('12:00');
  const [schedDay, setSchedDay] = useState(1);
  const [schedAutoLive, setSchedAutoLive] = useState(true);
  const [schedMsg, setSchedMsg] = useState('');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [wf, setWf] = useState<Workflow | null>(null);
  // Multiple workflows run at once: one advance loop per workflow id. `wf` is
  // only which run the canvas/panels are LOOKING at — never a lock.
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const [liveWfs, setLiveWfs] = useState<Record<string, Workflow>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [selectedNode, setSelectedNode] = useState<string>('product');
  const runningRef = useRef<Set<string>>(new Set());
  const wfIdRef = useRef<string | null>(null);
  const storeIdRef = useRef('');

  useEffect(() => {
    // Batch launch from the gallery: ?store=...&creatives=id1,id2
    const params = new URLSearchParams(window.location.search);
    const batchStore = params.get('store');
    const batchIds = params.get('creatives');
    if (batchStore && batchIds) {
      fetch(`/api/static-ads/creatives?ids=${batchIds}`).then(r => r.json()).then(d => {
        if ((d.creatives || []).length) {
          setBatchCreatives(d.creatives);
          const pid = d.creatives.find((c: any) => c.productId)?.productId;
          if (pid) setProductId(pid);
        }
      }).catch(() => {});
    }
    fetch('/api/stores').then(r => r.json()).then(d => {
      const s = (d.stores || []).filter((st: Store) => !HIDDEN_STORES.includes(st.name.trim().toLowerCase()));
      setStores(s);
      if (batchStore && s.some((st: Store) => st.id === batchStore)) setStoreId(batchStore);
      else if (s.length) setStoreId(s[0].id);
    }).catch(() => {});
  }, []);

  const loadStoreData = useCallback((sid: string) => {
    fetch(`/api/products?storeId=${sid}&onBrand=1`).then(r => r.json()).then(d => setProducts(d.products || [])).catch(() => {});
    fetch(`/api/static-ads/workflow?storeId=${sid}`).then(r => r.json()).then(d => {
      const rows: Workflow[] = d.workflows || [];
      setWorkflows(rows);
      setProfiles(d.profiles || []);
      setShopifyDomain(d.shopifyDomain || '');
      // Never prefill the homepage — the product-link resolver fills the real
      // product page once a product is chosen; ads go to product pages.
      setLandingUrl('');
      if ((d.profiles || []).length === 1) setProfileId(d.profiles[0].id);

      // A refresh must NOT lose the run: restore the last-viewed workflow if
      // it's unfinished, else the most recent unfinished one — one click resumes.
      setWf(prev => {
        if (prev) return prev;
        const unfinished = (w: Workflow) => ['running', 'awaiting_approval', 'error'].includes(w.status);
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('launch_active_wf') : null;
        return rows.find(w => w.id === savedId && unfinished(w)) || rows.find(unfinished) || null;
      });
    }).catch(() => {});
  }, []);

  // Remember which run this tab is looking at (survives refresh)
  useEffect(() => {
    wfIdRef.current = wf?.id || null;
    if (wf?.id) localStorage.setItem('launch_active_wf', wf.id);
  }, [wf?.id]);

  useEffect(() => {
    if (!storeId) return;
    storeIdRef.current = storeId;
    setProductId(''); setProfileId(''); setPages([]); setPageId(''); setWf(null);
    loadStoreData(storeId);
  }, [storeId, loadStoreData]);

  // Batch product id survives the store-change reset
  useEffect(() => {
    if (batchCreatives?.length) {
      const pid = batchCreatives.find(c => c.productId)?.productId;
      if (pid) setProductId(pid);
    }
  }, [batchCreatives, storeId]);

  // Landing URLs straight from Shopify (per-store credentials are centralized)
  useEffect(() => {
    setLandingOptions([]); setLandingResolved(null);
    if (!storeId || !productId || wf) return;
    setLandingLoading(true);
    fetch(`/api/static-ads/workflow?landing=1&storeId=${storeId}&productId=${productId}`)
      .then(r => r.json())
      .then(d => {
        setLandingOptions(d.urls || []);
        if (d.resolved) {
          setLandingResolved({ validated: d.resolved.validated, selectionReason: d.resolved.selectionReason, warnings: d.resolved.warnings || [] });
          // Auto-fill the resolver's recommendation (custom lander > product page; never homepage)
          if (d.resolved.recommendedAdvertisingUrl) setLandingUrl(d.resolved.recommendedAdvertisingUrl);
        }
        setLandingLoading(false);
      })
      .catch(() => setLandingLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, productId]);

  // Existing campaigns for "attach to campaign" mode
  useEffect(() => {
    if (!profileId || campaignMode !== 'existing') { setCampaigns([]); return; }
    fetch(`/api/static-ads/workflow?profileId=${profileId}&campaigns=1`).then(r => r.json()).then(d => {
      setCampaigns(d.campaigns || []);
    }).catch(() => {});
  }, [profileId, campaignMode]);

  useEffect(() => {
    if (!profileId) { setPages([]); setPageId(''); return; }
    setPagesLoading(true);
    fetch(`/api/static-ads/workflow?profileId=${profileId}&pages=1`).then(r => r.json()).then(d => {
      setPages(d.pages || []);
      if (d.savedPageId && (d.pages || []).some((p: FBPage) => p.id === d.savedPageId)) setPageId(d.savedPageId);
      else if ((d.pages || []).length === 1) setPageId(d.pages[0].id);
      setPagesLoading(false);
    }).catch(() => setPagesLoading(false));
  }, [profileId]);

  const profile = profiles.find(p => p.id === profileId);
  const ready = storeId && productId && profileId && pageId && landingUrl.startsWith('http')
    && (campaignMode === 'new' || !!existingCampaignId);
  const npBriefReady = !!(storeId && npBrand.trim() && npName.trim() && parseFloat(npPrice) > 0
    && (npRefUploads.length > 0 || npRefUrls.includes('http')));
  const npReady = npBriefReady && !!profileId && !!pageId && (npKaloStats?.pending || 0) > 0;

  // ─── Engine driving ───
  // One loop per workflow id; several loops run side by side. Each loop only
  // touches the shared view (`wf`, `error`) when ITS workflow is the one on
  // screen — background runs update the live strip instead.
  async function advanceLoop(wfId: string) {
    if (runningRef.current.has(wfId)) return; // this tab is already driving it
    runningRef.current.add(wfId);
    setRunningIds(Array.from(runningRef.current));
    const update = (w: Workflow) => {
      setLiveWfs(prev => ({ ...prev, [w.id]: w }));
      if (wfIdRef.current === w.id) setWf(w);
    };
    // The image batch runs minutes-long inside ONE advance call — poll for
    // live per-image progress while it's in flight
    const poller = setInterval(() => {
      fetch(`/api/static-ads/workflow?id=${wfId}`).then(r => r.json())
        .then(d => { if (d.workflow && runningRef.current.has(wfId)) update(d.workflow); }).catch(() => {});
    }, 4000);
    while (runningRef.current.has(wfId)) {
      try {
        const res = await fetch('/api/static-ads/workflow', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'advance', id: wfId }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'advance failed');
        update(d.workflow);
        if (d.workflow.status !== 'running') break; // done / error / awaiting_approval
      } catch (e: any) { if (wfIdRef.current === wfId) setError(e.message); break; }
    }
    clearInterval(poller);
    runningRef.current.delete(wfId);
    setRunningIds(Array.from(runningRef.current));
    loadStoreData(storeIdRef.current);
  }

  // Point the canvas/panels at a run; keeps the ref in sync so in-flight loops
  // know immediately which run is on screen.
  function viewWf(w: Workflow | null) {
    wfIdRef.current = w?.id || null;
    setWf(w);
  }

  async function start() {
    if (!ready || creating) return;
    setError(''); setCreating(true);
    try {
      const res = await fetch('/api/static-ads/workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', storeId, productId, config: launchConfig() }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'create failed'); return; }
      viewWf(d.workflow);
      void advanceLoop(d.workflow.id);
    } catch (e: any) { setError(e.message || 'create failed'); }
    finally { setCreating(false); }
  }

  async function approve(stepKey: string) {
    if (!wf) return;
    const res = await fetch('/api/static-ads/workflow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', id: wf.id, stepKey }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error || 'approve failed'); return; }
    setWf(d.workflow);
    if (d.workflow.status === 'running') void advanceLoop(wf.id);
  }

  // Schedules are a GLOBAL view across all stores
  const loadSchedules = useCallback(() => {
    fetch('/api/static-ads/workflow?schedules=1').then(r => r.json())
      .then(d => setSchedules(d.schedules || [])).catch(() => {});
  }, []);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  function launchConfig() {
    const attaching = campaignMode === 'existing' && !!existingCampaignId;
    // New campaign: the daily budget IS the campaign's CBO budget.
    // Existing campaign: we never touch its budget — the single ad-set spend
    // value becomes daily_min_spend_target (CBO) or the ad set budget (ABO).
    const adSetSpendCents = minSpendTarget ? Math.round(parseFloat(minSpendTarget) * 100) : undefined;
    return {
      profileId, pageId, landingUrl, adCount,
      dailyBudgetCents: attaching
        ? (adSetSpendCents || 1000)
        : Math.round(parseFloat(dailyBudget || '10') * 100),
      minSpendTargetCents: adSetSpendCents,
      customInstructions: customInstructions.trim() || undefined,
      language: language || undefined,
      launchStatus: goLive ? 'ACTIVE' : 'PAUSED',
      targeting: { countries: countries.split(',').map(c => c.trim()).filter(Boolean) },
      selectedImageUrl: selectedImageUrl || undefined,
      creativeIds: batchMode ? batchCreatives!.map(c => c.id) : undefined,
      existingCampaignId: campaignMode === 'existing' && existingCampaignId ? existingCampaignId : undefined,
      schedule: { startAt: null, durationDays },
    };
  }

  async function saveSchedule() {
    setSchedMsg('');
    const res = await fetch('/api/static-ads/workflow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'schedule_create', storeId, productId,
        name: schedName || `${products.find(p => p.id === productId)?.title || 'Launch'} — ${schedCadence} ${schedTime} PST`,
        config: launchConfig(), cadence: schedCadence, timeOfDay: schedTime,
        dayOfWeek: schedDay, autoLive: schedAutoLive,
      }),
    });
    const d = await res.json();
    if (!res.ok) { setSchedMsg(d.error || 'failed'); return; }
    setSchedModal(false); setSchedName('');
    loadSchedules();
    setFlowTab('schedules');
  }

  const loadVideoPool = useCallback((sid: string, pid?: string) => {
    fetch(`/api/static-ads/videos?storeId=${sid}${pid ? `&productId=${pid}` : ''}`).then(r => r.json())
      .then(d => { setVidStats(d.stats || null); setVidRecent(d.recent || []); }).catch(() => {});
  }, []);
  useEffect(() => { if (storeId) loadVideoPool(storeId, productId); }, [storeId, productId, loadVideoPool]);

  async function uploadKalodata(file: File) {
    setVidUploading(true); setVidMsg('');
    const fd = new FormData();
    fd.append('storeId', storeId); fd.append('file', file);
    if (productId) fd.append('productId', productId);
    const res = await fetch('/api/static-ads/videos', { method: 'POST', body: fd });
    const d = await res.json();
    setVidMsg(res.ok ? `Imported ${d.imported} new videos for ${productId ? 'this product' : 'the store'} (${d.parsed} in file, ${d.skipped} already known — never re-posted)` : (d.error || 'import failed'));
    setVidUploading(false);
    loadVideoPool(storeId, productId);
  }

  async function importVideoLinks() {
    const links = vidLinks.split('\n').map(s => s.trim()).filter(s => s.includes('tiktok'));
    if (!links.length) { setVidMsg('Paste one TikTok link per line'); return; }
    setVidUploading(true); setVidMsg('');
    const res = await fetch('/api/static-ads/videos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, productId: productId || undefined, links }),
    });
    const d = await res.json();
    setVidMsg(res.ok ? `Imported ${d.imported} of ${d.parsed} links (${d.skipped} already known${d.invalid ? `, ${d.invalid} invalid` : ''})` : (d.error || 'import failed'));
    setVidUploading(false);
    if (res.ok) setVidLinks('');
    loadVideoPool(storeId, productId);
  }

  async function startNewProduct() {
    if (creating) return;
    setError(''); setCreating(true);
    const refUrls = [
      ...npRefUploads,
      ...npRefUrls.split('\n').map(s => s.trim()).filter(s => s.startsWith('http')),
    ].slice(0, 3);
    try {
      const res = await fetch('/api/static-ads/workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', storeId,
          config: {
            ...launchConfig(), landingUrl: undefined, creativeIds: undefined,
            adCount: 0, videoCount: npVidCount, videoBatchId: npVideoBatch,
            reusePixel: npPixelMode === 'reuse', freshPixel: npPixelMode === 'fresh',
            newProduct: {
              brandName: npBrand.trim(), productName: npName.trim(),
              priceCents: Math.round(parseFloat(npPrice || '0') * 100),
              brief: npBrief.trim(), referenceImageUrls: refUrls,
            },
          },
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'create failed'); return; }
      // Fresh batch token for the next launch — this one's videos are reserved
      if (typeof crypto !== 'undefined' && crypto.randomUUID) setNpVideoBatch(crypto.randomUUID());
      viewWf(d.workflow);
      void advanceLoop(d.workflow.id);
    } catch (e: any) { setError(e.message || 'create failed'); }
    finally { setCreating(false); }
  }

  async function startVideoLaunch() {
    if (creating) return;
    setError(''); setCreating(true);
    try {
      const res = await fetch('/api/static-ads/workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', storeId, productId,
          config: { ...launchConfig(), creativeIds: undefined, adCount: 0, videoCount: vidCount },
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'create failed'); return; }
      viewWf(d.workflow);
      void advanceLoop(d.workflow.id);
    } catch (e: any) { setError(e.message || 'create failed'); }
    finally { setCreating(false); }
  }

  async function scheduleDailyMix(w: Workflow) {
    setError('');
    const res = await fetch('/api/static-ads/workflow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'schedule_create', storeId: w.storeId, productId: w.productId,
        name: `Daily top-up — 3 videos + 2 pics @ 11:50PM`,
        config: {
          ...w.config, videoCount: 3, adCount: 2, creativeIds: undefined, newProduct: null,
          existingCampaignId: w.result?.campaignId, campaignName: undefined, audienceId: null,
        },
        cadence: 'daily', timeOfDay: '23:50', autoLive: true,
      }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error || 'schedule failed'); return; }
    loadSchedules(); setFlowTab('schedules');
  }

  function openScheduleEditor(s: Schedule) {
    setEditSched(s);
    setEditForm({
      name: s.name, cadence: s.cadence, timeOfDay: s.timeOfDay, dayOfWeek: s.dayOfWeek ?? 1, autoLive: s.autoLive,
      adCount: s.config?.adCount ?? 10,
      dailyBudget: ((s.config?.dailyBudgetCents ?? 1000) / 100).toString(),
      minSpend: s.config?.minSpendTargetCents ? (s.config.minSpendTargetCents / 100).toString() : '',
      countries: (s.config?.targeting?.countries || ['US']).join(', '),
      language: s.config?.language || '',
      customInstructions: s.config?.customInstructions || '',
      landingUrl: s.config?.landingUrl || '',
      pageId: s.config?.pageId || '',
      existingCampaignId: s.config?.existingCampaignId || '',
    });
    // Pages + campaigns available on this schedule's ad account
    setEditPages([]);
    setEditCampaigns([]);
    if (s.config?.profileId) {
      fetch(`/api/static-ads/workflow?profileId=${s.config.profileId}&pages=1`).then(r => r.json())
        .then(d => setEditPages(d.pages || [])).catch(() => {});
      fetch(`/api/static-ads/workflow?profileId=${s.config.profileId}&campaigns=1`).then(r => r.json())
        .then(d => setEditCampaigns(d.campaigns || [])).catch(() => {});
    }
  }

  async function saveScheduleEdit() {
    if (!editSched) return;
    const f = editForm;
    const res = await fetch('/api/static-ads/workflow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'schedule_update', id: editSched.id,
        name: f.name, cadence: f.cadence, timeOfDay: f.timeOfDay, dayOfWeek: Number(f.dayOfWeek), autoLive: !!f.autoLive,
        config: {
          adCount: Math.min(Math.max(Number(f.adCount) || 10, 1), 20),
          dailyBudgetCents: Math.round(parseFloat(f.dailyBudget || '10') * 100),
          minSpendTargetCents: f.minSpend ? Math.round(parseFloat(f.minSpend) * 100) : null,
          targeting: { countries: String(f.countries).split(',').map((c: string) => c.trim()).filter(Boolean) },
          language: f.language || null,
          customInstructions: f.customInstructions?.trim() || null,
          landingUrl: f.landingUrl,
          ...(f.pageId ? { pageId: f.pageId } : {}),
          existingCampaignId: f.existingCampaignId || null,
        },
      }),
    });
    if (res.ok) { setEditSched(null); loadSchedules(); }
    else { const d = await res.json(); setSchedMsg(d.error || 'update failed'); }
  }

  async function scheduleAction(action: string, id: string) {
    await fetch('/api/static-ads/workflow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    });
    loadSchedules();
  }

  async function retry() {
    if (!wf) return;
    const res = await fetch('/api/static-ads/workflow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry', id: wf.id }),
    });
    const d = await res.json();
    if (res.ok) { setWf(d.workflow); void advanceLoop(wf.id); }
  }

  // ─── Steps → canvas nodes ───
  function nodeStatus(stepKeys: string[]): { status: NodeStatus; progress?: string; detail?: string } {
    if (!wf) return { status: 'idle' };
    const steps = wf.steps.filter(s => stepKeys.some(k => k.endsWith('_') ? s.key.startsWith(k) : s.key === k));
    if (steps.length === 0) return { status: 'idle' };
    const done = steps.filter(s => s.status === 'done').length;
    const err = steps.find(s => s.status === 'error');
    const current = wf.steps.find(s => s.status !== 'done');
    const isCurrent = current && steps.some(s => s.key === current.key);
    if (err) return { status: 'error', detail: err.detail, progress: steps.length > 1 ? `${done}/${steps.length}` : undefined };
    if (done === steps.length) return { status: 'done', progress: steps.length > 1 ? `${done}/${steps.length}` : undefined };
    if (isCurrent && current!.key.startsWith('gate_') && wf.status === 'awaiting_approval') return { status: 'gate' };
    if (isCurrent && runningIds.includes(wf.id)) return { status: 'running', progress: steps.length > 1 ? `${done}/${steps.length}` : undefined };
    return { status: 'pending', progress: steps.length > 1 && done > 0 ? `${done}/${steps.length}` : undefined };
  }

  const npMode = flowTab === 'newProduct';
  const activeDefs = useMemo(() => {
    let defs = npMode ? NP_NODE_DEFS : NODE_DEFS;
    if (!npMode && batchMode) {
      // Batch: ads already exist — no generation nodes; a fallback audience
      // step (creatives without one) maps into the Copy node
      defs = defs.filter(d => d.id !== 'audience' && d.id !== 'images')
        .map(d => d.id === 'copy' ? { ...d, stepKeys: ['audience', 'copy'] } : d);
    }
    return defs.filter(d => {
      if (!goLive && d.id === 'activate') return !!wf && wf.steps.some(s => s.key === d.id);
      return true;
    });
  }, [goLive, wf, batchMode, npMode]);

  // Both rows read left→right (natural reading order); the row transition is a
  // stepped return edge routed in the gap between rows.
  const PER_ROW = 5;
  const nodes: Node<FlowNodeData>[] = useMemo(() => activeDefs.map((d, i) => {
    const st = d.id === 'product' ? { status: (productId ? 'done' : 'idle') as NodeStatus }
      : d.id === 'np_brief' ? { status: ((wf || npBriefReady) ? 'done' : 'idle') as NodeStatus }
      : nodeStatus(d.stepKeys);
    const npCfg = wf?.config?.newProduct;
    const subtitle =
      d.id === 'product' ? (batchMode ? `${batchCreatives!.length} selected ads` : (products.find(p => p.id === productId)?.title || 'pick a product'))
      : d.id === 'np_brief' ? (npCfg ? `${npCfg.brandName} ${npCfg.productName}` : (npName.trim() ? `${npBrand.trim()} ${npName.trim()}` : 'brand · product · brief · photos'))
      : d.id === 'np_images' ? '7 Amazon-style listing shots'
      : d.id === 'np_product' ? (wf?.result?.productHandle ? `/${wf.result.productHandle} — ACTIVE` : 'created live on Shopify')
      : d.id === 'pixel' ? (wf?.result?.pixelId ? `${wf.result.pixelId}${wf.result.pixelTest?.received ? ' ✓ tested' : ''}` : (npPixelMode === 'auto' ? 'auto: active campaign pixel' : npPixelMode === 'reuse' ? 'reuse account pixel' : 'fresh pixel + test'))
      : d.id === 'np_lander' ? (wf?.result?.landingUrl ? 'lander live ↗ · ad copy ready' : 'template + Fable 5 copy → ads too')
      : d.id === 'kalo' ? (wf ? `${(wf.config?.videoCount || 0)} winning TikToks` : `${npKaloStats?.pending ?? 0} ready · ${npVidCount} first launch`)
      : d.id === 'schedule_daily' ? (wf?.result?.dailyScheduleId ? '✓ scheduled — 5/day' : '5 ads/day · new ad set · $15 min')
      : d.id === 'audience' ? (wf?.result?.audience?.name || 'Fable 5 auto-generates')
      : d.id === 'copy' ? (wf?.result?.copy?.headline || 'Fable 5 writes it')
      : d.id === 'images' ? `${wf?.config?.adCount || adCount} ads from proven templates`
      : d.id === 'campaign' ? (campaignMode === 'existing'
          ? (campaigns.find(c => c.id === (wf?.config?.existingCampaignId || existingCampaignId))?.name || 'existing campaign')
          : (profile?.profile_name || 'FB campaign (paused)'))
      : d.id === 'adset' ? (
          (wf ? !!wf.config.existingCampaignId : campaignMode === 'existing')
            ? `min $${wf?.config ? ((wf.config.minSpendTargetCents ?? wf.config.dailyBudgetCents) / 100).toFixed(0) : (minSpendTarget || '—')}/day · joins campaign`
            : `$${wf?.config ? (wf.config.dailyBudgetCents / 100).toFixed(0) : dailyBudget}/day CBO · until stopped`)
      : d.id === 'ads' ? 'upload + attach copy (paused)'
      : 'flips everything ACTIVE — automatic';

    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const x = 40 + col * 230;
    const y = 40 + row * 230;
    const rowEnd = col === PER_ROW - 1 && i < activeDefs.length - 1;
    const tpos = col === 0 && row > 0 ? Position.Top : Position.Left;
    const spos = rowEnd ? Position.Bottom : Position.Right;

    return {
      id: d.id, type: 'flowNode',
      position: { x, y },
      data: { icon: d.icon, title: d.title, subtitle, status: st.status, progress: (st as any).progress, isGate: d.id.startsWith('gate'), tpos, spos },
    };
  }), [activeDefs, wf, productId, products, profile, adCount, dailyBudget, runningIds, batchMode, batchCreatives, campaignMode, campaigns, existingCampaignId, durationDays, npBriefReady, npBrand, npName]);

  const edges: Edge[] = useMemo(() => activeDefs.slice(0, -1).map((d, i) => {
    const next = activeDefs[i + 1];
    const targetStatus = nodes.find(n => n.id === next.id)?.data.status;
    const done = targetStatus === 'done' || nodes.find(n => n.id === d.id)?.data.status === 'done';
    const color = done ? '#34d399' : '#475569';
    return {
      id: `${d.id}-${next.id}`, source: d.id, target: next.id,
      type: 'smoothstep',
      animated: targetStatus === 'running' || targetStatus === 'gate',
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: { stroke: color, strokeWidth: 2 },
    };
  }), [activeDefs, nodes]);

  const currentGate = wf?.status === 'awaiting_approval' ? wf.steps.find(s => s.status !== 'done' && s.key.startsWith('gate_')) : null;

  // Special-mode runs (new product / videos) live on their own tabs
  useEffect(() => {
    if (!wf) return;
    if (wf.config?.mode === 'new_product') setFlowTab('newProduct');
    else if ((wf.config?.videoCount || 0) > 0) setFlowTab('videos');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf?.id]);

  // Keep the inspector selection valid for the visible pipeline
  useEffect(() => {
    if (npMode && !NP_NODE_DEFS.some(d => d.id === selectedNode)) setSelectedNode('np_brief');
    if (!npMode && !NODE_DEFS.some(d => d.id === selectedNode)) setSelectedNode('product');
    // New-product first campaign defaults: $100/day CBO, top-4 countries.
    // Only upgrade untouched generic defaults — never stomp user edits.
    if (npMode) {
      setDailyBudget(v => (v === '10' ? '100' : v));
      setCountries(v => (v.trim().toUpperCase() === 'US' ? 'US, GB, AU, CA' : v));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [npMode]);

  // Plain step-list runner for new-product and video workflows (no canvas)
  function StepRunPanel({ w }: { w: Workflow }) {
    return (
      <div className="bg-slate-900 border border-blue-800 rounded-xl p-4 mt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-white font-medium">{w.name}</p>
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${
            w.status === 'done' ? 'bg-emerald-900/50 text-emerald-400' : w.status === 'error' ? 'bg-red-900/50 text-red-400'
            : w.status === 'awaiting_approval' ? 'bg-amber-900/50 text-amber-400' : 'bg-blue-900/50 text-blue-400'
          }`}>{w.status} · {w.steps.filter(s => s.status === 'done').length}/{w.steps.length}</span>
        </div>
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          {w.steps.map(s => (
            <div key={s.key} className="flex items-start gap-2 text-sm py-0.5">
              <span className="w-4 flex-shrink-0 mt-0.5">
                {s.status === 'done' ? <span className="text-emerald-400">✓</span>
                  : s.status === 'error' ? <span className="text-red-400">✗</span>
                  : runningIds.includes(w.id) && w.steps.find(x => x.status !== 'done')?.key === s.key
                    ? <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    : <span className="text-slate-600">○</span>}
              </span>
              <span className={s.status === 'done' ? 'text-slate-300' : s.status === 'error' ? 'text-red-300' : 'text-slate-500'}>
                {s.label}{s.detail && <span className="text-slate-500"> — {s.detail}</span>}
              </span>
            </div>
          ))}
        </div>
        {w.result?.landingUrl && (
          <a href={w.result.landingUrl} target="_blank" rel="noreferrer" className="block mt-2 text-xs text-blue-400 hover:text-blue-300">Lander: {w.result.landingUrl} ↗</a>
        )}
        {currentGate && (
          <button onClick={() => approve(currentGate.key)} className="mt-3 w-full bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg py-2.5 text-sm">
            🚦 Approve — GO LIVE, start spending
          </button>
        )}
        {w.status === 'error' && !runningIds.includes(w.id) && (
          <button onClick={retry} className="mt-3 w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg py-2">↻ Retry failed steps + continue</button>
        )}
        {w.status === 'running' && !runningIds.includes(w.id) && (
          <button onClick={() => void advanceLoop(w.id)} className="mt-3 w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg py-2">▶ Resume run</button>
        )}
        {w.status === 'done' && (w.config?.videoCount || 0) > 0 && w.result?.campaignId && (
          <button onClick={() => void scheduleDailyMix(w)} className="mt-3 w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-semibold rounded-lg py-2.5">
            📅 Schedule daily top-up — 3 videos + 2 picture ads @ 11:50 PM into this campaign
          </button>
        )}
      </div>
    );
  }
  const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500';
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5';

  const adsManagerUrl = profile
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${(profile.ad_account_id || '').replace('act_', '')}`
    : '';

  // ─── Inspector for the selected node ───
  function Inspector() {
    const r = wf?.result || {};
    const def = (npMode ? NP_NODE_DEFS : NODE_DEFS).find(d => d.id === selectedNode);
    const nodeErr = wf?.steps.find(s =>
      s.status === 'error' && (def?.stepKeys || []).some(k => k.endsWith('_') ? s.key.startsWith(k) : s.key === k));
    const errBox = nodeErr ? (
      <div className="mb-3 bg-red-900/30 border border-red-800 text-red-300 text-xs rounded-lg px-3 py-2">
        <p className="font-semibold mb-0.5">Step failed:</p>
        <p className="break-words">{nodeErr.detail}</p>
        {wf?.status === 'error' && !runningIds.includes(wf.id) && (
          <button onClick={retry}
            className="mt-2 w-full bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg py-2 text-xs">
            ↻ Retry this step + continue the run
          </button>
        )}
      </div>
    ) : null;
    switch (selectedNode) {
      case 'product': {
        if (batchMode) {
          return (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Launching {batchCreatives!.length} already-generated ads from the gallery.</p>
            <div className="grid grid-cols-4 gap-1">
              {batchCreatives!.map(c => (
                <a key={c.id} href={c.imageUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${c.imageUrl}?w=150`} alt={c.templateName} className="rounded aspect-square object-cover w-full" />
                </a>
              ))}
            </div>
            <p className="text-xs text-slate-300">{products.find(p => p.id === productId)?.title || ''}</p>
            <div><label className={labelCls}>Landing page URL {landingLoading ? '· fetching from Shopify…' : ''}</label>
              {!wf && landingOptions.length > 0 && (
                <select value={landingOptions.some(o => o.url === landingUrl) ? landingUrl : ''}
                  onChange={e => e.target.value && setLandingUrl(e.target.value)} className={`${inputCls} mb-2`}>
                  <option value="">— pick from Shopify, or edit below —</option>
                  {landingOptions.map(o => <option key={o.url} value={o.url}>{o.label}</option>)}
                </select>
              )}
              <input value={landingUrl} onChange={e => setLandingUrl(e.target.value)} className={inputCls} disabled={!!wf}
                placeholder="https://yourstore.com/products/…" />
              {!wf && landingResolved && (
                <p className={`text-[10px] mt-1 ${landingResolved.validated ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {landingResolved.validated ? '✓ ' : '⚠ '}{landingResolved.selectionReason}
                  {landingResolved.warnings.map((w, i) => <span key={i} className="block text-amber-400">⚠ {w}</span>)}
                </p>
              )}</div>
          </div>);
        }
        const prod = products.find(p => p.id === productId);
        let prodImages: string[] = [];
        if (prod) {
          try { prodImages = JSON.parse(prod.images || '[]'); } catch {}
          if (prod.image_url && !prodImages.includes(prod.image_url)) prodImages.unshift(prod.image_url);
          prodImages = prodImages.slice(0, 12);
        }
        const usedImage = wf?.config?.selectedImageUrl || null;
        return (
        <div className="space-y-3">
          <div><label className={labelCls}>Store</label>
            <select value={storeId} onChange={e => setStoreId(e.target.value)} className={inputCls} disabled={!!wf}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label className={labelCls}>Product</label>
            <select value={productId} onChange={e => { setProductId(e.target.value); setSelectedImageUrl(''); }} className={inputCls} disabled={!!wf}>
              <option value="">— select —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select></div>
          {!wf && prodImages.length > 0 && (
            <div>
              <label className={labelCls}>Reference photo — used in every generated ad</label>
              <div className="grid grid-cols-4 gap-1.5">
                {prodImages.map(url => (
                  <button key={url} onClick={() => setSelectedImageUrl(url === selectedImageUrl ? '' : url)}
                    className={`aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                      selectedImageUrl === url ? 'border-blue-500' : 'border-slate-700 hover:border-slate-500'
                    }`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">{selectedImageUrl ? 'Selected — all ads use this photo' : 'None selected — defaults to the product’s main image'}</p>
            </div>
          )}
          {wf && usedImage && (
            <div>
              <label className={labelCls}>Reference photo (locked for this run)</label>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={usedImage} alt="reference" className="w-20 h-20 rounded-lg object-cover border border-slate-700" />
            </div>
          )}
          <div><label className={labelCls}>Landing page URL {landingLoading ? '· fetching from Shopify…' : ''}</label>
            {!wf && landingOptions.length > 0 && (
              <select value={landingOptions.some(o => o.url === landingUrl) ? landingUrl : ''}
                onChange={e => e.target.value && setLandingUrl(e.target.value)} className={`${inputCls} mb-2`}>
                <option value="">— pick from Shopify, or edit below —</option>
                {landingOptions.map(o => <option key={o.url} value={o.url}>{o.label}</option>)}
              </select>
            )}
            <input value={landingUrl} onChange={e => setLandingUrl(e.target.value)} className={inputCls} disabled={!!wf}
              placeholder="https://yourstore.com/products/…" />
            {!wf && landingResolved && (
              <p className={`text-[10px] mt-1 ${landingResolved.validated ? 'text-emerald-400' : 'text-amber-400'}`}>
                {landingResolved.validated ? '✓ ' : '⚠ '}{landingResolved.selectionReason}
                {landingResolved.warnings.map((w, i) => <span key={i} className="block text-amber-400">⚠ {w}</span>)}
              </p>
            )}</div>
        </div>);
      }
      case 'np_brief': {
        const npCfg = wf?.config?.newProduct;
        if (npCfg) {
          return (
          <div className="space-y-2 text-sm">
            <p className="text-white font-medium">{npCfg.brandName} {npCfg.productName}</p>
            <p className="text-xs text-slate-400">${(npCfg.priceCents / 100).toFixed(2)} · {stores.find(s => s.id === wf!.storeId)?.name}</p>
            <p className="text-xs text-slate-300 whitespace-pre-wrap">{npCfg.brief}</p>
            {(npCfg.referenceImageUrls || []).length > 0 && (
              <div className="flex gap-1.5">
                {npCfg.referenceImageUrls.map((u: string) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={u} src={u} alt="ref" className="w-14 h-14 rounded-lg object-cover border border-slate-700" />
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-500">Locked for this run.</p>
          </div>);
        }
        return (
        <div className="space-y-3">
          <div><label className={labelCls}>Store</label>
            <select value={storeId} onChange={e => setStoreId(e.target.value)} className={inputCls}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls}>Brand name</label>
              <input value={npBrand} onChange={e => setNpBrand(e.target.value)} placeholder="e.g. Purebite" className={inputCls} /></div>
            <div><label className={labelCls}>Product name</label>
              <input value={npName} onChange={e => setNpName(e.target.value)} placeholder="e.g. D3+K2 Drops" className={inputCls} /></div>
          </div>
          <div><label className={labelCls}>Price $</label>
            <input type="number" min={1} step="0.01" value={npPrice} onChange={e => setNpPrice(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Product brief — what it is, who it&apos;s for, key benefits</label>
            <textarea rows={4} value={npBrief} onChange={e => setNpBrief(e.target.value)} className={inputCls} /></div>
          <div>
            <label className={labelCls}>Reference photos (up to 3) — drive every listing image</label>
            <input type="file" accept="image/*" disabled={npUploading || npRefUploads.length >= 3}
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadRefPhoto(f); e.target.value = ''; }}
              className="w-full text-xs text-slate-400 file:bg-slate-800 file:border-0 file:text-slate-200 file:rounded-lg file:px-3 file:py-2 file:mr-3" />
            {npUploading && <p className="text-xs text-blue-400 mt-1">Uploading…</p>}
            {npRefUploads.length > 0 && (
              <div className="flex gap-2 mt-2">
                {npRefUploads.map(u => (
                  <div key={u} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="ref" className="w-16 h-16 rounded-lg object-cover border border-slate-700" />
                    <button onClick={() => setNpRefUploads(prev => prev.filter(x => x !== u))}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 text-white rounded-full text-[9px] leading-4">✕</button>
                  </div>
                ))}
              </div>
            )}
            <input value={npRefUrls} onChange={e => setNpRefUrls(e.target.value)}
              placeholder="…or paste an image URL" className={`${inputCls} mt-2`} />
          </div>
          <p className={`text-[11px] ${npBriefReady ? 'text-emerald-400' : 'text-slate-500'}`}>
            {npBriefReady ? '✓ Brief complete — set up Campaign + Ad Set nodes, then Run.' : 'Fill brand, product, price, brief and at least one photo.'}
          </p>
        </div>);
      }
      case 'np_images': return (
        <div className="space-y-3">
          {errBox}
          <p className="text-xs text-slate-400">7 Amazon-style listing shots (hero, lifestyle, benefits, ingredients…) generated from your reference photos — they become the Shopify product gallery.</p>
          {wf && <p className="text-[11px] text-slate-500">{(r.listingImages || []).filter(Boolean).length}/7 generated{runningIds.includes(wf.id) ? ' — running…' : ''}</p>}
          {(r.listingImages || []).filter(Boolean).length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {(r.listingImages || []).filter(Boolean).map((img: any) => (
                <a key={img.id} href={`/api/static-ads/images/${img.id}?store=${wf!.storeId}`} target="_blank" rel="noreferrer" title={img.label}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/static-ads/images/${img.id}?store=${wf!.storeId}&w=150`} alt={img.label} className="rounded aspect-square object-cover w-full" />
                </a>
              ))}
            </div>
          )}
        </div>);
      case 'np_product': return (
        <div className="space-y-2">
          {errBox}
          <p className="text-xs text-slate-400">Creates the product on Shopify — ACTIVE and published, all 7 listing images attached, price from your brief.</p>
          {r.shopifyProductId && <p className="text-xs text-emerald-400">Product ID: {r.shopifyProductId}</p>}
          {r.productHandle && shopifyDomain && (
            <a href={`https://${shopifyDomain}/products/${r.productHandle}`} target="_blank" rel="noreferrer"
              className="block text-center bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg py-2">
              ✓ View live product ↗
            </a>
          )}
        </div>);
      case 'pixel': return (
        <div className="space-y-2">
          {errBox}
          <p className="text-xs text-slate-400"><b>Auto (default):</b> if this ad account already has active campaigns, their pixel is proven and purchase-fed — the launch rides it. Only a cold account (new store) gets a fresh pixel. Either way it&apos;s verified with a server-side test event (Events Manager → Test events, code TEST_YM_LAUNCH), embedded in the lander (PageView + ViewContent with real product id/price), and the ad set optimizes for purchases with it.</p>
          {!wf && (
            <div className="grid grid-cols-3 gap-1.5">
              {([['auto', '🤖 Auto'], ['fresh', '✨ Fresh'], ['reuse', '♻️ Reuse']] as const).map(([mode, label]) => (
                <button key={mode} onClick={() => setNpPixelMode(mode)}
                  className={`text-xs rounded-lg py-1.5 border ${npPixelMode === mode ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {r.pixelId && (
            <div className="bg-slate-800/60 rounded-lg p-2.5 space-y-1">
              <p className="text-xs text-white">Pixel <span className="font-mono">{r.pixelId}</span> {r.pixelCreated ? '(created new)' : '(account pixel reused)'}</p>
              <p className={`text-xs ${r.pixelTest?.received ? 'text-emerald-400' : 'text-amber-400'}`}>
                {r.pixelTest?.received ? '✓ test event received by Meta' : `⚠ ${r.pixelTest?.note || 'not tested yet'}`}
              </p>
            </div>
          )}
        </div>);
      case 'np_lander': return (
        <div className="space-y-2">
          {errBox}
          <p className="text-xs text-slate-400">Fable 5 writes the copy into the repo&apos;s ready-made Shrine-style template (fast + consistent) and it goes straight into the product page — that page is what the ads drive to. The same copy becomes the video ads&apos; headline + primary text, and the FB pixel is embedded at the bottom: PageView + ViewContent fire on every visit.</p>
          {wf?.result?.copy?.headline && (
            <div className="bg-slate-800/60 rounded-lg p-2.5">
              <p className="text-[10px] text-slate-500 uppercase mb-1">Ad copy (from the lander)</p>
              <p className="text-xs text-white font-medium">{wf.result.copy.headline}</p>
              <p className="text-[11px] text-slate-400 whitespace-pre-wrap mt-1">{wf.result.copy.primaryText}</p>
            </div>
          )}
          {r.landingUrl && (
            <a href={r.landingUrl} target="_blank" rel="noreferrer"
              className="block text-center bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg py-2">
              ✓ Open lander ↗
            </a>
          )}
        </div>);
      case 'audience': return r.audience ? (
        <div className="space-y-2 text-sm">
          <p className="text-white font-medium">{r.audience.name}</p>
          <p className="text-slate-400 text-xs">{r.audience.description}</p>
          <p className="text-[10px] text-slate-500 uppercase mt-2">Pain points</p>
          {r.audience.painPoints?.slice(0, 5).map((p: string, i: number) => <p key={i} className="text-xs text-slate-300">• {p}</p>)}
          <p className="text-[10px] text-slate-500 uppercase mt-2">Angles / moments</p>
          {r.audience.creativeAngles?.slice(0, 5).map((p: string, i: number) => <p key={i} className="text-xs text-slate-300">• {p}</p>)}
          <p className="text-[10px] text-slate-500 mt-2">{r.audience.demographics}</p>
        </div>
      ) : <p className="text-xs text-slate-500">Fable 5 reads the product and builds the full buyer profile: psychographics, usage moments, objections, and the claims they need to hear. Output appears here.</p>;
      case 'copy': return r.copy ? (
        <div className="space-y-3 text-sm">
          <div><p className={labelCls}>Primary text</p><p className="text-slate-200 whitespace-pre-wrap text-xs">{r.copy.primaryText}</p></div>
          <div><p className={labelCls}>Headline</p><p className="text-white">{r.copy.headline}</p></div>
          <div><p className={labelCls}>Description</p><p className="text-slate-300 text-xs">{r.copy.description}</p></div>
        </div>
      ) : <p className="text-xs text-slate-500">Fable 5 writes the FB primary text, headline and description from the product + audience. Output appears here for review.</p>;
      case 'images': return (
        <div className="space-y-3">
          {errBox}
          {!wf && <div><label className={labelCls}>Number of picture ads</label>
            <input type="number" min={1} max={20} value={adCount}
              onChange={e => setAdCount(Math.min(Math.max(Number(e.target.value) || 1, 1), 20))} className={inputCls} /></div>}
          {!wf && <div><label className={labelCls}>Custom details — baked into every image</label>
            <textarea value={customInstructions} onChange={e => setCustomInstructions(e.target.value)} rows={2}
              placeholder="e.g. 50% OFF — show the discount prominently" className={inputCls} /></div>}
          {wf?.config?.customInstructions && (
            <p className="text-xs text-slate-400">Custom details: <span className="text-slate-200">{wf.config.customInstructions}</span></p>
          )}
          {wf && <p className="text-[11px] text-slate-500">Images generate in parallel (5 workers).</p>}
          {(r.creatives || []).filter(Boolean).length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {(r.creatives || []).filter(Boolean).map((c: any) => (
                <a key={c.id} href={c.imageUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${c.imageUrl}?w=150`} alt={c.template} className="rounded aspect-square object-cover w-full" />
                </a>
              ))}
            </div>
          )}
          {!(r.creatives || []).filter(Boolean).length && wf && <p className="text-xs text-slate-500">Generating… thumbnails appear as each finishes.</p>}
        </div>);
      case 'kalo': return (
        <div className="space-y-3">
          {errBox}
          <p className="text-xs text-slate-400">Import the Kalodata export for THIS product — the top {npVidCount} by revenue launch in the first campaign, the rest feed the daily top-up (5/day in a fresh ad set, $15 min spend). Every video gets a unique ID — nothing ever double-posts.</p>
          {!wf && (
            <>
              <div>
                <label className={labelCls}>Kalodata export (.xlsx)</label>
                <input type="file" accept=".xlsx"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void npImportKalo(f, []); e.target.value = ''; }}
                  className="w-full text-xs text-slate-400 file:bg-slate-800 file:border-0 file:text-slate-200 file:rounded-lg file:px-3 file:py-2 file:mr-3" />
              </div>
              <div>
                <label className={labelCls}>…or paste TikTok links (one per line)</label>
                <textarea rows={2} value={npKaloLinks} onChange={e => setNpKaloLinks(e.target.value)}
                  placeholder="https://www.tiktok.com/@creator/video/…" className={inputCls} />
                {npKaloLinks.trim() && (
                  <button onClick={() => void npImportKalo(null, npKaloLinks.split('\n').map(s => s.trim()).filter(s => s.includes('tiktok')))}
                    className="mt-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg">Import links</button>
                )}
              </div>
              <div><label className={labelCls}>Videos in the first campaign</label>
                <input type="number" min={1} max={20} value={npVidCount}
                  onChange={e => setNpVidCount(Math.min(Math.max(Number(e.target.value) || 1, 1), 20))} className={inputCls} /></div>
              <p className={`text-xs ${(npKaloStats?.pending || 0) > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {(npKaloStats?.pending || 0) > 0 ? `✓ ${npKaloStats!.pending} videos ready for this launch` : '⚠ No videos yet — import the Kalodata file to enable launch'}
              </p>
              {npKaloMsg && <p className="text-xs text-slate-300">{npKaloMsg}</p>}
            </>
          )}
          {wf && (wf.result?.videos || wf.config?.prefillVideos) && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(wf.result?.videos || []).map((v: any, i: number) => (
                <p key={v.id || i} className="text-[11px] text-slate-400 truncate">🎬 ${Math.round(v.revenue || 0).toLocaleString()} rev · @{v.author || ''} {v.caption || v.id}</p>
              ))}
            </div>
          )}
        </div>);
      case 'schedule_daily': return (
        <div className="space-y-2">
          {errBox}
          <p className="text-xs text-slate-400">After the first campaign goes live, the engine schedules itself: every day at the same time it downloads the next 5 best unused videos from this product&apos;s pool, builds a <b>fresh ad set with a $15/day minimum spend</b> inside the same campaign, and goes live automatically — starting tomorrow.</p>
          {r.dailyScheduleId && (
            <p className="text-xs text-emerald-400">✓ Schedule created — manage it on the Schedules tab. Keep the pool fed: re-import a new Kalodata export anytime (dupes are skipped automatically).</p>
          )}
        </div>);
      case 'campaign': return (
        <div className="space-y-3">
          <div><label className={labelCls}>FB Ad Account</label>
            <select value={profileId} onChange={e => setProfileId(e.target.value)} className={inputCls} disabled={!!wf}>
              <option value="">— select —</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.profile_name || p.ad_account_name || p.ad_account_id}</option>)}
            </select></div>
          <div><label className={labelCls}>FB Page</label>
            <select value={pageId} onChange={e => setPageId(e.target.value)} className={inputCls} disabled={!!wf || pagesLoading}>
              <option value="">{pagesLoading ? 'loading…' : '— select —'}</option>
              {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          {!wf && (
            <div>
              <label className={labelCls}>Campaign</label>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                <button onClick={() => setCampaignMode('new')}
                  className={`text-xs rounded-lg py-1.5 border ${campaignMode === 'new' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                  Create new
                </button>
                <button onClick={() => setCampaignMode('existing')} disabled={!profileId}
                  className={`text-xs rounded-lg py-1.5 border disabled:opacity-40 ${campaignMode === 'existing' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                  Use existing
                </button>
              </div>
              {campaignMode === 'existing' && (
                <select value={existingCampaignId} onChange={e => setExistingCampaignId(e.target.value)} className={inputCls}>
                  <option value="">{campaigns.length ? '— pick campaign —' : 'loading campaigns…'}</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
                </select>
              )}
              {campaignMode === 'existing' && (
                <p className="text-[10px] text-slate-500 mt-1">A new ad set with your budget/schedule is added inside the chosen campaign.</p>
              )}
            </div>
          )}
          {wf?.config?.existingCampaignId && (
            <p className="text-xs text-slate-300">Attached to existing campaign {wf.config.existingCampaignId}</p>
          )}
          {errBox}
          {r.campaignId && (
            <p className="text-xs text-emerald-400">Campaign: {r.campaignId} — <a href={adsManagerUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">Ads Manager ↗</a></p>
          )}
        </div>);
      case 'adset': return (
        <div className="space-y-3">
          {errBox}
          {!wf ? (
            campaignMode === 'existing' ? (
              <>
                <div><label className={labelCls}>Ad set spend $/day</label>
                  <input type="number" min={0} step="1" value={minSpendTarget} onChange={e => setMinSpendTarget(e.target.value)}
                    placeholder="e.g. 10" className={inputCls} />
                  <p className="text-[9px] text-slate-500 mt-0.5">The campaign keeps its own budget untouched. CBO campaign → this is the ad set&apos;s minimum spend target; older ABO campaign → its daily budget.</p></div>
                <p className="text-[11px] text-slate-400">
                  Countries, pixel and optimization are copied from the ad sets already in the chosen campaign. Starts right away when live · runs until you turn it off.
                </p>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={labelCls}>Daily budget $ (campaign)</label>
                    <input type="number" min={1} value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} className={inputCls} /></div>
                  <div><label className={labelCls}>Min spend $ (ad set)</label>
                    <input type="number" min={0} step="1" value={minSpendTarget} onChange={e => setMinSpendTarget(e.target.value)}
                      placeholder="optional" className={inputCls} />
                    <p className="text-[9px] text-slate-500 mt-0.5">daily_min_spend_target</p></div>
                </div>
                <div><label className={labelCls}>Market language</label>
                  <select value={language} onChange={e => pickLanguage(e.target.value)} className={inputCls}>
                    {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  {language && <p className="text-[9px] text-blue-400 mt-0.5">Ad copy + image text in {LANGS[language].label.split(' ')[1]} · ad set only reaches people using FB in that language</p>}
                </div>
                <div><label className={labelCls}>Countries (comma-separated)</label>
                  <input value={countries} onChange={e => setCountries(e.target.value)} placeholder="US, CA, GB" className={inputCls} /></div>
                <p className="text-[11px] text-slate-400">
                  Starts right away when live · stays in the campaign and runs until you turn it off (${parseFloat(dailyBudget || '10').toFixed(2)}/day CBO).
                </p>
              </>
            )
          ) : (
            <p className="text-xs text-slate-300">
              {(wf.config.targeting?.countries || ['US']).join(', ')}{wf.config.language ? ` · ${String(wf.config.language).toUpperCase()} market` : ''} · ${(wf.config.dailyBudgetCents / 100).toFixed(2)}/day
              {' · runs until turned off'}
            </p>
          )}
          <p className="text-xs text-slate-400">
            Broad targeting — 18–65, all genders, Advantage+ audience OFF.{' '}
            {campaignMode !== 'existing' && (profile?.pixel_id ? `Optimizes for purchases via pixel ${profile.pixel_id}.` : 'No pixel on this profile — optimizes for link clicks.')}
          </p>
          {r.adSetId && (
            <p className="text-xs text-emerald-400">Ad set: {r.adSetId} — <a href={adsManagerUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">Ads Manager ↗</a></p>
          )}
        </div>);
      case 'ads': return (
        <div className="space-y-2">
          {errBox}
          <p className="text-xs text-slate-400">Each image is uploaded to Meta and becomes a paused ad carrying the copy + Shop Now → your landing URL.</p>
          {(r.adIds || []).filter(Boolean).map((id: string, i: number) => <p key={id} className="text-xs text-emerald-400">Ad {i + 1}: {id}</p>)}
        </div>);
      case 'activate': {
        const n = wf ? (wf.config.adCount || adCount) : adCount;
        const b = wf ? (wf.config.dailyBudgetCents / 100).toFixed(2) : parseFloat(dailyBudget || '10').toFixed(2);
        return (
        <div className="space-y-2">
          {errBox}
          {!wf && <button onClick={() => setGoLive(v => !v)}
            className={`w-full rounded-lg px-3 py-2 text-sm font-medium border ${goLive ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
            {goLive ? '⚡ Goes LIVE automatically when done' : 'Staying PAUSED (manual go-live in Ads Manager)'}
          </button>}
          <div className="bg-slate-800/60 rounded-lg p-2.5 space-y-1">
            <p className="text-[10px] text-slate-500 uppercase">What starts spending</p>
            {(wf ? !!wf.config.existingCampaignId : campaignMode === 'existing') ? (
              <p className="text-xs text-white">
                {n} ads join <span className="text-slate-300">{campaigns.find(c => c.id === (wf?.config?.existingCampaignId || existingCampaignId))?.name || 'the chosen campaign'}</span>
                {' '}· its budget is untouched{(wf?.config?.minSpendTargetCents || minSpendTarget) ? <> · <span className="text-amber-300 font-semibold">min ${wf?.config?.minSpendTargetCents ? (wf.config.minSpendTargetCents / 100).toFixed(2) : parseFloat(minSpendTarget).toFixed(2)}/day</span> guaranteed to this ad set</> : ''}
              </p>
            ) : (
              <p className="text-xs text-white">{n} ads · <span className="text-amber-300 font-semibold">${b}/day CBO</span> (budget on the campaign)</p>
            )}
            <p className="text-xs text-white">
              starts immediately when the run finishes · <span className="text-amber-400 font-semibold">runs until you turn it off</span>
            </p>
            <p className="text-[11px] text-slate-400">{profile?.profile_name || profile?.ad_account_id} → {pages.find(p => p.id === (wf?.config?.pageId || pageId))?.name || 'page'}</p>
          </div>
          <p className="text-xs text-slate-400">Flips ads → ad set → campaign to ACTIVE, in that order — nothing serves until the campaign flips last.</p>
          {wf?.steps.find(s => s.key === 'activate')?.status === 'done' && (
            <a href={adsManagerUrl} target="_blank" rel="noreferrer"
              className="block text-center bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg py-2">
              ✓ LIVE — open Ads Manager
            </a>
          )}
        </div>);
      }
      default: return null;
    }
  }

  return (
    <div className="h-[calc(100vh-0px)] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-5">
          <div>
            <h1 className="text-xl font-bold text-white">🚀 Launch Flow</h1>
            <p className="text-xs text-slate-400">Click any node to configure or inspect. Runs are fully autonomous — ads go live the moment they&apos;re built.</p>
          </div>
          <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button onClick={() => setFlowTab('ads')}
              className={`text-xs rounded-md px-3 py-1.5 font-medium transition-colors ${flowTab === 'ads' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              Ad Launch
            </button>
            <button onClick={() => setFlowTab('newProduct')}
              className={`text-xs rounded-md px-3 py-1.5 font-medium transition-colors ${flowTab === 'newProduct' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              🧪 New Product
            </button>
            <button onClick={() => setFlowTab('videos')}
              className={`text-xs rounded-md px-3 py-1.5 font-medium transition-colors ${flowTab === 'videos' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              🎬 Video Ads{vidStats?.pending ? ` (${vidStats.pending})` : ''}
            </button>
            <button onClick={() => setFlowTab('schedules')}
              className={`text-xs rounded-md px-3 py-1.5 font-medium transition-colors ${flowTab === 'schedules' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              ⏰ Schedules{schedules.filter(s => s.isActive).length ? ` (${schedules.filter(s => s.isActive).length})` : ''}
            </button>
          </div>
        </div>
        <div className={`flex items-center gap-3 ${flowTab !== 'ads' && flowTab !== 'newProduct' ? 'invisible' : ''}`}>
          {wf && <span className={`text-[11px] px-2 py-1 rounded-full ${
            wf.status === 'done' ? 'bg-emerald-900/50 text-emerald-400' : wf.status === 'error' ? 'bg-red-900/50 text-red-400'
            : wf.status === 'awaiting_approval' ? 'bg-amber-900/50 text-amber-400' : 'bg-blue-900/50 text-blue-400'
          }`}>{wf.status === 'awaiting_approval' ? '⏸ awaiting your approval' : wf.status}</span>}
          {!wf && <button onClick={npMode ? startNewProduct : start} disabled={(npMode ? !npReady : !ready) || creating}
            className="bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg px-5 py-2">
            {creating ? 'Starting…' : npMode ? '🧪 Launch end-to-end' : '▶ Run workflow'}
          </button>}
          {!wf && flowTab === 'ads' && <button onClick={() => { setSchedModal(true); setSchedMsg(''); }} disabled={!ready || creating}
            title="Run this exact configuration on a recurring schedule"
            className="bg-slate-800 border border-slate-700 hover:border-blue-500 disabled:opacity-40 text-slate-200 text-sm font-medium rounded-lg px-4 py-2">
            ⏰ Schedule
          </button>}
          {wf?.status === 'running' && !runningIds.includes(wf.id) && (
            <button onClick={() => void advanceLoop(wf.id)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg px-4 py-2">
              ▶ Resume run
            </button>
          )}
          {wf?.status === 'error' && !runningIds.includes(wf.id) && <button onClick={retry} className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-4 py-2">Retry + continue</button>}
          {wf && (
            <button onClick={() => { viewWf(null); setError(''); localStorage.removeItem('launch_active_wf'); }}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-4 py-2">New run</button>
          )}
          <Link href="/dashboard/static-ads" className="text-xs text-blue-400 hover:text-blue-300">← Picture Ads</Link>
        </div>
      </div>

      {/* Live runs strip — every unfinished workflow, across all concurrent loops */}
      {(() => {
        const merged: Record<string, Workflow> = {};
        for (const w of workflows) if (w.status === 'running' || w.status === 'awaiting_approval') merged[w.id] = w;
        for (const w of Object.values(liveWfs)) if (w.status === 'running' || w.status === 'awaiting_approval' || runningIds.includes(w.id)) merged[w.id] = w;
        const live = Object.values(merged);
        if (!live.length) return null;
        return (
          <div className="mx-6 mt-3 flex gap-2 flex-wrap">
            {live.map(w => {
              const driving = runningIds.includes(w.id);
              const done = w.steps.filter(s => s.status === 'done').length;
              return (
                <button key={w.id}
                  onClick={() => { viewWf(w); setError(''); if (w.status === 'running') void advanceLoop(w.id); }}
                  className={`flex items-center gap-2 text-xs rounded-lg px-3 py-1.5 border transition-colors ${
                    wf?.id === w.id ? 'border-blue-500 bg-blue-950/40 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'}`}>
                  {driving
                    ? <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    : <span className={`w-2 h-2 rounded-full flex-shrink-0 ${w.status === 'awaiting_approval' ? 'bg-amber-400 animate-pulse' : 'bg-blue-400'}`} />}
                  <span className="max-w-[16rem] truncate">{w.name}</span>
                  <span className="text-slate-500">{done}/{w.steps.length}</span>
                  {w.status === 'awaiting_approval' && <span className="text-amber-400">🚦 approve</span>}
                  {!driving && w.status === 'running' && <span className="text-emerald-400">▶ resume</span>}
                </button>
              );
            })}
          </div>
        );
      })()}

      {error && (flowTab === 'ads' || flowTab === 'newProduct') && <div className="mx-6 mt-3 bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-2">{error}</div>}

      {schedModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setSchedModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-96" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-white mb-3">⏰ Schedule this launch</p>
            <p className="text-[11px] text-slate-400 mb-3">Runs the exact configuration on the canvas — {batchMode ? `${batchCreatives!.length} selected ads` : `${adCount} fresh ads`}, ${dailyBudget}/day CBO — on a recurring schedule, fully server-side.</p>
            <div className="space-y-3">
              <div><label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Name</label>
                <input value={schedName} onChange={e => setSchedName(e.target.value)}
                  placeholder={`${products.find(p => p.id === productId)?.title || 'Launch'} — ${schedCadence}`}
                  className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Repeat</label>
                  <select value={schedCadence} onChange={e => setSchedCadence(e.target.value as any)} className={inputCls}>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                  </select></div>
                <div><label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Time (PST)</label>
                  <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} className={inputCls} /></div>
              </div>
              {schedCadence === 'weekly' && (
                <div><label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Day</label>
                  <select value={schedDay} onChange={e => setSchedDay(Number(e.target.value))} className={inputCls}>
                    {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select></div>
              )}
              <button onClick={() => setSchedAutoLive(v => !v)}
                className={`w-full rounded-lg px-3 py-2 text-sm font-medium border ${schedAutoLive ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                {schedAutoLive ? '⚡ Goes LIVE automatically each run' : 'Each run ends PAUSED (manual go-live)'}
              </button>
              {schedAutoLive && (
                <p className="text-[11px] text-amber-400">Every run spends real money without asking: ${dailyBudget}/day per campaign, running until you turn it off.</p>
              )}
              {schedMsg && <p className="text-xs text-red-400">{schedMsg}</p>}
              <div className="flex gap-2">
                <button onClick={saveSchedule} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg py-2">Save schedule</button>
                <button onClick={() => setSchedModal(false)} className="text-sm text-slate-400 hover:text-white px-3">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editSched && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setEditSched(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-[26rem] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-white mb-1">✏️ Edit schedule</p>
            <p className="text-[11px] text-slate-500 mb-3">{editSched.storeName} · every aspect editable — timing changes recompute the next run</p>
            <div className="space-y-3">
              <div><label className={labelCls}>Name</label>
                <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>Repeat</label>
                  <select value={editForm.cadence} onChange={e => setEditForm({ ...editForm, cadence: e.target.value })} className={inputCls}>
                    <option value="daily">Every day</option><option value="weekly">Every week</option>
                  </select></div>
                <div><label className={labelCls}>Time (PST)</label>
                  <input type="time" value={editForm.timeOfDay} onChange={e => setEditForm({ ...editForm, timeOfDay: e.target.value })} className={inputCls} /></div>
              </div>
              {editForm.cadence === 'weekly' && (
                <div><label className={labelCls}>Day</label>
                  <select value={editForm.dayOfWeek} onChange={e => setEditForm({ ...editForm, dayOfWeek: Number(e.target.value) })} className={inputCls}>
                    {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select></div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div><label className={labelCls}>Ads</label>
                  <input type="number" min={1} max={20} value={editForm.adCount} onChange={e => setEditForm({ ...editForm, adCount: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Budget $/day</label>
                  <input type="number" min={1} value={editForm.dailyBudget} onChange={e => setEditForm({ ...editForm, dailyBudget: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Min spend $</label>
                  <input type="number" min={0} value={editForm.minSpend} onChange={e => setEditForm({ ...editForm, minSpend: e.target.value })} placeholder="—" className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>Countries</label>
                  <input value={editForm.countries} onChange={e => setEditForm({ ...editForm, countries: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Market language</label>
                  <select value={editForm.language || ''} onChange={e => setEditForm({ ...editForm, language: e.target.value })} className={inputCls}>
                    {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select></div>
              </div>
              <div><label className={labelCls}>Custom details (every image)</label>
                <textarea rows={2} value={editForm.customInstructions} onChange={e => setEditForm({ ...editForm, customInstructions: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Landing page URL</label>
                <input value={editForm.landingUrl} onChange={e => setEditForm({ ...editForm, landingUrl: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Facebook Page</label>
                <select value={editForm.pageId} onChange={e => setEditForm({ ...editForm, pageId: e.target.value })} className={inputCls}>
                  {!editPages.some(p => p.id === editForm.pageId) && (
                    <option value={editForm.pageId}>{editPages.length ? '— pick page —' : 'loading pages…'}</option>
                  )}
                  {editPages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></div>
              <div><label className={labelCls}>Campaign</label>
                <select value={editForm.existingCampaignId || ''} onChange={e => setEditForm({ ...editForm, existingCampaignId: e.target.value })} className={inputCls}>
                  <option value="">🆕 New campaign each run</option>
                  {editForm.existingCampaignId && !editCampaigns.some(c => c.id === editForm.existingCampaignId) && (
                    <option value={editForm.existingCampaignId}>{editCampaigns.length ? `campaign ${editForm.existingCampaignId}` : 'loading campaigns…'}</option>
                  )}
                  {editCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.status && c.status !== 'ACTIVE' ? ` (${c.status.toLowerCase()})` : ''}</option>)}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">Pick an existing campaign → each run adds a fresh ad set inside it (shares its budget). New campaign → a separate dated campaign per run.</p></div>
              <button onClick={() => setEditForm({ ...editForm, autoLive: !editForm.autoLive })}
                className={`w-full rounded-lg px-3 py-2 text-sm font-medium border ${editForm.autoLive ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                {editForm.autoLive ? '⚡ Goes LIVE automatically each run' : 'Each run ends PAUSED (manual go-live)'}
              </button>
              {schedMsg && <p className="text-xs text-red-400">{schedMsg}</p>}
              <div className="flex gap-2">
                <button onClick={saveScheduleEdit} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg py-2">Save changes</button>
                <button onClick={() => setEditSched(null)} className="text-sm text-slate-400 hover:text-white px-3">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {flowTab === 'schedules' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl">
            <p className="text-sm text-slate-400 mb-4">Recurring launches run fully server-side — configure a launch on the Ad Launch tab and hit ⏰ Schedule. The runner checks every 5 minutes.</p>
            {schedules.length === 0 ? (
              <p className="text-sm text-slate-500 py-10 text-center">No schedules for this store yet.</p>
            ) : (
              <div className="space-y-2">
                {schedules.map(s => (
                  <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-4">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.isActive ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">
                        {s.storeName && <span className="text-[10px] bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 mr-1.5 text-slate-300">{s.storeName}</span>}
                        {s.name} {s.autoLive && <span className="text-[10px] text-amber-400">⚡ auto-live</span>}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {s.cadence === 'daily' ? 'Daily' : `Weekly (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dayOfWeek ?? 1]})`} at {s.timeOfDay} PST
                        · next: {new Date(s.nextRunAt).toLocaleString()}
                        · {s.config?.existingCampaignId ? '↪ existing campaign' : '🆕 new campaign/run'}
                      </p>
                      {s.lastResult && <p className="text-[11px] text-slate-500 truncate">last: {s.lastResult}</p>}
                    </div>
                    <button onClick={() => openScheduleEditor(s)}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 whitespace-nowrap">edit</button>
                    <button onClick={() => scheduleAction('schedule_run_now', s.id)}
                      className="text-[11px] text-blue-400 hover:text-blue-300 whitespace-nowrap">run now</button>
                    <button onClick={() => scheduleAction('schedule_toggle', s.id)}
                      className="text-[11px] text-slate-400 hover:text-white whitespace-nowrap">{s.isActive ? 'pause' : 'resume'}</button>
                    <button onClick={() => scheduleAction('schedule_delete', s.id)}
                      className="text-[11px] text-red-400 hover:text-red-300 whitespace-nowrap">delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : flowTab === 'videos' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl space-y-4">
            <p className="text-sm text-slate-400">Kalodata → Facebook: import the top-performing TikTok ads for a product, launch the best 9 in one CBO campaign, then let the daily schedule feed 3 videos + 2 picture ads every night.</p>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1"><label className={labelCls}>Store</label>
                  <select value={storeId} onChange={e => setStoreId(e.target.value)} className={inputCls}>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></div>
                <div className="text-center px-3">
                  <p className="text-xl font-bold text-white">{vidStats?.pending ?? 0}</p>
                  <p className="text-[10px] text-slate-500 uppercase">videos ready</p>
                </div>
                <div className="text-center px-3">
                  <p className="text-xl font-bold text-emerald-400">{vidStats?.used ?? 0}</p>
                  <p className="text-[10px] text-slate-500 uppercase">launched</p>
                </div>
              </div>
              <div>
                <label className={labelCls}>Import Kalodata export (.xlsx){productId ? ' — stored for the selected product' : ' — pick a product below to bind the videos to it'}</label>
                <input type="file" accept=".xlsx" disabled={vidUploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void uploadKalodata(f); e.target.value = ''; }}
                  className="w-full text-xs text-slate-400 file:bg-slate-800 file:border-0 file:text-slate-200 file:rounded-lg file:px-3 file:py-2 file:mr-3" />
                <label className={`${labelCls} mt-3`}>…or paste TikTok links (one per line)</label>
                <textarea rows={2} value={vidLinks} onChange={e => setVidLinks(e.target.value)}
                  placeholder="https://www.tiktok.com/@creator/video/1234567890…" className={inputCls} />
                {vidLinks.trim() && (
                  <button onClick={() => void importVideoLinks()} disabled={vidUploading}
                    className="mt-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
                    Import {vidLinks.split('\n').filter(s => s.includes('tiktok')).length} links
                  </button>
                )}
                {vidUploading && <p className="text-xs text-blue-400 mt-1">Importing…</p>}
                {vidMsg && <p className="text-xs text-slate-300 mt-1">{vidMsg}</p>}
              </div>
              {vidRecent.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {vidRecent.slice(0, 8).map(v => (
                    <p key={v.id} className="text-[11px] text-slate-400 truncate">
                      <span className={v.status === 'used' ? 'text-emerald-400' : v.status === 'failed' ? 'text-red-400' : 'text-slate-500'}>●</span>
                      {' '}${Math.round(v.revenue).toLocaleString()} rev · @{v.author} — {v.caption}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Your product (copy + landing)</label>
                  <select value={productId} onChange={e => setProductId(e.target.value)} className={inputCls}>
                    <option value="">— select —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select></div>
                <div><label className={labelCls}>Videos to launch</label>
                  <input type="number" min={1} max={20} value={vidCount} onChange={e => setVidCount(Math.min(Math.max(Number(e.target.value) || 1, 1), 20))} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>FB Ad Account</label>
                  <select value={profileId} onChange={e => setProfileId(e.target.value)} className={inputCls}>
                    <option value="">—</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.profile_name || p.ad_account_id}</option>)}
                  </select></div>
                <div><label className={labelCls}>FB Page</label>
                  <select value={pageId} onChange={e => setPageId(e.target.value)} className={inputCls} disabled={pagesLoading}>
                    <option value="">{pagesLoading ? '…' : '—'}</option>
                    {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></div>
                <div><label className={labelCls}>Budget $/day (CBO)</label>
                  <input type="number" min={1} value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} className={inputCls} /></div>
              </div>
              <div><label className={labelCls}>Landing URL {landingLoading ? '· resolving…' : ''}</label>
                <input value={landingUrl} onChange={e => setLandingUrl(e.target.value)} className={inputCls} placeholder="auto-resolves when product picked" /></div>
              <button onClick={startVideoLaunch}
                disabled={creating || !storeId || !productId || !profileId || !pageId || !landingUrl.startsWith('http') || !(vidStats?.pending)}
                className="w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 text-white font-semibold rounded-lg py-3">
                {creating ? 'Starting…' : `🎬 Launch top ${vidCount} videos in one CBO campaign`}
              </button>
            </div>
            {wf && (wf.config?.videoCount || 0) > 0 && StepRunPanel({ w: wf })}
          </div>
        </div>
      ) : (
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 bg-slate-950">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelectedNode(n.id)}
            fitView proOptions={{ hideAttribution: true }}
            nodesDraggable={false} nodesConnectable={false} zoomOnDoubleClick={false}
          >
            <Background color="#1e293b" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Inspector panel */}
        <div className="w-80 border-l border-slate-800 bg-slate-900 p-4 overflow-y-auto">
          <p className="text-sm font-semibold text-white mb-1">
            {(npMode ? NP_NODE_DEFS : NODE_DEFS).find(d => d.id === selectedNode)?.icon} {(npMode ? NP_NODE_DEFS : NODE_DEFS).find(d => d.id === selectedNode)?.title}
          </p>
          <div className="border-t border-slate-800 pt-3 mt-2">
            {/* Plain function call, NOT <Inspector /> — an inline-defined
                component remounts on every parent render, killing input focus
                after each keystroke */}
            {Inspector()}
          </div>

          {/* Past runs */}
          <div className="mt-6 border-t border-slate-800 pt-3">
            <p className={labelCls}>Past runs</p>
            {workflows.slice(0, 8).map(w => (
              <div key={w.id} className="flex items-center gap-2 py-1.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  w.status === 'done' ? 'bg-emerald-400' : w.status === 'error' ? 'bg-red-400'
                  : w.status === 'awaiting_approval' ? 'bg-amber-400' : w.status === 'cancelled' ? 'bg-slate-500' : 'bg-blue-400'
                }`} />
                <button onClick={() => { viewWf(w); setError(''); if (w.status === 'running') void advanceLoop(w.id); }}
                  className="text-xs text-slate-300 hover:text-white truncate text-left flex-1">{w.name}</button>
                <span className="text-[9px] text-slate-500">{w.steps.filter(s => s.status === 'done').length}/{w.steps.length}</span>
              </div>
            ))}
            {workflows.length === 0 && <p className="text-xs text-slate-600">none yet</p>}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
