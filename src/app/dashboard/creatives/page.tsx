'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';

interface Store { id: string; name: string; }

interface Ad {
  adId: string;
  adName: string;
  status: string | null;
  // Creative context
  creativeUrl: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  linkUrl: string | null;
  previewUrl: string | null;
  fbVideoId: string | null;
  videoSourceUrl: string | null;
  videoAnalysis: string | null;
  // Metrics
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  roas: number;
  cpa: number;
  isWinner: boolean;
}

interface AdSet {
  adSetId: string;
  adSetName: string;
  campaignId: string;
  campaignName: string;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalPurchases: number;
  totalReach: number;
  roas: number;
  cpa: number;
  ctr: number;
  ads: Ad[];
}

interface Creative {
  id: string;
  store_id: string;
  type: string;
  title: string;
  description: string | null;
  file_url: string | null;
  thumbnail_url: string | null;
  angle: string | null;
  nb_video_id: string | null;
  nb_status: string | null;
  status: string;
  created_at: string;
  batch_id?: string | null;
  batch_index?: number | null;
}

interface PromptItem {
  prompt: string;
  angle: string;
  headline: string;
  adCopy: string;
}

interface Batch {
  id: string;
  store_id: string;
  product_id: string | null;
  batch_number: number;
  name: string;
  status: string;
  parent_batch_id: string | null;
  product_context: string | null;
  offer: string | null;
  winning_angles: string | null;
  video_prompts: string | null;
  image_prompts: string | null;
  total_videos: number;
  total_images: number;
  completed_videos: number;
  completed_images: number;
  failed_count: number;
  total_spend_cents: number;
  total_purchases: number;
  total_revenue_cents: number;
  avg_roas: number;
  winner_count: number;
  created_at: string;
  product_title?: string;
  product_image?: string;
}

interface Product {
  id: string;
  title: string;
  image_url: string | null;
  images: string | null;
  description: string | null;
  price_cents: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Proxy Sora URLs through our API (they need auth headers) */
function mediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('https://api.openai.com/v1/videos/')) {
    return `/api/creatives/media?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function CreativesContent() {
  const searchParams = useSearchParams();
  const storeFilter = searchParams.get('storeId') || '';

  const [stores, setStores] = useState<Store[]>([]);
  const [tab, setTab] = useState<'performance' | 'generated' | 'batches'>('performance');
  const [loading, setLoading] = useState(true);

  // Performance tab state
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [dateRange, setDateRange] = useState('14');
  const [sortBy, setSortBy] = useState('spend');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Generated tab state
  const [creatives, setCreatives] = useState<Creative[]>([]);

  // Batches tab state
  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [batchCreatives, setBatchCreatives] = useState<Record<string, Creative[]>>({});

  // New Batch wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizProductId, setWizProductId] = useState('');
  const [wizOffer, setWizOffer] = useState('');
  // wizAngles removed — auto-extracted from winning ads now
  const [wizName, setWizName] = useState('');
  const [wizVideoPrompts, setWizVideoPrompts] = useState<PromptItem[]>([]);
  const [wizImagePrompts, setWizImagePrompts] = useState<PromptItem[]>([]);
  const [wizBatchId, setWizBatchId] = useState('');
  const [wizLoading, setWizLoading] = useState(false);
  const [wizError, setWizError] = useState('');

  // Generate modal state
  const [showGenerate, setShowGenerate] = useState(false);
  const [genType, setGenType] = useState<'text-to-video' | 'image-to-video'>('text-to-video');
  const [genPrompt, setGenPrompt] = useState('');
  const [genTitle, setGenTitle] = useState('');
  const [genAngle, setGenAngle] = useState('');
  const [genImageUrls, setGenImageUrls] = useState('');
  const [genEngine, setGenEngine] = useState<'sora' | 'veo' | 'minimax' | 'minimax-image' | 'nanobanana'>('sora');
  const [genResolution, setGenResolution] = useState('720p');
  const [genDuration, setGenDuration] = useState('5');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<any>(null);

  // Pre-fill from winner ad
  const [prefillAdName, setPrefillAdName] = useState('');

  // Video analysis state
  const [analyzingAdId, setAnalyzingAdId] = useState<string | null>(null);
  const [adAnalysis, setAdAnalysis] = useState<Record<string, string>>({});

  // Recreate from DNA state
  const [recreateAd, setRecreateAd] = useState<Ad | null>(null);
  const [recreateProductId, setRecreateProductId] = useState('');
  const [recreateEngine, setRecreateEngine] = useState('sora');
  const [recreateDuration, setRecreateDuration] = useState('20');
  const [recreating, setRecreating] = useState(false);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    if (storeFilter) {
      fetch(`/api/products?storeId=${storeFilter}`).then(r => r.json()).then(d => setProducts(d.products || []));
    }
  }, [storeFilter]);

  useEffect(() => {
    if (tab === 'performance') loadPerformance();
    else if (tab === 'generated') loadCreatives();
    else if (tab === 'batches') loadBatches();
  }, [storeFilter, tab, dateRange, sortBy]);

  async function loadPerformance() {
    if (!storeFilter) { setAdSets([]); setLoading(false); return; }
    setLoading(true);
    const from = new Date(Date.now() - parseInt(dateRange) * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const to = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const res = await fetch(`/api/ads/performance?storeId=${storeFilter}&from=${from}&to=${to}&sortBy=${sortBy}`);
    const data = await res.json();
    setAdSets(data.adSets || []);
    // Load saved video analyses into state
    const saved: Record<string, string> = {};
    for (const adSet of data.adSets || []) {
      for (const ad of adSet.ads || []) {
        if (ad.videoAnalysis) saved[ad.adId] = ad.videoAnalysis;
      }
    }
    if (Object.keys(saved).length > 0) {
      setAdAnalysis(prev => ({ ...prev, ...saved }));
    }
    setLoading(false);
  }

  async function loadCreatives() {
    setLoading(true);
    const params = new URLSearchParams();
    if (storeFilter) params.set('storeId', storeFilter);
    const res = await fetch(`/api/creatives?${params}`);
    const data = await res.json();
    setCreatives(data.creatives || []);
    setLoading(false);
  }

  function toggleExpand(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  // Selected ad for detail view
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);

  async function analyzeAdVideo(ad: Ad, file?: File) {
    if (!storeFilter) return;
    setAnalyzingAdId(ad.adId);
    try {
      let res: Response;
      if (file) {
        // Direct file upload
        const formData = new FormData();
        formData.append('videoFile', file);
        formData.append('adId', ad.adId);
        formData.append('storeId', storeFilter);
        res = await fetch('/api/creatives/analyze', { method: 'POST', body: formData });
      } else {
        // Auto-resolve from Facebook video_source_url or fb_video_id
        res = await fetch('/api/creatives/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adId: ad.adId, storeId: storeFilter }),
        });
      }
      const data = await res.json();
      if (data.analysis) {
        setAdAnalysis(prev => ({ ...prev, [ad.adId]: data.analysis }));
      } else {
        setAdAnalysis(prev => ({ ...prev, [ad.adId]: `Error: ${data.error || 'Analysis failed'}` }));
      }
    } catch (err: any) {
      setAdAnalysis(prev => ({ ...prev, [ad.adId]: `Error: ${err.message}` }));
    }
    setAnalyzingAdId(null);
  }

  async function handleRecreate() {
    if (!storeFilter || !recreateAd || !recreateProductId) return;
    setRecreating(true);
    try {
      const res = await fetch('/api/creatives/recreate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: storeFilter,
          adId: recreateAd.adId,
          productId: recreateProductId,
          engine: recreateEngine,
          duration: parseInt(recreateDuration),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRecreateAd(null);
        setTab('generated');
        loadCreatives();
      } else {
        alert(data.error || 'Failed to recreate');
      }
    } catch (err: any) {
      alert(err.message);
    }
    setRecreating(false);
  }

  function openGenerateFromWinner(ad: Ad) {
    setPrefillAdName(ad.adName);
    setGenTitle(`${ad.adName} - variation`);
    const bodyContext = ad.body ? `\n\nOriginal ad copy: "${ad.body}"` : '';
    const headlineContext = ad.headline ? `\nHeadline: "${ad.headline}"` : '';
    setGenPrompt(`Create a product ad video similar to "${ad.adName}". High-converting e-commerce style, fast-paced, eye-catching visuals.${headlineContext}${bodyContext}`);
    setGenAngle('');
    setShowGenerate(true);
  }

  function formatCta(cta: string | null): string {
    if (!cta) return '';
    return cta.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  async function handleGenerate() {
    if (!storeFilter || !genPrompt || !genTitle) return;
    setGenerating(true);
    setGenResult(null);
    const res = await fetch('/api/creatives/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: storeFilter,
        engine: genEngine,
        type: genType,
        prompt: genPrompt,
        title: genTitle,
        angle: genAngle || undefined,
        imageUrls: genType === 'image-to-video' ? genImageUrls.split('\n').filter(Boolean) : undefined,
        resolution: genResolution,
        duration: parseInt(genDuration),
      }),
    });
    const data = await res.json();
    setGenResult(data);
    setGenerating(false);
    if (data.success) {
      loadCreatives();
    }
  }

  async function pollStatus(id: string) {
    const res = await fetch(`/api/creatives/generate?id=${id}`);
    const data = await res.json();
    if (data.creative) {
      setCreatives(prev => prev.map(c => c.id === id ? { ...c, ...data.creative } : c));
    }
  }

  async function loadBatches() {
    if (!storeFilter) { setBatches([]); setLoading(false); return; }
    setLoading(true);
    const res = await fetch(`/api/batches?storeId=${storeFilter}`);
    const data = await res.json();
    setBatches(data.batches || []);
    setLoading(false);
  }

  async function loadBatchDetail(batchId: string) {
    const res = await fetch(`/api/batches/${batchId}/status`);
    const data = await res.json();
    if (data.creatives) {
      setBatchCreatives(prev => ({ ...prev, [batchId]: data.creatives }));
    }
    // Refresh batch in list
    loadBatches();
  }

  async function startWizard() {
    setShowWizard(true);
    setWizardStep(1);
    setWizProductId('');
    setWizOffer('');
    // wizAngles removed — auto-extracted
    setWizName('');
    setWizVideoPrompts([]);
    setWizImagePrompts([]);
    setWizBatchId('');
    setWizError('');
  }

  async function wizCreateBatch() {
    if (!storeFilter || !wizName) return;
    setWizLoading(true);
    setWizError('');
    try {
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: storeFilter,
          productId: wizProductId || undefined,
          name: wizName,
          offer: wizOffer || undefined,
          // winningAngles auto-extracted from ad performance data
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWizBatchId(data.batch.id);
        // Auto-generate prompts
        const promptRes = await fetch(`/api/batches/${data.batch.id}/generate-prompts`, { method: 'POST' });
        const promptData = await promptRes.json();
        if (promptData.success) {
          setWizVideoPrompts(promptData.videoPrompts || []);
          setWizImagePrompts(promptData.imagePrompts || []);
          setWizardStep(2);
        } else {
          setWizError(promptData.error || 'Failed to generate prompts');
        }
      } else {
        setWizError(data.error || 'Failed to create batch');
      }
    } catch (err: any) {
      setWizError(err.message);
    }
    setWizLoading(false);
  }

  async function wizRegeneratePrompts() {
    if (!wizBatchId) return;
    setWizLoading(true);
    setWizError('');
    try {
      const res = await fetch(`/api/batches/${wizBatchId}/generate-prompts`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setWizVideoPrompts(data.videoPrompts || []);
        setWizImagePrompts(data.imagePrompts || []);
      } else {
        setWizError(data.error || 'Failed to regenerate');
      }
    } catch (err: any) {
      setWizError(err.message);
    }
    setWizLoading(false);
  }

  async function wizStartGeneration() {
    if (!wizBatchId) return;
    setWizLoading(true);
    setWizError('');
    try {
      const res = await fetch(`/api/batches/${wizBatchId}/generate-creatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPrompts: wizVideoPrompts,
          // imagePrompts removed — videos only
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWizardStep(3);
        loadBatches();
      } else {
        setWizError(data.error || 'Failed to start generation');
      }
    } catch (err: any) {
      setWizError(err.message);
    }
    setWizLoading(false);
  }

  async function handleDoubleDown(batchId: string) {
    const res = await fetch(`/api/batches/${batchId}/double-down`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      loadBatches();
    }
  }

  const totalSpend = adSets.reduce((s, a) => s + a.totalSpend, 0);
  const totalPurchases = adSets.reduce((s, a) => s + a.totalPurchases, 0);
  const winnerCount = adSets.reduce((s, a) => s + a.ads.filter(ad => ad.isWinner).length, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Creatives & Ad Review</h1>
            <p className="text-sm text-slate-400 mt-1">Review ad performance, find winners, generate new creatives</p>
          </div>
          <StoreSelector />
        </div>
        <button
          onClick={() => { setShowGenerate(true); setGenResult(null); setPrefillAdName(''); }}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Generate Creative
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-900 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('performance')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'performance' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Ad Performance
        </button>
        <button
          onClick={() => setTab('generated')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'generated' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Generated Creatives
        </button>
        <button
          onClick={() => setTab('batches')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'batches' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Batches
        </button>
      </div>

      {/* Generate Modal */}
      {/* Recreate from DNA Modal */}
      {recreateAd && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-green-900/50 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-sm font-semibold text-white mb-1">Recreate from DNA</h2>
            <p className="text-[10px] text-slate-400 mb-4">
              Recreating: <span className="text-green-400">{recreateAd.adName}</span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-slate-400 uppercase font-semibold mb-1 block">Product</label>
                <select
                  value={recreateProductId}
                  onChange={e => setRecreateProductId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="">Select a product...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.title} — ${(p.price_cents / 100).toFixed(2)}</option>
                  ))}
                </select>
                {/* Product image preview */}
                {recreateProductId && (() => {
                  const selProduct = products.find(p => p.id === recreateProductId);
                  if (!selProduct) return null;
                  const imgs: string[] = (() => {
                    try { return selProduct.images ? JSON.parse(selProduct.images) : []; } catch { return []; }
                  })();
                  if (selProduct.image_url && !imgs.includes(selProduct.image_url)) imgs.unshift(selProduct.image_url);
                  if (imgs.length === 0) return null;
                  return (
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                      {imgs.map((url, i) => (
                        <img key={i} src={url} alt="" className="w-14 h-14 rounded object-cover bg-slate-800 border border-slate-700 flex-shrink-0" />
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-semibold mb-1 block">Engine</label>
                <div className="flex gap-2">
                  {[
                    { key: 'veo', label: 'Veo (Gemini)', desc: '4-8s' },
                    { key: 'sora', label: 'Sora', desc: '8-20s' },
                    { key: 'minimax', label: 'MiniMax', desc: '5-10s' },
                  ].map(eng => (
                    <button
                      key={eng.key}
                      onClick={() => setRecreateEngine(eng.key)}
                      className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-medium border ${
                        recreateEngine === eng.key
                          ? 'bg-green-600 border-green-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {eng.label}<br />
                      <span className="text-[8px] opacity-60">{eng.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-semibold mb-1 block">Duration</label>
                <div className="flex gap-2">
                  {(recreateEngine === 'sora' ? ['8', '16', '20'] : recreateEngine === 'veo' ? ['4', '6', '8'] : ['5', '6', '8', '10']).map(d => (
                    <button
                      key={d}
                      onClick={() => setRecreateDuration(d)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${
                        recreateDuration === d
                          ? 'bg-green-600 border-green-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setRecreateAd(null)}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRecreate}
                  disabled={!recreateProductId || recreating}
                  className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
                >
                  {recreating ? 'Recreating...' : 'Recreate Video'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGenerate && (
        <div className="bg-slate-900 border border-purple-900/50 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">
              Generate Video
              {prefillAdName && <span className="text-purple-400 font-normal ml-2">Based on: {prefillAdName}</span>}
            </h2>
            <button onClick={() => setShowGenerate(false)} className="text-slate-400 hover:text-white text-sm">Close</button>
          </div>

          {/* Engine selector */}
          <div className="flex flex-wrap gap-1 bg-slate-800 p-0.5 rounded-lg w-fit mb-4">
            {([
              { key: 'sora', label: 'Sora (OpenAI)', sub: 'Video' },
              { key: 'veo', label: 'Veo (Google)', sub: 'Video' },
              { key: 'minimax', label: 'Hailuo (MiniMax)', sub: 'Video' },
              { key: 'minimax-image', label: 'MiniMax Image', sub: 'Image' },
              { key: 'nanobanana', label: 'NanoBanana', sub: 'Video' },
            ] as const).map(eng => (
              <button
                key={eng.key}
                onClick={() => setGenEngine(eng.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  genEngine === eng.key ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {eng.label}
                <span className={`ml-1 text-[9px] ${genEngine === eng.key ? 'text-purple-200' : 'text-slate-600'}`}>
                  {eng.sub}
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {(genEngine === 'nanobanana' || genEngine === 'minimax') && (
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1">Type</label>
                <select
                  value={genType}
                  onChange={(e) => setGenType(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="text-to-video">Text to Video</option>
                  <option value="image-to-video">Image to Video</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">
                {genEngine === 'minimax-image' ? 'Aspect Ratio' : genEngine === 'sora' ? 'Size' : genEngine === 'veo' ? 'Resolution / Aspect' : 'Resolution'}
              </label>
              <select
                value={genResolution}
                onChange={(e) => setGenResolution(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
              >
                {genEngine === 'sora' ? (
                  <>
                    <option value="720p">1280x720 Landscape</option>
                    <option value="720p-vertical">720x1280 Portrait</option>
                    <option value="1080p">1920x1080 HD (Pro)</option>
                    <option value="1080p-vertical">1080x1920 HD Portrait (Pro)</option>
                  </>
                ) : genEngine === 'veo' ? (
                  <>
                    <option value="720p">720p Landscape (Fast)</option>
                    <option value="720p-vertical">720p Portrait (Fast)</option>
                    <option value="1080p">1080p Landscape</option>
                    <option value="1080p-vertical">1080p Portrait</option>
                    <option value="4k">4K Landscape</option>
                  </>
                ) : genEngine === 'minimax' ? (
                  <>
                    <option value="1080P">1080P</option>
                    <option value="720P">720P</option>
                  </>
                ) : genEngine === 'minimax-image' ? (
                  <>
                    <option value="16:9">16:9 Landscape</option>
                    <option value="9:16">9:16 Portrait</option>
                    <option value="1:1">1:1 Square</option>
                    <option value="4:3">4:3 Standard</option>
                    <option value="3:4">3:4 Tall</option>
                  </>
                ) : (
                  <>
                    <option value="480p">480p (5 credits)</option>
                    <option value="720p">720p (5 credits)</option>
                    <option value="1080p">1080p (7 credits)</option>
                  </>
                )}
              </select>
            </div>
            {genEngine !== 'minimax-image' && (
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1">Duration</label>
                {genEngine === 'sora' ? (
                  <select
                    value={genDuration}
                    onChange={(e) => setGenDuration(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="8">8 seconds</option>
                    <option value="16">16 seconds</option>
                    <option value="20">20 seconds</option>
                  </select>
                ) : genEngine === 'veo' ? (
                  <select
                    value={genDuration}
                    onChange={(e) => setGenDuration(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="4">4 seconds</option>
                    <option value="6">6 seconds</option>
                    <option value="8">8 seconds</option>
                  </select>
                ) : genEngine === 'minimax' ? (
                  <select
                    value={genDuration}
                    onChange={(e) => setGenDuration(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="6">6 seconds</option>
                    <option value="5">5 seconds</option>
                  </select>
                ) : (
                  <input
                    type="number"
                    min="3" max="12"
                    value={genDuration}
                    onChange={(e) => setGenDuration(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                  />
                )}
              </div>
            )}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Angle / Hook</label>
              <input
                type="text"
                placeholder="e.g. UGC testimonial"
                value={genAngle}
                onChange={(e) => setGenAngle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[10px] text-slate-500 uppercase mb-1">Title</label>
            <input
              type="text"
              value={genTitle}
              onChange={(e) => setGenTitle(e.target.value)}
              placeholder="Creative title"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
            />
          </div>
          <div className="mb-4">
            <label className="block text-[10px] text-slate-500 uppercase mb-1">Prompt</label>
            <textarea
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              rows={3}
              placeholder="Describe the video you want to generate..."
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500 resize-none"
            />
          </div>
          {genType === 'image-to-video' && (genEngine === 'nanobanana' || genEngine === 'minimax' || genEngine === 'sora') && (
            <div className="mb-4">
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Image URLs (one per line)</label>
              <textarea
                value={genImageUrls}
                onChange={(e) => setGenImageUrls(e.target.value)}
                rows={2}
                placeholder="https://example.com/image1.jpg"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500 resize-none"
              />
              {genEngine === 'sora' && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Sora uses the first image as the locked product reference frame. Use a clean front-facing product image for the most exact match.
                </p>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={!storeFilter || !genPrompt || !genTitle || generating}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              {generating ? 'Generating...' : `Generate with ${
                genEngine === 'sora' ? 'Sora' : genEngine === 'veo' ? 'Veo'
                : genEngine === 'minimax' ? 'Hailuo' : genEngine === 'minimax-image' ? 'MiniMax Image'
                : 'NanoBanana'
              }`}
            </button>
            {!storeFilter && <span className="text-xs text-yellow-400">Select a store first</span>}
            {genResult && (
              <span className={`text-xs ${genResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {genResult.success
                  ? genResult.engine === 'sora'
                    ? `Sora video queued! Model: ${genResult.model}, ${genResult.seconds}s`
                    : genResult.engine === 'veo'
                    ? `Veo video queued! Model: ${genResult.model}`
                    : genResult.engine === 'minimax'
                    ? `Hailuo video queued! Model: ${genResult.model}`
                    : genResult.engine === 'minimax-image'
                    ? `Image generated!`
                    : `Video queued! Credits used: ${genResult.creditsUsed}`
                  : genResult.error}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Performance Tab */}
      {tab === 'performance' && (
        <>
          {/* Controls */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex gap-1 bg-slate-900 p-0.5 rounded-lg">
              {[{ label: '7D', value: '7' }, { label: '14D', value: '14' }, { label: '30D', value: '30' }, { label: '60D', value: '60' }].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDateRange(opt.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium ${dateRange === opt.value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none"
            >
              <option value="spend">Sort by Spend</option>
              <option value="roas">Sort by ROAS</option>
              <option value="purchases">Sort by Purchases</option>
            </select>
          </div>

          {/* Summary KPIs */}
          {adSets.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase mb-1">Total Spend</p>
                <p className="text-xl font-bold text-white">{cents(totalSpend)}</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase mb-1">Purchases</p>
                <p className="text-xl font-bold text-emerald-400">{totalPurchases}</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase mb-1">Ad Sets</p>
                <p className="text-xl font-bold text-white">{adSets.length}</p>
              </div>
              <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-4">
                <p className="text-xs text-emerald-500 uppercase mb-1">Winners</p>
                <p className="text-xl font-bold text-emerald-400">{winnerCount}</p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
          ) : !storeFilter ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">Select a store to view ad performance</p>
            </div>
          ) : adSets.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">No ad data for this period</p>
              <p className="text-xs text-slate-500 mt-1">Sync Facebook ads first from the Connect page</p>
            </div>
          ) : (
            <div className="space-y-3">
              {adSets.map(set => (
                <div key={set.adSetId} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  {/* Ad Set Header */}
                  <button
                    onClick={() => toggleExpand(set.adSetId)}
                    className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-white truncate">{set.adSetName}</h3>
                        {set.ads.some(a => a.isWinner) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 flex-shrink-0">
                            {set.ads.filter(a => a.isWinner).length} winner{set.ads.filter(a => a.isWinner).length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500 truncate">{set.campaignName}</p>
                    </div>
                    <div className="flex items-center gap-6 flex-shrink-0 ml-4">
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500">Spend</p>
                        <p className="text-sm font-semibold text-white">{cents(set.totalSpend)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500">ROAS</p>
                        <p className={`text-sm font-semibold ${set.roas >= 2 ? 'text-emerald-400' : set.roas >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {set.roas.toFixed(2)}x
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500">CPA</p>
                        <p className="text-sm font-semibold text-white">{set.cpa > 0 ? cents(set.cpa) : '-'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500">Purchases</p>
                        <p className="text-sm font-semibold text-white">{set.totalPurchases}</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-slate-500">Ads</p>
                        <p className="text-sm font-semibold text-slate-400">{set.ads.length}</p>
                      </div>
                      <svg className={`w-5 h-5 text-slate-500 transition-transform ${expanded[set.adSetId] ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded Ads */}
                  {expanded[set.adSetId] && (
                    <div className="border-t border-slate-800 px-5 py-3 space-y-2">
                      {set.ads.map(ad => (
                        <div key={ad.adId}>
                          {/* Ad row — clickable to expand full context */}
                          <div
                            onClick={() => setSelectedAd(selectedAd?.adId === ad.adId ? null : ad)}
                            className={`flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-colors ${
                              ad.isWinner ? 'bg-emerald-950/20 border border-emerald-900/30' : 'bg-slate-800/30 hover:bg-slate-800/50'
                            }`}
                          >
                            {/* Creative thumbnail */}
                            <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-slate-800">
                              {ad.creativeUrl ? (
                                <img src={ad.creativeUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                              )}
                            </div>

                            {/* Ad info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-white truncate">{ad.adName}</p>
                                {ad.isWinner && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 flex-shrink-0">Winner</span>
                                )}
                                {ad.status && (
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${
                                    ad.status === 'ACTIVE' ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-700 text-slate-400'
                                  }`}>{ad.status}</span>
                                )}
                              </div>
                              {ad.headline && <p className="text-xs text-slate-300 mt-0.5 truncate">{ad.headline}</p>}
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {ad.impressions.toLocaleString()} impr / {ad.clicks.toLocaleString()} clicks / {ad.reach.toLocaleString()} reach
                              </p>
                            </div>

                            {/* Metrics */}
                            <div className="flex items-center gap-4 flex-shrink-0">
                              <div className="text-right">
                                <p className="text-[10px] text-slate-500">Spend</p>
                                <p className="text-xs font-semibold text-white">{cents(ad.spend)}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] text-slate-500">ROAS</p>
                                <p className={`text-xs font-semibold ${ad.roas >= 2 ? 'text-emerald-400' : ad.roas >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                                  {ad.roas.toFixed(2)}x
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] text-slate-500">CPA</p>
                                <p className="text-xs font-semibold text-white">{ad.cpa > 0 ? cents(ad.cpa) : '-'}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] text-slate-500">CTR</p>
                                <p className="text-xs font-semibold text-blue-400">{ad.ctr.toFixed(2)}%</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] text-slate-500">Purch</p>
                                <p className="text-xs font-semibold text-emerald-400">{ad.purchases}</p>
                              </div>
                              <svg className={`w-4 h-4 text-slate-500 transition-transform ${selectedAd?.adId === ad.adId ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>

                          {/* Full Ad Context — expanded detail panel */}
                          {selectedAd?.adId === ad.adId && (
                            <div className="ml-20 mt-1 mb-3 p-4 bg-slate-800/60 rounded-lg border border-slate-700/50">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Left: Creative Context */}
                                <div>
                                  <h4 className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Ad Creative</h4>
                                  {ad.creativeUrl && (
                                    <img src={ad.creativeUrl} alt="" className="w-full max-w-xs rounded-lg mb-3" />
                                  )}
                                  {ad.headline && (
                                    <div className="mb-2">
                                      <p className="text-[10px] text-slate-500 uppercase">Headline</p>
                                      <p className="text-sm text-white font-medium">{ad.headline}</p>
                                    </div>
                                  )}
                                  {ad.body && (
                                    <div className="mb-2">
                                      <p className="text-[10px] text-slate-500 uppercase">Primary Text</p>
                                      <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{ad.body}</p>
                                    </div>
                                  )}
                                  {ad.cta && (
                                    <div className="mb-2">
                                      <p className="text-[10px] text-slate-500 uppercase">CTA Button</p>
                                      <span className="inline-block px-3 py-1 bg-blue-600 text-white text-xs rounded mt-1">{formatCta(ad.cta)}</span>
                                    </div>
                                  )}
                                  {ad.linkUrl && (
                                    <div className="mb-2">
                                      <p className="text-[10px] text-slate-500 uppercase">Destination URL</p>
                                      <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 break-all">{ad.linkUrl}</a>
                                    </div>
                                  )}
                                  {!ad.headline && !ad.body && !ad.cta && (
                                    <p className="text-xs text-slate-500 italic">No creative context synced yet. Run a Facebook sync to pull full ad details.</p>
                                  )}
                                </div>

                                {/* Right: Extended Metrics */}
                                <div>
                                  <h4 className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Performance Metrics</h4>
                                  <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-slate-900/50 rounded-lg p-3">
                                      <p className="text-[10px] text-slate-500">Spend</p>
                                      <p className="text-sm font-bold text-white">{cents(ad.spend)}</p>
                                    </div>
                                    <div className="bg-slate-900/50 rounded-lg p-3">
                                      <p className="text-[10px] text-slate-500">Revenue</p>
                                      <p className="text-sm font-bold text-emerald-400">{cents(ad.purchaseValue)}</p>
                                    </div>
                                    <div className="bg-slate-900/50 rounded-lg p-3">
                                      <p className="text-[10px] text-slate-500">ROAS</p>
                                      <p className={`text-sm font-bold ${ad.roas >= 2 ? 'text-emerald-400' : ad.roas >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>{ad.roas.toFixed(2)}x</p>
                                    </div>
                                    <div className="bg-slate-900/50 rounded-lg p-3">
                                      <p className="text-[10px] text-slate-500">Purchases</p>
                                      <p className="text-sm font-bold text-white">{ad.purchases}</p>
                                    </div>
                                    <div className="bg-slate-900/50 rounded-lg p-3">
                                      <p className="text-[10px] text-slate-500">CPA</p>
                                      <p className="text-sm font-bold text-white">{ad.cpa > 0 ? cents(ad.cpa) : '-'}</p>
                                    </div>
                                    <div className="bg-slate-900/50 rounded-lg p-3">
                                      <p className="text-[10px] text-slate-500">CTR</p>
                                      <p className="text-sm font-bold text-blue-400">{ad.ctr.toFixed(2)}%</p>
                                    </div>
                                    <div className="bg-slate-900/50 rounded-lg p-3">
                                      <p className="text-[10px] text-slate-500">CPM</p>
                                      <p className="text-sm font-bold text-white">{cents(ad.cpm)}</p>
                                    </div>
                                    <div className="bg-slate-900/50 rounded-lg p-3">
                                      <p className="text-[10px] text-slate-500">CPC</p>
                                      <p className="text-sm font-bold text-white">{cents(ad.cpc)}</p>
                                    </div>
                                    <div className="bg-slate-900/50 rounded-lg p-3">
                                      <p className="text-[10px] text-slate-500">Reach</p>
                                      <p className="text-sm font-bold text-white">{ad.reach.toLocaleString()}</p>
                                    </div>
                                  </div>

                                  {/* Action buttons */}
                                  <div className="flex gap-2 mt-4">
                                    {ad.previewUrl && (
                                      <a
                                        href={ad.previewUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium rounded-lg"
                                      >
                                        View Ad Preview
                                      </a>
                                    )}
                                    {ad.fbVideoId ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); analyzeAdVideo(ad); }}
                                        disabled={analyzingAdId === ad.adId}
                                        className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg"
                                      >
                                        {analyzingAdId === ad.adId ? 'Analyzing...' : adAnalysis[ad.adId] ? 'Re-Analyze DNA' : 'Analyze Video DNA'}
                                      </button>
                                    ) : (
                                      <label className={`px-3 py-1.5 ${analyzingAdId === ad.adId ? 'bg-orange-400 cursor-wait' : 'bg-orange-600 hover:bg-orange-700 cursor-pointer'} text-white text-[10px] font-medium rounded-lg`}>
                                        {analyzingAdId === ad.adId ? 'Analyzing...' : adAnalysis[ad.adId] ? 'Re-Analyze DNA' : 'Upload Video to Analyze'}
                                        <input
                                          type="file"
                                          accept="video/*"
                                          className="hidden"
                                          disabled={analyzingAdId === ad.adId}
                                          onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) analyzeAdVideo(ad, f);
                                            e.target.value = '';
                                          }}
                                        />
                                      </label>
                                    )}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openGenerateFromWinner(ad); }}
                                      className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-medium rounded-lg"
                                    >
                                      Generate Similar
                                    </button>
                                    {adAnalysis[ad.adId] && !adAnalysis[ad.adId].startsWith('Error') && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setRecreateAd(ad); setRecreateProductId(''); }}
                                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-[10px] font-medium rounded-lg"
                                      >
                                        Recreate with Product
                                      </button>
                                    )}
                                  </div>

                                  {/* Video Analysis Display */}
                                  {adAnalysis[ad.adId] && (
                                    <div className="mt-4 p-4 bg-slate-900/80 rounded-lg border border-orange-900/30">
                                      <h4 className="text-[10px] text-orange-400 uppercase font-semibold mb-2">Video Creative DNA (Twelve Labs)</h4>
                                      <div className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                                        {adAnalysis[ad.adId]}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Generated Creatives Tab */}
      {tab === 'generated' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
          ) : creatives.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">No creatives yet</p>
              <p className="text-xs text-slate-500 mt-1">Generate videos using Sora or NanoBanana</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {creatives.map((c) => (
                <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  {/* Thumbnail */}
                  {c.nb_status === 'completed' && c.file_url && c.type === 'video' ? (
                    <video src={mediaUrl(c.file_url)} poster={mediaUrl(c.thumbnail_url)} controls preload="metadata" className="w-full aspect-[9/16] object-contain bg-black" />
                  ) : c.thumbnail_url || (c.nb_status === 'completed' && c.file_url) ? (
                    <img src={mediaUrl(c.thumbnail_url || c.file_url)} alt="" className="w-full aspect-[9/16] object-contain bg-black" />
                  ) : (
                    <div className="w-full aspect-[9/16] bg-slate-800 flex items-center justify-center">
                      {c.nb_status === 'processing' ? (
                        <div className="text-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-2" />
                          <p className="text-xs text-purple-400">Generating...</p>
                        </div>
                      ) : (
                        <svg className="w-12 h-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                    </div>
                  )}

                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-white text-sm truncate">{c.title}</h3>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {c.angle && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">{c.angle}</span>
                        )}
                        {c.nb_status && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            c.nb_status === 'completed' ? 'bg-emerald-900/30 text-emerald-400' :
                            c.nb_status === 'processing' ? 'bg-yellow-900/30 text-yellow-400' :
                            c.nb_status === 'failed' ? 'bg-red-900/30 text-red-400' :
                            'bg-slate-800 text-slate-400'
                          }`}>
                            {c.nb_status}
                          </span>
                        )}
                      </div>
                    </div>
                    {c.description && (
                      <p className="text-xs text-slate-500 mb-2 line-clamp-2">{c.description}</p>
                    )}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800">
                      <span className="text-[10px] text-slate-500 uppercase">{c.type}</span>
                      <div className="flex gap-2">
                        {c.nb_status === 'processing' && (
                          <button
                            onClick={() => pollStatus(c.id)}
                            className="text-[10px] text-blue-400 hover:text-blue-300"
                          >
                            Check Status
                          </button>
                        )}
                        {c.file_url && c.nb_status === 'completed' && (
                          <a
                            href={mediaUrl(c.file_url)}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-emerald-400 hover:text-emerald-300"
                          >
                            Download
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Batches Tab */}
      {tab === 'batches' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div />
            <button
              onClick={startWizard}
              disabled={!storeFilter}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              + New Batch
            </button>
          </div>

          {/* Wizard Modal */}
          {showWizard && (
            <div className="bg-slate-900 border border-purple-900/50 rounded-xl p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white">
                  New Batch — Step {wizardStep} of 3
                </h2>
                <button onClick={() => setShowWizard(false)} className="text-slate-400 hover:text-white text-sm">Close</button>
              </div>

              {/* Step indicators */}
              <div className="flex items-center gap-2 mb-5">
                {['Review', 'Prompts', 'Generate'].map((label, i) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      wizardStep > i + 1 ? 'bg-emerald-600 text-white' :
                      wizardStep === i + 1 ? 'bg-purple-600 text-white' :
                      'bg-slate-800 text-slate-500'
                    }`}>{i + 1}</div>
                    <span className={`text-xs ${wizardStep === i + 1 ? 'text-white' : 'text-slate-500'}`}>{label}</span>
                    {i < 2 && <div className="w-8 h-px bg-slate-700" />}
                  </div>
                ))}
              </div>

              {wizError && (
                <div className="mb-4 px-3 py-2 bg-red-900/20 border border-red-800 rounded-lg text-xs text-red-400">{wizError}</div>
              )}

              {/* Step 1: Review */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase mb-1">Batch Name *</label>
                      <input
                        type="text"
                        value={wizName}
                        onChange={(e) => setWizName(e.target.value)}
                        placeholder="e.g. Product X - UGC Test"
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase mb-1">Product</label>
                      <select
                        value={wizProductId}
                        onChange={(e) => setWizProductId(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                      >
                        <option value="">Select product...</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.title} — {cents(p.price_cents)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase mb-1">Offer / Bundle</label>
                    <input
                      type="text"
                      value={wizOffer}
                      onChange={(e) => setWizOffer(e.target.value)}
                      placeholder="e.g. Buy 2 Get 1 Free, 50% Off Today"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                    <p className="text-[10px] text-slate-500 uppercase mb-1">Winning Angles</p>
                    <p className="text-xs text-slate-400">Auto-extracted from your top performing ads — AI will analyze what concepts are converting and double down on them.</p>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={wizCreateBatch}
                      disabled={!wizName || wizLoading}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                    >
                      {wizLoading ? 'Generating Prompts...' : 'Next: Generate Prompts →'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Review/Edit Prompts */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Video Prompts (Sora) — 5 videos</h3>
                    {wizVideoPrompts.map((p, i) => (
                      <div key={i} className="mb-3 p-3 bg-slate-800/50 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400">V{i + 1}</span>
                          <input
                            type="text"
                            value={p.angle}
                            onChange={(e) => {
                              const updated = [...wizVideoPrompts];
                              updated[i] = { ...updated[i], angle: e.target.value };
                              setWizVideoPrompts(updated);
                            }}
                            className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[10px] text-purple-400 w-32"
                          />
                          <input
                            type="text"
                            value={p.headline}
                            onChange={(e) => {
                              const updated = [...wizVideoPrompts];
                              updated[i] = { ...updated[i], headline: e.target.value };
                              setWizVideoPrompts(updated);
                            }}
                            placeholder="Headline"
                            className="flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white"
                          />
                        </div>
                        <textarea
                          value={p.prompt}
                          onChange={(e) => {
                            const updated = [...wizVideoPrompts];
                            updated[i] = { ...updated[i], prompt: e.target.value };
                            setWizVideoPrompts(updated);
                          }}
                          rows={2}
                          className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-slate-300 resize-none mb-1"
                        />
                        <textarea
                          value={p.adCopy}
                          onChange={(e) => {
                            const updated = [...wizVideoPrompts];
                            updated[i] = { ...updated[i], adCopy: e.target.value };
                            setWizVideoPrompts(updated);
                          }}
                          rows={1}
                          placeholder="Ad copy..."
                          className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[10px] text-slate-400 resize-none"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      onClick={wizRegeneratePrompts}
                      disabled={wizLoading}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs rounded-lg"
                    >
                      {wizLoading ? 'Regenerating...' : 'Regenerate Prompts'}
                    </button>
                    <button
                      onClick={wizStartGeneration}
                      disabled={wizLoading}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                    >
                      {wizLoading ? 'Starting...' : 'Start Generation →'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Generating */}
              {wizardStep === 3 && (
                <div className="text-center py-6">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-400 mx-auto mb-4" />
                  <p className="text-white font-medium mb-1">Generation Started</p>
                  <p className="text-xs text-slate-400 mb-4">5 videos (Sora) are being generated with enriched prompts.</p>
                  <p className="text-xs text-slate-500">You can close this modal. Check progress in the batch list below.</p>
                  <button
                    onClick={() => { setShowWizard(false); loadBatches(); }}
                    className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Batch List */}
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
          ) : !storeFilter ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">Select a store to view batches</p>
            </div>
          ) : batches.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">No batches yet</p>
              <p className="text-xs text-slate-500 mt-1">Create a batch to auto-generate 5 videos + 5 images</p>
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map(b => {
                const angles = b.winning_angles ? JSON.parse(b.winning_angles) : [];
                const isExpanded = expandedBatch === b.id;
                const bc = batchCreatives[b.id] || [];

                return (
                  <div key={b.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                    <button
                      onClick={() => {
                        if (isExpanded) { setExpandedBatch(null); }
                        else { setExpandedBatch(b.id); loadBatchDetail(b.id); }
                      }}
                      className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">#{b.batch_number}</span>
                          <h3 className="text-sm font-semibold text-white truncate">{b.name}</h3>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            b.status === 'active' ? 'bg-emerald-900/30 text-emerald-400' :
                            b.status === 'generating' || b.status === 'generating_prompts' ? 'bg-yellow-900/30 text-yellow-400' :
                            b.status === 'prompts_ready' ? 'bg-blue-900/30 text-blue-400' :
                            b.status === 'failed' ? 'bg-red-900/30 text-red-400' :
                            'bg-slate-800 text-slate-400'
                          }`}>{b.status}</span>
                          {b.parent_batch_id && (
                            <span className="text-[10px] text-slate-500">doubled down</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                          {b.product_title && <span>{b.product_title}</span>}
                          {angles.length > 0 && <span>Angles: {angles.join(', ')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-5 flex-shrink-0 ml-4">
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500">Videos</p>
                          <p className="text-sm font-semibold text-white">{b.completed_videos}/{b.total_videos}</p>
                        </div>
                        {/* Images removed — videos only */}
                        {b.avg_roas > 0 && (
                          <div className="text-right">
                            <p className="text-[10px] text-slate-500">ROAS</p>
                            <p className={`text-sm font-semibold ${b.avg_roas >= 2 ? 'text-emerald-400' : b.avg_roas >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {b.avg_roas.toFixed(2)}x
                            </p>
                          </div>
                        )}
                        <svg className={`w-5 h-5 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {/* Expanded batch detail */}
                    {isExpanded && (
                      <div className="border-t border-slate-800 px-5 py-4">
                        {/* Pipeline progress */}
                        <div className="flex items-center gap-1 mb-4 text-[10px]">
                          {['Review', 'Prompts', 'Videos', 'Track', 'Double Down'].map((step, i) => {
                            const stepStatuses = ['pending', 'generating_prompts', 'generating', 'generating', 'active', 'completed'];
                            const statusIdx = stepStatuses.indexOf(b.status);
                            const isDone = i < statusIdx || (i === statusIdx && b.status !== 'failed');
                            return (
                              <div key={step} className="flex items-center gap-1">
                                <span className={`px-2 py-1 rounded ${isDone ? 'bg-emerald-900/30 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>{step}</span>
                                {i < 5 && <span className="text-slate-700">→</span>}
                              </div>
                            );
                          })}
                        </div>

                        {/* Videos */}
                        {bc.filter(c => c.type === 'video').length > 0 && (
                          <div className="mb-4">
                            <h4 className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Videos (Sora)</h4>
                            <div className="grid grid-cols-5 gap-3">
                              {bc.filter(c => c.type === 'video').map(c => (
                                <div key={c.id} className="bg-slate-800/50 rounded-lg overflow-hidden">
                                  <div className="aspect-[9/16] bg-black flex items-center justify-center relative">
                                    {c.nb_status === 'completed' && c.file_url ? (
                                      <video
                                        src={mediaUrl(c.file_url)}
                                        poster={mediaUrl(c.thumbnail_url)}
                                        controls
                                        preload="metadata"
                                        className="w-full h-full object-contain"
                                      />
                                    ) : c.nb_status === 'processing' ? (
                                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-400" />
                                    ) : c.nb_status === 'failed' ? (
                                      <span className="text-[10px] text-red-400">Failed</span>
                                    ) : (
                                      <span className="text-[10px] text-slate-600">Pending</span>
                                    )}
                                  </div>
                                  <div className="p-2">
                                    <p className="text-[10px] text-white truncate">{c.title}</p>
                                    {c.angle && <span className="text-[9px] text-purple-400">{c.angle}</span>}
                                    <div className="flex items-center justify-between mt-1">
                                      <span className={`text-[9px] ${
                                        c.nb_status === 'completed' ? 'text-emerald-400' :
                                        c.nb_status === 'processing' ? 'text-yellow-400' :
                                        'text-red-400'
                                      }`}>{c.nb_status}</span>
                                      {c.file_url && c.nb_status === 'completed' && (
                                        <a href={mediaUrl(c.file_url)} download className="text-[9px] text-blue-400 hover:text-blue-300">Download</a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          {(b.status === 'generating' || b.status === 'active') && (
                            <button
                              onClick={() => loadBatchDetail(b.id)}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium rounded-lg"
                            >
                              Refresh Status
                            </button>
                          )}
                          {b.status === 'active' && (
                            <button
                              onClick={() => handleDoubleDown(b.id)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium rounded-lg"
                            >
                              Double Down on Winners
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CreativesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}>
      <CreativesContent />
    </Suspense>
  );
}
