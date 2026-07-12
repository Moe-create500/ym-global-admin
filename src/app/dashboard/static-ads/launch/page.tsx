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
  { id: 'gate_launch', icon: '🚦', title: 'Launch Gate', stepKeys: ['gate_launch'] },
  { id: 'activate', icon: '⚡', title: 'Go Live', stepKeys: ['activate'] },
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

// ─── New Product Launch (scaffold tab): planned end-to-end flow for launching
// a brand-new product — Shopify product + lander creation before the ad stages ───
const NEW_PRODUCT_DEFS = [
  { id: 'np_brief', icon: '🧬', title: 'Product Brief', subtitle: 'name, angle, price, photos' },
  { id: 'np_shopify', icon: '🛍️', title: 'Create Product', subtitle: 'on Shopify via central creds' },
  { id: 'np_lander', icon: '📄', title: 'Landing Page', subtitle: 'template-clone product lander' },
  { id: 'np_audience', icon: '🧠', title: 'Audience', subtitle: 'Fable 5 builds the buyer' },
  { id: 'np_content', icon: '✍️', title: 'Content & Copy', subtitle: 'page + ad copy' },
  { id: 'np_images', icon: '🖼️', title: 'Picture Ads', subtitle: 'from proven templates' },
  { id: 'np_gate', icon: '🛑', title: 'Review Gate', subtitle: 'approve everything' },
  { id: 'np_campaign', icon: '📣', title: 'Campaign + Ad Set', subtitle: 'budget, schedule, expiry' },
  { id: 'np_launch', icon: '🚦', title: 'Launch Gate', subtitle: 'final approval' },
  { id: 'np_live', icon: '⚡', title: 'Go Live', subtitle: 'bounded spend' },
];

function NewProductScaffold() {
  const PER_ROW = 5;
  const nodes: Node<FlowNodeData>[] = NEW_PRODUCT_DEFS.map((d, i) => {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const rowEnd = col === PER_ROW - 1 && i < NEW_PRODUCT_DEFS.length - 1;
    return {
      id: d.id, type: 'flowNode',
      position: { x: 40 + col * 230, y: 40 + row * 230 },
      data: {
        icon: d.icon, title: d.title, subtitle: d.subtitle, status: 'idle' as NodeStatus,
        tpos: col === 0 && row > 0 ? Position.Top : Position.Left,
        spos: rowEnd ? Position.Bottom : Position.Right,
      },
    };
  });
  const edges: Edge[] = NEW_PRODUCT_DEFS.slice(0, -1).map((d, i) => ({
    id: `${d.id}-${NEW_PRODUCT_DEFS[i + 1].id}`, source: d.id, target: NEW_PRODUCT_DEFS[i + 1].id,
    type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#475569', width: 16, height: 16 },
    style: { stroke: '#475569', strokeWidth: 2 },
  }));
  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 bg-slate-950">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView
          proOptions={{ hideAttribution: true }} nodesDraggable={false} nodesConnectable={false} zoomOnDoubleClick={false}>
          <Background color="#1e293b" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="w-80 border-l border-slate-800 bg-slate-900 p-4 overflow-y-auto">
        <p className="text-sm font-semibold text-white mb-2">🧪 New Product Launch</p>
        <div className="bg-amber-900/20 border border-amber-800/40 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-amber-300">Scaffold — this workflow is being built. The Ad Launch tab is fully operational today.</p>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Goes one level upstream of Ad Launch: start from a product <span className="text-slate-200">brief</span> instead of an
          existing product. The workflow will create the product on Shopify through the centralized credentials, clone a proven
          landing-page template with Fable 5-written content, then flow into the same audience → picture ads → gated campaign
          pipeline — one run from idea to bounded live spend.
        </p>
        <p className="text-xs text-slate-500 mt-3">Same guarantees as Ad Launch: everything created paused, two approval gates, resumable steps, FB-enforced expiry.</p>
      </div>
    </div>
  );
}

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
  const [durationDays, setDurationDays] = useState(7);

  // Batch mode: launched from the Picture Ads gallery with pre-selected ads
  const [batchCreatives, setBatchCreatives] = useState<{ id: string; imageUrl: string; templateName: string; productId: string | null }[] | null>(null);
  const [campaignMode, setCampaignMode] = useState<'new' | 'existing'>('new');
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([]);
  const [existingCampaignId, setExistingCampaignId] = useState('');
  const batchMode = !!batchCreatives?.length;

  const [flowTab, setFlowTab] = useState<'ads' | 'newProduct' | 'schedules'>('ads');

  // Recurring launch schedules
  interface Schedule { id: string; name: string; cadence: string; timeOfDay: string; dayOfWeek: number | null; autoLive: boolean; isActive: boolean; lastRunAt: string | null; lastResult: string | null; nextRunAt: string }
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
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [selectedNode, setSelectedNode] = useState<string>('product');
  const runningRef = useRef(false);

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
      setWorkflows(d.workflows || []);
      setProfiles(d.profiles || []);
      setShopifyDomain(d.shopifyDomain || '');
      // Never prefill the homepage — the product-link resolver fills the real
      // product page once a product is chosen; ads go to product pages.
      setLandingUrl('');
      if ((d.profiles || []).length === 1) setProfileId(d.profiles[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!storeId) return;
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

  // ─── Engine driving ───
  async function advanceLoop(wfId: string) {
    runningRef.current = true; setRunning(true);
    while (runningRef.current) {
      try {
        const res = await fetch('/api/static-ads/workflow', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'advance', id: wfId }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'advance failed');
        setWf(d.workflow);
        if (d.workflow.status !== 'running') break; // done / error / awaiting_approval
      } catch (e: any) { setError(e.message); break; }
    }
    runningRef.current = false; setRunning(false);
    loadStoreData(storeId);
  }

  async function start() {
    if (!ready) return;
    setError('');
    const res = await fetch('/api/static-ads/workflow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', storeId, productId, config: launchConfig() }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error || 'create failed'); return; }
    setWf(d.workflow);
    void advanceLoop(d.workflow.id);
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

  const loadSchedules = useCallback((sid: string) => {
    fetch(`/api/static-ads/workflow?schedules=1&storeId=${sid}`).then(r => r.json())
      .then(d => setSchedules(d.schedules || [])).catch(() => {});
  }, []);

  useEffect(() => { if (storeId) loadSchedules(storeId); }, [storeId, loadSchedules]);

  function launchConfig() {
    return {
      profileId, pageId, landingUrl, adCount,
      dailyBudgetCents: Math.round(parseFloat(dailyBudget || '10') * 100),
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
    loadSchedules(storeId);
    setFlowTab('schedules');
  }

  async function scheduleAction(action: string, id: string) {
    await fetch('/api/static-ads/workflow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    });
    loadSchedules(storeId);
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
    if (isCurrent && running) return { status: 'running', progress: steps.length > 1 ? `${done}/${steps.length}` : undefined };
    return { status: 'pending', progress: steps.length > 1 && done > 0 ? `${done}/${steps.length}` : undefined };
  }

  const activeDefs = useMemo(() => {
    let defs = NODE_DEFS;
    if (batchMode) {
      // Batch: ads already exist — no generation nodes; a fallback audience
      // step (creatives without one) maps into the Copy node
      defs = defs.filter(d => d.id !== 'audience' && d.id !== 'images')
        .map(d => d.id === 'copy' ? { ...d, stepKeys: ['audience', 'copy'] } : d);
    }
    return defs.filter(d => {
      if (!goLive && (d.id === 'gate_launch' || d.id === 'activate')) return !!wf && wf.steps.some(s => s.key === d.id);
      return true;
    });
  }, [goLive, wf, batchMode]);

  // Both rows read left→right (natural reading order); the row transition is a
  // stepped return edge routed in the gap between rows.
  const PER_ROW = 5;
  const nodes: Node<FlowNodeData>[] = useMemo(() => activeDefs.map((d, i) => {
    const st = d.id === 'product' ? { status: (productId ? 'done' : 'idle') as NodeStatus } : nodeStatus(d.stepKeys);
    const subtitle =
      d.id === 'product' ? (batchMode ? `${batchCreatives!.length} selected ads` : (products.find(p => p.id === productId)?.title || 'pick a product'))
      : d.id === 'audience' ? (wf?.result?.audience?.name || 'Fable 5 auto-generates')
      : d.id === 'copy' ? (wf?.result?.copy?.headline || 'Fable 5 writes it')
      : d.id === 'images' ? `${wf?.config?.adCount || adCount} ads from proven templates`
      : d.id === 'campaign' ? (campaignMode === 'existing'
          ? (campaigns.find(c => c.id === (wf?.config?.existingCampaignId || existingCampaignId))?.name || 'existing campaign')
          : (profile?.profile_name || 'FB campaign (paused)'))
      : d.id === 'adset' ? `$${wf?.config ? (wf.config.dailyBudgetCents / 100).toFixed(0) : dailyBudget}/day · ${
          (wf?.config?.schedule?.durationDays ?? durationDays) > 0 ? `${wf?.config?.schedule?.durationDays ?? durationDays}d cap` : 'no end'}`
      : d.id === 'ads' ? 'upload + attach copy (paused)'
      : d.id === 'gate_launch' ? 'final approval before spend'
      : 'flips everything ACTIVE';

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
  }), [activeDefs, wf, productId, products, profile, adCount, dailyBudget, running, batchMode, batchCreatives, campaignMode, campaigns, existingCampaignId, durationDays]);

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
  const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500';
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5';

  const adsManagerUrl = profile
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${(profile.ad_account_id || '').replace('act_', '')}`
    : '';

  // ─── Inspector for the selected node ───
  function Inspector() {
    const r = wf?.result || {};
    const def = NODE_DEFS.find(d => d.id === selectedNode);
    const nodeErr = wf?.steps.find(s =>
      s.status === 'error' && (def?.stepKeys || []).some(k => k.endsWith('_') ? s.key.startsWith(k) : s.key === k));
    const errBox = nodeErr ? (
      <div className="mb-3 bg-red-900/30 border border-red-800 text-red-300 text-xs rounded-lg px-3 py-2">
        <p className="font-semibold mb-0.5">Step failed:</p>{nodeErr.detail}
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
            <>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>Daily budget $</label>
                  <input type="number" min={1} value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>Days to run</label>
                  <input type="number" min={0} max={90} value={durationDays}
                    onChange={e => setDurationDays(Math.min(Math.max(Number(e.target.value) || 0, 0), 90))} className={inputCls} />
                  <p className="text-[9px] text-slate-500 mt-0.5">0 = until stopped</p></div>
              </div>
              <div><label className={labelCls}>Countries (comma-separated)</label>
                <input value={countries} onChange={e => setCountries(e.target.value)} placeholder="US, CA, GB" className={inputCls} /></div>
              <p className={`text-[11px] ${durationDays > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {durationDays > 0
                  ? `Starts right away when live · auto-stops after ${durationDays} days — max total spend $${(parseFloat(dailyBudget || '10') * durationDays).toFixed(2)}. Facebook enforces the end date.`
                  : '⚠ No end date — runs until you stop it manually.'}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-300">
              {(wf.config.targeting?.countries || ['US']).join(', ')} · ${(wf.config.dailyBudgetCents / 100).toFixed(2)}/day
              {(wf.config.schedule?.durationDays ?? 0) > 0
                ? ` · auto-stops after ${wf.config.schedule.durationDays}d (max $${((wf.config.dailyBudgetCents * wf.config.schedule.durationDays) / 100).toFixed(2)})`
                : ' · no end date'}
            </p>
          )}
          <p className="text-xs text-slate-400">
            Broad targeting — 18–65, all genders, Advantage+ audience OFF.{' '}
            {campaignMode === 'existing'
              ? 'Pixel + optimization are copied from the ad sets already in the chosen campaign.'
              : profile?.pixel_id ? `Optimizes for purchases via pixel ${profile.pixel_id}.` : 'No pixel on this profile — optimizes for link clicks.'}
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
      case 'gate_launch': {
        const n = wf ? (wf.config.adCount || adCount) : adCount;
        const b = wf ? (wf.config.dailyBudgetCents / 100).toFixed(2) : parseFloat(dailyBudget || '10').toFixed(2);
        const dur = wf ? (wf.config.schedule?.durationDays ?? 0) : durationDays;
        const endD = dur > 0 ? new Date(Date.now() + dur * 86_400_000) : null;
        return (
        <div className="space-y-3">
          {!wf && <button onClick={() => setGoLive(v => !v)}
            className={`w-full rounded-lg px-3 py-2 text-sm font-medium border ${goLive ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
            {goLive ? 'Will go LIVE after this gate' : 'Staying PAUSED (no gate needed)'}
          </button>}
          <div className="bg-slate-800/60 rounded-lg p-2.5 space-y-1">
            <p className="text-[10px] text-slate-500 uppercase">What approval starts</p>
            <p className="text-xs text-white">{n} ads · <span className="text-amber-300 font-semibold">${b}/day</span></p>
            <p className="text-xs text-white">
              starts immediately → {endD
                ? <>{endD.toLocaleDateString()} · <span className="text-emerald-400 font-semibold">max ${(parseFloat(b) * dur).toFixed(2)} total</span>, FB auto-stops it</>
                : <span className="text-amber-400 font-semibold">no end date — runs until stopped (~${(parseFloat(b) * 30).toFixed(0)}/mo)</span>}
            </p>
            <p className="text-[11px] text-slate-400">{profile?.profile_name || profile?.ad_account_id} → {pages.find(p => p.id === (wf?.config?.pageId || pageId))?.name || 'page'}</p>
          </div>
          <p className="text-xs text-slate-400">Everything already exists on Facebook, paused. Review it in <a href={adsManagerUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">Ads Manager ↗</a> first if you want.</p>
          {currentGate?.key === 'gate_launch' && (
            <button onClick={() => approve('gate_launch')} className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg py-2.5 text-sm">
              🚦 Approve — GO LIVE, start spending
            </button>)}
        </div>);
      }
      case 'activate': return (
        <div className="space-y-2">
          {errBox}
          <p className="text-xs text-slate-400">Flips ads → ad set → campaign to ACTIVE, in that order — nothing serves until the campaign flips last.</p>
          {wf?.steps.find(s => s.key === 'activate')?.status === 'done' && (
            <a href={adsManagerUrl} target="_blank" rel="noreferrer"
              className="block text-center bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg py-2">
              ✓ LIVE — open Ads Manager
            </a>
          )}
        </div>);
      default: return null;
    }
  }

  return (
    <div className="h-[calc(100vh-0px)] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-5">
          <div>
            <h1 className="text-xl font-bold text-white">🚀 Launch Flow</h1>
            <p className="text-xs text-slate-400">Click any node to configure or inspect. Gates hold the run for your approval.</p>
          </div>
          <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button onClick={() => setFlowTab('ads')}
              className={`text-xs rounded-md px-3 py-1.5 font-medium transition-colors ${flowTab === 'ads' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              Ad Launch
            </button>
            <button onClick={() => setFlowTab('newProduct')}
              className={`text-xs rounded-md px-3 py-1.5 font-medium transition-colors ${flowTab === 'newProduct' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              🧪 New Product Launch
            </button>
            <button onClick={() => setFlowTab('schedules')}
              className={`text-xs rounded-md px-3 py-1.5 font-medium transition-colors ${flowTab === 'schedules' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              ⏰ Schedules{schedules.filter(s => s.isActive).length ? ` (${schedules.filter(s => s.isActive).length})` : ''}
            </button>
          </div>
        </div>
        <div className={`flex items-center gap-3 ${flowTab !== 'ads' ? 'invisible' : ''}`}>
          {wf && <span className={`text-[11px] px-2 py-1 rounded-full ${
            wf.status === 'done' ? 'bg-emerald-900/50 text-emerald-400' : wf.status === 'error' ? 'bg-red-900/50 text-red-400'
            : wf.status === 'awaiting_approval' ? 'bg-amber-900/50 text-amber-400' : 'bg-blue-900/50 text-blue-400'
          }`}>{wf.status === 'awaiting_approval' ? '⏸ awaiting your approval' : wf.status}</span>}
          {!wf && <button onClick={start} disabled={!ready || running}
            className="bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg px-5 py-2">
            ▶ Run workflow
          </button>}
          {!wf && <button onClick={() => { setSchedModal(true); setSchedMsg(''); }} disabled={!ready || running}
            title="Run this exact configuration on a recurring schedule"
            className="bg-slate-800 border border-slate-700 hover:border-blue-500 disabled:opacity-40 text-slate-200 text-sm font-medium rounded-lg px-4 py-2">
            ⏰ Schedule
          </button>}
          {wf?.status === 'error' && !running && <button onClick={retry} className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-4 py-2">Retry + continue</button>}
          {wf && (wf.status === 'done' || wf.status === 'cancelled') && (
            <button onClick={() => { setWf(null); setError(''); }} className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-4 py-2">New run</button>
          )}
          <Link href="/dashboard/static-ads" className="text-xs text-blue-400 hover:text-blue-300">← Picture Ads</Link>
        </div>
      </div>

      {error && flowTab === 'ads' && <div className="mx-6 mt-3 bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-2">{error}</div>}

      {schedModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setSchedModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-96" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-white mb-3">⏰ Schedule this launch</p>
            <p className="text-[11px] text-slate-400 mb-3">Runs the exact configuration on the canvas — {batchMode ? `${batchCreatives!.length} selected ads` : `${adCount} fresh ads`}, ${dailyBudget}/day{durationDays > 0 ? `, ${durationDays}d cap` : ''} — on a recurring schedule, fully server-side.</p>
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
                <p className="text-[11px] text-amber-400">Every run spends real money without asking: ${dailyBudget}/day{durationDays > 0 ? ` × ${durationDays}d = max $${(parseFloat(dailyBudget || '10') * durationDays).toFixed(0)} per run` : ' with no end date'}.</p>
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
                      <p className="text-sm text-white truncate">{s.name} {s.autoLive && <span className="text-[10px] text-amber-400">⚡ auto-live</span>}</p>
                      <p className="text-[11px] text-slate-400">
                        {s.cadence === 'daily' ? 'Daily' : `Weekly (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dayOfWeek ?? 1]})`} at {s.timeOfDay} PST
                        · next: {new Date(s.nextRunAt).toLocaleString()}
                      </p>
                      {s.lastResult && <p className="text-[11px] text-slate-500 truncate">last: {s.lastResult}</p>}
                    </div>
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
      ) : flowTab === 'newProduct' ? <NewProductScaffold /> : (
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
            {NODE_DEFS.find(d => d.id === selectedNode)?.icon} {NODE_DEFS.find(d => d.id === selectedNode)?.title}
          </p>
          <div className="border-t border-slate-800 pt-3 mt-2">
            <Inspector />
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
                <button onClick={() => { setWf(w); setError(''); if (w.status === 'running') void advanceLoop(w.id); }}
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
