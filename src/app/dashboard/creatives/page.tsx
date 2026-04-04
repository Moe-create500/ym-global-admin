'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';
import { cents } from '@/lib/format';
import { buildProductImagePlan } from '@/lib/creative-taxonomy';

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
  template_id: string | null;
  created_at: string;
  batch_id?: string | null;
  batch_index?: number | null;
  progress?: number | null;
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

// ═══ Creative Generator Types ═══

interface GeneratorConfig {
  contentType: 'video' | 'image';
  creativeType: string;
  funnelStage: 'tof' | 'mof' | 'bof';
  hookStyle: string;
  avatarStyle: string;
  generationGoal: string;
  platformTarget: 'meta' | 'tiktok';
  quantity: number;
  productId: string;
  offer: string;
  baseAdId: string;
}

interface VideoPackage {
  title: string;
  angle: string;
  hook: string;
  script: string;
  sceneStructure: string;
  visualDirection: string;
  brollDirection: string;
  avatarSuggestion: string;
  cta: string;
  adCopy: string;
  headline: string;
  variants: string[];
}

interface ImagePackage {
  title: string;
  angle: string;
  headline: string;
  conceptAngle: string;
  visualComposition: string;
  offerPlacement: string;
  ctaDirection: string;
  adCopy: string;
  variants: string[];
}

type CreativePackage = VideoPackage | ImagePackage;

interface AccountIntelligence {
  metrics: { totalAds: number; adsWithPurchases: number; totalSpendCents: number; totalPurchases: number; avgRoas: number; avgCtr: number; avgCpa: number; avgCvr: number };
  winners: {
    topHooksByCTR: { adId: string; name: string; hook: string; ctr: number; roas: number; impressions: number }[];
    topCreativesByROAS: { adId: string; name: string; headline: string; roas: number; spend: number; purchases: number; thumbnail: string | null; hasVideo: boolean }[];
    topConvertersByCVR: { adId: string; name: string; headline: string; cvr: number; purchases: number; clicks: number; roas: number }[];
    mostEfficientByCPA: { adId: string; name: string; headline: string; cpa: number; purchases: number; spend: number; roas: number }[];
    scalingWinnersBySpend: { adId: string; name: string; headline: string; spend: number; roas: number; purchases: number }[];
  };
  trends: {
    rising: { adId: string; name: string; recentRoas: number; prevRoas: number; change: number }[];
    declining: { adId: string; name: string; recentRoas: number; prevRoas: number; change: number }[];
    fatigueSignals: { adId: string; name: string; recentRoas: number; prevRoas: number }[];
    scalingSignals: { adId: string; name: string; spendIncrease: number; recentRoas: number }[];
  };
  productPerformance: { productId: string; name: string; imageUrl: string | null; roas: number; purchases: number; spendCents: number }[];
  recommendations: { contentType: string; funnelStage: string; hookStyle: string; confidence: number; reasons: string[] };
  learnedPatterns: {
    whatWorks: { pattern: string; title: string; roas: number; ctr: number; cpa: number; purchases: number }[];
    whatDoesnt: { pattern: string; title: string; roas: number; spendCents: number }[];
    patternScores: { creativeType: string; funnelStage: string; hookStyle: string; winRate: number; wins: number; losses: number; total: number; avgRoas: number; confidence: number }[];
    totalTracked: number;
    totalWithPerformance: number;
  };
}

const CREATIVE_TYPES = [
  { key: 'testimonial', label: 'Testimonial', icon: '💬' },
  { key: 'b_roll', label: 'B-Roll', icon: '🎬' },
  { key: 'product_demo', label: 'Product Demo', icon: '📦' },
  { key: 'before_after', label: 'Before / After', icon: '✨' },
  { key: 'problem_solution', label: 'Problem → Solution', icon: '💡' },
  { key: 'founder_story', label: 'Founder Story', icon: '🏗️' },
  { key: 'social_proof', label: 'Social Proof', icon: '⭐' },
  { key: 'lifestyle', label: 'Lifestyle', icon: '🌿' },
  { key: 'hook_viral', label: 'Hook Viral', icon: '🔥' },
  { key: 'educational', label: 'Educational', icon: '🎓' },
  { key: 'podcast_style', label: 'Podcast Style', icon: '🎙️' },
  { key: 'routine', label: 'Routine', icon: '🔄' },
  { key: 'comparison', label: 'Comparison', icon: '⚖️' },
  { key: 'myth_busting', label: 'Myth Busting', icon: '🚫' },
  { key: 'pov_relatable', label: 'POV / Relatable', icon: '👀' },
] as const;

const HOOK_STYLES = [
  { key: 'pattern_interrupt', label: 'Pattern Interrupt' },
  { key: 'curiosity', label: 'Curiosity' },
  { key: 'emotional', label: 'Emotional' },
  { key: 'authority', label: 'Authority' },
  { key: 'relatable', label: 'Relatable' },
] as const;

const AVATAR_STYLES = [
  { key: 'female_ugc', label: 'Female UGC' },
  { key: 'male_ugc', label: 'Male UGC' },
  { key: 'creator_influencer', label: 'Creator / Influencer' },
  { key: 'expert_authority', label: 'Expert / Authority' },
  { key: 'podcast_host', label: 'Podcast Host' },
  { key: 'faceless_product_only', label: 'Faceless / Product Only' },
] as const;

const GENERATION_GOALS = [
  { key: 'new_concept', label: 'New Concept' },
  { key: 'generate_variations', label: 'Generate Variations' },
  { key: 'use_winner_as_base', label: 'Use Winner as Base' },
  { key: 'refresh_fatigued_ad', label: 'Refresh Fatigued Ad' },
  { key: 'winner_to_new_format', label: 'Winner → New Format' },
] as const;

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
  const [tab, setTab] = useState<'performance' | 'generated' | 'batches' | 'generator'>('performance');
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

  // Selected ad for detail view
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);

  // Double down loading state
  const [doublingDown, setDoublingDown] = useState<string | null>(null);

  // Fetch error state
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Track expired/broken video URLs
  const [expiredVideos, setExpiredVideos] = useState<Set<string>>(new Set());

  // ═══ Creative Generator State ═══
  const [genConfig, setGenConfig] = useState<GeneratorConfig>({
    contentType: 'video', creativeType: 'testimonial', funnelStage: 'tof',
    hookStyle: 'curiosity', avatarStyle: 'female_ugc', generationGoal: 'new_concept',
    platformTarget: 'meta', quantity: 3, productId: '', offer: '', baseAdId: '',
  });
  const [genPackages, setGenPackages] = useState<CreativePackage[]>([]);
  const [genPackageConfig, setGenPackageConfig] = useState<any>(null);
  const [generatingPackage, setGeneratingPackage] = useState(false);
  const [genPackageError, setGenPackageError] = useState('');
  const [accountIntel, setAccountIntel] = useState<AccountIntelligence | null>(null);
  const [expandedPackage, setExpandedPackage] = useState<number | null>(null);
  const [genStrategy, setGenStrategy] = useState<any>(null);
  const [genHistory, setGenHistory] = useState<any[]>([]);
  const [genHistoryLoading, setGenHistoryLoading] = useState(false);
  const [viewingHistory, setViewingHistory] = useState<string | null>(null);
  const [genCurrentId, setGenCurrentId] = useState<string | null>(null);
  const [genVersion, setGenVersion] = useState(1);
  const [comparingPackages, setComparingPackages] = useState<number[]>([]);
  const [generatingVideoIdx, setGeneratingVideoIdx] = useState<number | null>(null);
  const [packageVideoStatus, setPackageVideoStatus] = useState<Record<number, { id: string; status: string; engine: string; reason?: string }>>({});

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (storeFilter) {
      fetch(`/api/products?storeId=${storeFilter}`).then(r => r.json()).then(d => setProducts(d.products || [])).catch(() => {});
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
    setFetchError(null);
    try {
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
    } catch {
      setAdSets([]);
      setFetchError('Failed to load ad performance data. Check your connection and try again.');
    }
    setLoading(false);
  }

  async function loadCreatives() {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (storeFilter) params.set('storeId', storeFilter);
      const res = await fetch(`/api/creatives?${params}`);
      const data = await res.json();
      setCreatives(data.creatives || []);
    } catch {
      setCreatives([]);
      setFetchError('Failed to load creatives. Check your connection and try again.');
    }
    setLoading(false);
  }

  function toggleExpand(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function analyzeAdVideo(ad: Ad, file?: File) {
    if (!storeFilter) return;
    setAnalyzingAdId(ad.adId);
    setAdAnalysis(prev => ({ ...prev, [ad.adId]: '' })); // Clear previous error/result
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 330000); // 5.5 min client timeout (above server's 5 min)
      let res: Response;
      if (file) {
        // Direct file upload
        const formData = new FormData();
        formData.append('videoFile', file);
        formData.append('adId', ad.adId);
        formData.append('storeId', storeFilter);
        res = await fetch('/api/creatives/analyze', { method: 'POST', body: formData, signal: controller.signal });
      } else {
        // Auto-resolve from Facebook video_source_url or fb_video_id
        res = await fetch('/api/creatives/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adId: ad.adId, storeId: storeFilter }),
          signal: controller.signal,
        });
      }
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.analysis) {
        setAdAnalysis(prev => ({ ...prev, [ad.adId]: data.analysis }));
      } else {
        setAdAnalysis(prev => ({ ...prev, [ad.adId]: `Error: ${data.error || 'Analysis failed'}` }));
      }
    } catch (err: any) {
      const msg = err.name === 'AbortError'
        ? 'Analysis timed out. The video may be too large or Twelve Labs is slow. Try uploading a shorter clip.'
        : `Error: ${err.message || 'Network error — check your connection and try again.'}`;
      setAdAnalysis(prev => ({ ...prev, [ad.adId]: msg }));
    }
    setAnalyzingAdId(null);
  }

  async function handleRecreate() {
    if (!storeFilter || !recreateAd || !recreateProductId) return;
    if (!window.confirm(`Recreate this ad with ${recreateEngine === 'sora' ? 'Sora' : recreateEngine === 'veo' ? 'Veo' : 'MiniMax'}? This will call the AI API and may incur costs.`)) return;
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
    const adName = ad.adName || 'Untitled Ad';
    setPrefillAdName(adName);
    setGenTitle(`${adName} - variation`);
    const bodyContext = ad.body ? `\n\nOriginal ad copy: "${ad.body}"` : '';
    const headlineContext = ad.headline ? `\nHeadline: "${ad.headline}"` : '';
    setGenPrompt(`Create a product ad video similar to "${adName}". High-converting e-commerce style, fast-paced, eye-catching visuals.${headlineContext}${bodyContext}`);
    setGenAngle('');
    setShowGenerate(true);
  }

  function formatCta(cta: string | null): string {
    if (!cta) return '';
    return cta.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  async function handleGenerate() {
    if (!storeFilter || !genPrompt || !genTitle) return;
    const engineLabel = genEngine === 'sora' ? 'Sora' : genEngine === 'veo' ? 'Veo' : genEngine === 'minimax' ? 'Hailuo' : genEngine === 'minimax-image' ? 'MiniMax Image' : 'NanoBanana';
    if (!window.confirm(`Generate with ${engineLabel}? This will call the API and may incur costs.`)) return;
    setGenerating(true);
    setGenResult(null);
    try {
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
      if (data.success) {
        loadCreatives();
      }
    } catch (err: any) {
      setGenResult({ error: err.message || 'Network error' });
    }
    setGenerating(false);
  }

  async function pollStatus(id: string) {
    try {
      const res = await fetch(`/api/creatives/generate?id=${id}`);
      const data = await res.json();
      if (data.creative) {
        setCreatives(prev => prev.map(c => c.id === id ? { ...c, ...data.creative, progress: data.progress ?? c.progress } : c));
      }
    } catch {}
  }

  // Auto-poll processing creatives every 15 seconds
  useEffect(() => {
    const processing = creatives.filter(c => c.nb_status === 'processing');
    if (processing.length === 0) return;
    const interval = setInterval(() => {
      processing.forEach(c => pollStatus(c.id));
    }, 15000);
    return () => clearInterval(interval);
  }, [creatives]);

  async function loadBatches() {
    if (!storeFilter) { setBatches([]); setLoading(false); return; }
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/batches?storeId=${storeFilter}`);
      const data = await res.json();
      setBatches(data.batches || []);
    } catch {
      setBatches([]);
      setFetchError('Failed to load batches. Check your connection and try again.');
    }
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
    if (!window.confirm(`Start generating ${wizVideoPrompts.length} video(s) with Sora? This will call the API and may incur costs.`)) return;
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
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch {
        setWizError(`Server error (${res.status}). Try again or check server logs.`);
        setWizLoading(false);
        return;
      }
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
    setDoublingDown(batchId);
    try {
      const res = await fetch(`/api/batches/${batchId}/double-down`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        loadBatches();
      } else {
        alert(data.error || 'Double down failed');
      }
    } catch (err: any) {
      alert(err.message || 'Double down failed');
    }
    setDoublingDown(null);
  }

  // ═══ Creative Generator Functions ═══

  // Load account intelligence from backend API
  async function loadAccountIntelligence() {
    if (!storeFilter) return;
    try {
      const res = await fetch(`/api/creatives/intelligence?storeId=${storeFilter}`);
      const data = await res.json();
      if (data.intelligence) setAccountIntel(data.intelligence);
    } catch {}
  }

  // Fetch intelligence when switching to generator tab
  useEffect(() => {
    if (tab === 'generator' && storeFilter && !accountIntel) {
      loadAccountIntelligence();
    }
  }, [tab, storeFilter]);

  // Load generation history when switching to generator tab
  useEffect(() => {
    if (tab === 'generator' && storeFilter) loadGenHistory();
  }, [tab, storeFilter]);

  async function loadGenHistory() {
    if (!storeFilter) return;
    setGenHistoryLoading(true);
    try {
      const res = await fetch(`/api/creatives/generate-package?storeId=${storeFilter}`);
      const data = await res.json();
      setGenHistory(data.generations || []);
    } catch { setGenHistory([]); }
    setGenHistoryLoading(false);
  }

  async function loadHistoryItem(id: string) {
    try {
      const res = await fetch(`/api/creatives/generate-package?id=${id}`);
      const data = await res.json();
      if (data.packages) {
        setGenPackages(data.packages);
        setGenStrategy(data.strategy);
        setGenPackageConfig({ contentType: data.content_type, creativeType: data.creative_type });
        setExpandedPackage(0);
        setViewingHistory(id);
        setGenCurrentId(id);
        setGenVersion(data.version || 1);
        setComparingPackages([]);
      }
    } catch {}
  }

  /** Safe JSON fetch — handles non-JSON responses, empty bodies, and HTTP errors */
  async function safeJsonFetch(url: string, options: RequestInit): Promise<{ data: any; error?: string }> {
    try {
      const res = await fetch(url, options);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const text = await res.text().catch(() => '');
        return { data: null, error: `Server returned non-JSON response (${res.status}): ${text.substring(0, 200) || 'empty body'}` };
      }
      const text = await res.text();
      if (!text || text.trim().length === 0) {
        return { data: null, error: `Server returned empty response (${res.status})` };
      }
      const data = JSON.parse(text);
      return { data };
    } catch (err: any) {
      return { data: null, error: err.message || 'Network error — check your connection' };
    }
  }

  async function handleGeneratePackage() {
    if (!storeFilter) return;
    if (!window.confirm(`Generate ${genConfig.quantity} creative package(s) using ChatGPT? This will call the OpenAI API.`)) return;
    setGeneratingPackage(true);
    setGenPackageError('');
    setGenPackages([]);
    setGenStrategy(null);
    setViewingHistory(null);
    const { data, error } = await safeJsonFetch('/api/creatives/generate-package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: storeFilter, ...genConfig }),
    });
    if (error) {
      setGenPackageError(error);
    } else if (data?.success) {
      setGenPackages(data.packages || []);
      setGenPackageConfig(data.config);
      setGenStrategy(data.strategy);
      setExpandedPackage(0);
      setGenCurrentId(data.id);
      setGenVersion(data.version || 1);
      setComparingPackages([]);
      setViewingHistory(null);
      loadGenHistory();
      if (data.fallback) {
        setGenPackageError(data.fallbackReason || 'AI unavailable — draft packages generated from rules.');
      } else if (data.cached) {
        setGenPackageError(data.cacheReason || 'Returned cached result from a recent identical generation.');
      }
    } else {
      const errObj = data?.error;
      if (errObj?.code === 'insufficient_quota' || errObj?.code === 'GENERATION_FAILED') {
        setGenPackageError('AI generation temporarily unavailable. Please check OpenAI billing or try again later.');
      } else {
        const errMsg = errObj?.message || data?.error || 'Generation failed';
        setGenPackageError(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
      }
    }
    setGeneratingPackage(false);
  }

  async function handleGenerateVariations(packageIndex: number) {
    if (!storeFilter || !genCurrentId) return;
    if (!window.confirm(`Generate ${genConfig.quantity} variations of package #${packageIndex + 1}? This will call the OpenAI API.`)) return;
    setGeneratingPackage(true);
    setGenPackageError('');
    const { data, error } = await safeJsonFetch('/api/creatives/generate-package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: storeFilter, ...genConfig,
        generationGoal: 'generate_variations',
        parentId: genCurrentId,
        parentPackageIndex: packageIndex,
      }),
    });
    if (error) {
      setGenPackageError(error);
    } else if (data?.success) {
      setGenPackages(data.packages || []);
      setGenPackageConfig(data.config);
      setGenStrategy(data.strategy);
      setExpandedPackage(0);
      setGenCurrentId(data.id);
      setGenVersion(data.version || 1);
      setComparingPackages([]);
      loadGenHistory();
    } else {
      setGenPackageError(data?.error?.message || data?.error || 'Variation generation failed');
    }
    setGeneratingPackage(false);
  }

  function toggleCompare(idx: number) {
    setComparingPackages(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx].slice(0, 3));
  }

  async function handleGenerateVideoFromPackage(pkg: any, idx: number, engine: string = 'sora') {
    if (!storeFilter) return;
    const isVideo = genPackageConfig?.contentType === 'video';
    if (!isVideo) {
      if (!window.confirm('Generate image with MiniMax? This will call the API.')) return;
    } else {
      const engineNames: Record<string, string> = { sora: 'Sora', veo: 'Veo', minimax: 'Hailuo', runway: 'Runway', higgsfield: 'Higgsfield' };
      if (!window.confirm(`Generate video with ${engineNames[engine] || engine}? This will call the API and may incur costs.`)) return;
    }
    setGeneratingVideoIdx(idx);

    // Gather product images FIRST (needed for image plan + prompt + payload)
    const selectedProduct = genConfig.productId ? products.find(p => p.id === genConfig.productId) : null;
    const productName = selectedProduct?.title || '';
    const productImageUrls: string[] = [];
    if (selectedProduct?.image_url) productImageUrls.push(selectedProduct.image_url);
    if (selectedProduct?.images) {
      try { const parsed = JSON.parse(selectedProduct.images) as string[]; for (const u of parsed) { if (u && !productImageUrls.includes(u)) productImageUrls.push(u); } } catch {}
    }

    // Clear any previous failed status for this package
    setPackageVideoStatus(prev => { const n = { ...prev }; delete n[idx]; return n; });

    // Block generation if product is selected but has no images
    if (genConfig.productId && productImageUrls.length === 0) {
      setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: '', status: 'failed', engine, reason: 'No product images. Add images first.' } }));
      setGeneratingVideoIdx(null);
      return;
    }

    // Build video prompt with realism + brand fidelity + multi-image plan
    const parts: string[] = [];
    parts.push('RULES: Handheld iPhone camera, natural lighting, real environment. NO background music, NO soundtrack — voice and room tone only. UGC native feel.');
    if (productName) {
      parts.push(`BRAND FIDELITY (STRICT): The product MUST be "${productName}" exactly as shown in the ${productImageUrls.length} provided reference images. Use exact bottle shape, cap color, label layout, color palette. Do NOT replace with generic bottle. Do NOT hallucinate label text. Use medium/wide shots for branding. Avoid extreme close-ups of labels.`);
    }
    const imagePlan = buildProductImagePlan(productImageUrls.length, genConfig.creativeType, genPackageConfig?.contentType || 'video');
    if (imagePlan.promptDirective) parts.push(imagePlan.promptDirective);
    if (pkg.visualDirection) parts.push(pkg.visualDirection);
    if (pkg.script) parts.push(`Script: ${pkg.script}`);
    if (pkg.sceneStructure) parts.push(`Scene structure: ${pkg.sceneStructure}`);
    if (pkg.brollDirection) parts.push(`B-roll: ${pkg.brollDirection}`);
    if (pkg.avatarSuggestion || pkg.presenterBehavior) parts.push(`Presenter: ${pkg.presenterBehavior || pkg.avatarSuggestion}`);
    if (!isVideo) {
      if (pkg.visualComposition) parts.push(pkg.visualComposition);
      if (pkg.headline) parts.push(`Headline: ${pkg.headline}`);
    }
    let prompt = parts.join('\n\n') || pkg.script || pkg.adCopy || '';
    prompt = prompt.replace(/\b(background music|ambient music|soundtrack|cinematic score|music bed|upbeat track|gentle melody|soft music|lo-fi beat|trending audio)\b/gi, 'natural room tone');

    // Runway/Higgsfield need ultra-simple visual motion prompts with correct product behavior.
    let finalPrompt = prompt;
    if (engine === 'runway' || engine === 'higgsfield') {
      const cleanProductName = (productName || 'the supplement').replace(/[™®©–—]/g, '').replace(/\s+/g, ' ').trim();

      // Pure visual motion prompt with strict supplement bottle behavior
      const runwayPrompt = [
        `A woman in her 30s holds a small supplement capsule bottle labeled ${cleanProductName}.`,
        'The bottle is a small handheld supplement container, about 5 inches tall, NOT a water bottle or beverage.',
        'She unscrews the cap, pours two capsules into her palm, puts them in her mouth, and drinks from a separate glass of water.',
        'She does NOT drink from the bottle. The bottle stays small in her hand at realistic supplement bottle scale.',
        'Handheld iPhone camera, natural window lighting, real kitchen with lived-in details.',
        'Shallow depth of field, warm color grade. Smooth natural movement.',
      ].join(' ');

      finalPrompt = runwayPrompt.substring(0, 500);
    } else {
      finalPrompt = prompt.substring(0, 2000);
    }

    const payload = {
      storeId: storeFilter,
      engine: isVideo ? engine : 'minimax-image',
      type: productImageUrls.length > 0 ? 'image-to-video' : 'text-to-video',
      prompt: finalPrompt,
      title: pkg.title || `Package ${idx + 1}`,
      angle: pkg.angle || undefined,
      imageUrls: productImageUrls.length > 0 ? productImageUrls : undefined,
      resolution: '720p-vertical',
      duration: 20,
      packageId: genCurrentId,
      packageIndex: idx,
    };

    const { data, error } = await safeJsonFetch('/api/creatives/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (error) {
      setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: '', status: 'failed', engine, reason: error } }));
    } else if (data?.success) {
      setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: data.id, status: 'processing', engine: data.engine || engine } }));
      loadCreatives();
    } else {
      const errCode = data?.error?.code;
      const reason = errCode === 'QUOTA_EXCEEDED'
        ? `${engine} billing limit. Try another engine.`
        : errCode === 'MISSING_IMAGE'
        ? 'Product image required.'
        : (data?.error?.message || 'Generation failed');
      setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: '', status: 'failed', engine, reason } }));
    }
    setGeneratingVideoIdx(null);
  }

  const totalSpend = adSets.reduce((s, a) => s + a.totalSpend, 0);
  const totalPurchases = adSets.reduce((s, a) => s + a.totalPurchases, 0);
  const winnerCount = adSets.reduce((s, a) => s + a.ads.filter(ad => ad.isWinner).length, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Creatives & Ad Review</h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">Review ad performance, find winners, generate new creatives</p>
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
      <div className="flex gap-1 mb-6 bg-slate-900 p-1 rounded-lg w-full sm:w-fit overflow-x-auto">
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
        <button
          onClick={() => setTab('generator')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'generator' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Creative Generator
        </button>
      </div>

      {/* Fetch error banner */}
      {fetchError && (
        <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-800/50 rounded-xl flex items-center justify-between">
          <p className="text-xs text-red-400">{fetchError}</p>
          <button
            onClick={() => { setFetchError(null); if (tab === 'performance') loadPerformance(); else if (tab === 'generated') loadCreatives(); else loadBatches(); }}
            className="px-3 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs rounded-lg ml-3 flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

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
                      onClick={() => {
                        setRecreateEngine(eng.key);
                        // Reset duration to engine default
                        const defaults: Record<string, string> = { veo: '8', sora: '20', minimax: '6' };
                        setRecreateDuration(defaults[eng.key] || '8');
                      }}
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowGenerate(false); }}>
          <div className="bg-slate-900 border border-purple-900/50 rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">
              Generate Video
              {prefillAdName && <span className="text-purple-400 font-normal ml-2">Based on: {prefillAdName}</span>}
            </h2>
            <button onClick={() => setShowGenerate(false)} className="text-slate-400 hover:text-white text-sm">Close</button>
          </div>

          {/* Engine selector */}
          <div className="flex flex-wrap gap-1 bg-slate-800 p-0.5 rounded-lg w-full sm:w-fit mb-4 overflow-x-auto">
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
            {(genEngine === 'nanobanana' || genEngine === 'minimax' || genEngine === 'sora' || genEngine === 'veo') && (
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
          {genType === 'image-to-video' && (genEngine === 'sora' || genEngine === 'veo' || genEngine === 'minimax' || genEngine === 'nanobanana') && (
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
        </div>
      )}

      {/* Performance Tab */}
      {tab === 'performance' && (
        <>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
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
                    <div className="flex items-center gap-4 sm:gap-6 flex-shrink-0 ml-4">
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
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-slate-500">CPA</p>
                        <p className="text-sm font-semibold text-white">{set.cpa > 0 ? cents(set.cpa) : '-'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500">Purch</p>
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
                            <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0 flex-wrap justify-end">
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
                              <div className="text-right hidden sm:block">
                                <p className="text-[10px] text-slate-500">CPA</p>
                                <p className="text-xs font-semibold text-white">{ad.cpa > 0 ? cents(ad.cpa) : '-'}</p>
                              </div>
                              <div className="text-right hidden sm:block">
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
                            <div className="ml-0 sm:ml-20 mt-1 mb-3 p-4 bg-slate-800/60 rounded-lg border border-slate-700/50">
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
                                  <div className="flex flex-wrap gap-2 mt-4">
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
                                    <div className={`mt-4 p-4 bg-slate-900/80 rounded-lg border ${adAnalysis[ad.adId].startsWith('Error') || adAnalysis[ad.adId].startsWith('Analysis timed out') ? 'border-red-900/30' : 'border-orange-900/30'}`}>
                                      <h4 className="text-[10px] text-orange-400 uppercase font-semibold mb-2">Video Creative DNA (Twelve Labs)</h4>
                                      <div className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                                        {adAnalysis[ad.adId]}
                                      </div>
                                      {/* Show file upload fallback when auto-resolve fails */}
                                      {(adAnalysis[ad.adId].includes('upload') || adAnalysis[ad.adId].includes('No video found') || adAnalysis[ad.adId].includes('Failed to fetch') || adAnalysis[ad.adId].includes('timed out')) && (
                                        <label className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-medium rounded-lg cursor-pointer">
                                          Upload Video File to Analyze
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
              <p className="text-xs text-slate-500 mt-1">Generate videos using Sora, Veo, Hailuo, or NanoBanana</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {creatives.map((c) => (
                <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  {/* Thumbnail */}
                  {c.nb_status === 'completed' && c.file_url && c.type === 'video' && !expiredVideos.has(c.id) ? (
                    <video
                      src={mediaUrl(c.file_url)}
                      poster={mediaUrl(c.thumbnail_url)}
                      controls
                      preload="metadata"
                      className="w-full aspect-[9/16] object-contain bg-black"
                      onError={() => setExpiredVideos(prev => new Set(prev).add(c.id))}
                    />
                  ) : c.nb_status === 'completed' && expiredVideos.has(c.id) ? (
                    <div className="w-full aspect-[9/16] bg-slate-800 flex items-center justify-center">
                      <div className="text-center px-4">
                        <svg className="w-10 h-10 text-slate-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <p className="text-xs text-slate-500">Video Expired</p>
                        <p className="text-[10px] text-slate-600 mt-1">Sora video URLs are temporary and this video is no longer available for download.</p>
                      </div>
                    </div>
                  ) : c.thumbnail_url || (c.nb_status === 'completed' && c.file_url) ? (
                    <img src={mediaUrl(c.thumbnail_url || c.file_url)} alt="" className="w-full aspect-[9/16] object-contain bg-black" />
                  ) : (
                    <div className="w-full aspect-[9/16] bg-slate-800 flex items-center justify-center">
                      {c.nb_status === 'processing' ? (
                        <div className="text-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-2" />
                          <p className="text-xs text-purple-400">
                            {c.progress != null ? `Generating... ${c.progress}%` : 'Generating...'}
                          </p>
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
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${
                          c.type === 'video' ? 'bg-blue-900/30 text-blue-400' : 'bg-purple-900/30 text-purple-400'
                        }`}>{c.type}</span>
                        {c.template_id && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            c.template_id === 'sora' ? 'bg-indigo-900/30 text-indigo-400' :
                            c.template_id === 'veo' ? 'bg-cyan-900/30 text-cyan-400' :
                            c.template_id === 'minimax' || c.template_id === 'minimax-image' ? 'bg-orange-900/30 text-orange-400' :
                            'bg-slate-800 text-slate-400'
                          }`}>{c.template_id}</span>
                        )}
                        <span className="text-[10px] text-slate-600">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
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
                          rows={4}
                          className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-slate-300 resize-y mb-1"
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
                  <p className="text-xs text-slate-400 mb-4">{wizVideoPrompts.length} video{wizVideoPrompts.length !== 1 ? 's' : ''} are being generated with enriched prompts.</p>
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
              <p className="text-xs text-slate-500 mt-1">Create a batch to auto-generate 5 videos from winning ad patterns</p>
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map(b => {
                let angles: string[] = [];
                try { angles = b.winning_angles ? JSON.parse(b.winning_angles) : []; } catch { angles = []; }
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
                            const statusOrder: Record<string, number> = {
                              pending: 0, generating_prompts: 1, prompts_ready: 2,
                              generating: 3, active: 4, completed: 5, failed: -1,
                            };
                            const stepThresholds = [1, 2, 4, 4, 5]; // min ordinal for each step to be "done"
                            const currentOrdinal = statusOrder[b.status] ?? -1;
                            const isFailed = b.status === 'failed';
                            const isDone = !isFailed && currentOrdinal >= stepThresholds[i];
                            return (
                              <div key={step} className="flex items-center gap-1">
                                <span className={`px-2 py-1 rounded ${
                                  isFailed ? 'bg-red-900/30 text-red-400' :
                                  isDone ? 'bg-emerald-900/30 text-emerald-400' :
                                  'bg-slate-800 text-slate-500'
                                }`}>{step}</span>
                                {i < 4 && <span className="text-slate-700">→</span>}
                              </div>
                            );
                          })}
                        </div>

                        {/* Videos */}
                        {bc.filter(c => c.type === 'video').length > 0 && (
                          <div className="mb-4">
                            <h4 className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Videos</h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                              {bc.filter(c => c.type === 'video').map(c => (
                                <div key={c.id} className="bg-slate-800/50 rounded-lg overflow-hidden">
                                  <div className="aspect-[9/16] bg-black flex items-center justify-center relative">
                                    {c.nb_status === 'completed' && c.file_url && !expiredVideos.has(c.id) ? (
                                      <video
                                        src={mediaUrl(c.file_url)}
                                        poster={mediaUrl(c.thumbnail_url)}
                                        controls
                                        preload="metadata"
                                        className="w-full h-full object-contain"
                                        onError={() => setExpiredVideos(prev => new Set(prev).add(c.id))}
                                      />
                                    ) : c.nb_status === 'completed' && expiredVideos.has(c.id) ? (
                                      <div className="text-center px-2">
                                        <svg className="w-8 h-8 text-slate-600 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        <p className="text-[10px] text-slate-500">Video expired</p>
                                        <p className="text-[9px] text-slate-600">Sora URLs are temporary</p>
                                      </div>
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
                              disabled={doublingDown === b.id}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg"
                            >
                              {doublingDown === b.id ? 'Doubling Down...' : 'Double Down on Winners'}
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

      {/* ═══ Creative Generator Tab ═══ */}
      {tab === 'generator' && (
        <>
          {!storeFilter ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">Select a store to use the Creative Generator</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* LEFT: Generator Form */}
              <div className="lg:col-span-2 space-y-5">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-white mb-4">Creative Generator</h2>

                  {/* Content Type */}
                  <div className="mb-4">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Content Type</label>
                    <div className="flex gap-2">
                      {(['video', 'image'] as const).map(t => (
                        <button key={t} onClick={() => setGenConfig(c => ({ ...c, contentType: t }))}
                          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                            genConfig.contentType === t ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>{t === 'video' ? 'Video' : 'Image'}</button>
                      ))}
                    </div>
                  </div>

                  {/* Creative Type */}
                  <div className="mb-4">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Creative Type</label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                      {CREATIVE_TYPES.map(ct => (
                        <button key={ct.key} onClick={() => setGenConfig(c => ({ ...c, creativeType: ct.key }))}
                          className={`px-2 py-2 rounded-lg text-[10px] font-medium border transition-colors text-center ${
                            genConfig.creativeType === ct.key ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>
                          <span className="block text-sm mb-0.5">{ct.icon}</span>{ct.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Funnel Stage */}
                  <div className="mb-4">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Funnel Stage</label>
                    <div className="flex gap-2">
                      {([
                        { key: 'tof', label: 'Top of Funnel', desc: 'Awareness' },
                        { key: 'mof', label: 'Middle of Funnel', desc: 'Consideration' },
                        { key: 'bof', label: 'Bottom of Funnel', desc: 'Conversion' },
                      ] as const).map(f => (
                        <button key={f.key} onClick={() => setGenConfig(c => ({ ...c, funnelStage: f.key }))}
                          className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                            genConfig.funnelStage === f.key ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>
                          {f.label}<br /><span className="text-[9px] opacity-60">{f.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Product & Offer */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold mb-1 block">Product</label>
                      <select value={genConfig.productId} onChange={e => setGenConfig(c => ({ ...c, productId: e.target.value }))}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500">
                        <option value="">Select product...</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.title} — {cents(p.price_cents)}</option>)}
                      </select>
                      {/* Product image preview */}
                      {(() => {
                        if (!genConfig.productId) return null;
                        const selProduct = products.find(p => p.id === genConfig.productId);
                        if (!selProduct) return null;
                        const allImgs: string[] = [];
                        if (selProduct.image_url) allImgs.push(selProduct.image_url);
                        if (selProduct.images) {
                          try {
                            const parsed = JSON.parse(selProduct.images) as string[];
                            for (const u of parsed) { if (u && !allImgs.includes(u)) allImgs.push(u); }
                          } catch {}
                        }
                        if (allImgs.length === 0) return (
                          <div className="mt-2 px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                            <p className="text-[10px] text-slate-500">No product images available</p>
                          </div>
                        );
                        return (
                          <div className="mt-2 bg-slate-800/50 border border-slate-700/50 rounded-lg p-2.5">
                            <div className="flex gap-2.5">
                              <img src={allImgs[0]} alt={selProduct.title} className="w-16 h-16 rounded-lg object-cover bg-slate-800 border border-slate-700 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-white font-medium truncate">{selProduct.title}</p>
                                <p className="text-[10px] text-slate-400">{cents(selProduct.price_cents)} <span className="text-emerald-400 ml-1">{allImgs.length} image{allImgs.length !== 1 ? 's' : ''} will be used</span></p>
                                {selProduct.description && <p className="text-[10px] text-slate-500 truncate mt-0.5">{selProduct.description}</p>}
                              </div>
                            </div>
                            {allImgs.length > 1 && (
                              <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
                                {allImgs.slice(1).map((url, i) => (
                                  <img key={i} src={url} alt="" className="w-10 h-10 rounded object-cover bg-slate-800 border border-slate-700 flex-shrink-0" />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold mb-1 block">Offer / Bundle</label>
                      <input type="text" value={genConfig.offer} onChange={e => setGenConfig(c => ({ ...c, offer: e.target.value }))}
                        placeholder="e.g. Buy 2 Get 1 Free" className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500" />
                    </div>
                  </div>

                  {/* Hook Style & Avatar */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Hook Style</label>
                      <div className="flex flex-wrap gap-1.5">
                        {HOOK_STYLES.map(h => (
                          <button key={h.key} onClick={() => setGenConfig(c => ({ ...c, hookStyle: h.key }))}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-medium border ${
                              genConfig.hookStyle === h.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                            }`}>{h.label}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Avatar / Presenter</label>
                      <div className="flex flex-wrap gap-1.5">
                        {AVATAR_STYLES.map(a => (
                          <button key={a.key} onClick={() => setGenConfig(c => ({ ...c, avatarStyle: a.key }))}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-medium border ${
                              genConfig.avatarStyle === a.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                            }`}>{a.label}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Generation Goal */}
                  <div className="mb-4">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Generation Goal</label>
                    <div className="flex flex-wrap gap-1.5">
                      {GENERATION_GOALS.map(g => (
                        <button key={g.key} onClick={() => setGenConfig(c => ({ ...c, generationGoal: g.key }))}
                          className={`px-3 py-2 rounded-lg text-[10px] font-medium border ${
                            genConfig.generationGoal === g.key ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>{g.label}</button>
                      ))}
                    </div>
                  </div>

                  {/* Platform Target */}
                  <div className="mb-4">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Platform</label>
                    <div className="flex gap-2">
                      {([
                        { key: 'meta', label: 'Facebook / Meta', desc: 'Feed, Reels, Stories' },
                        { key: 'tiktok', label: 'TikTok', desc: 'For You Page' },
                      ] as const).map(p => (
                        <button key={p.key} onClick={() => setGenConfig(c => ({ ...c, platformTarget: p.key }))}
                          className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                            genConfig.platformTarget === p.key ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>
                          {p.label}<br /><span className="text-[9px] opacity-60">{p.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quantity */}
                  <div className="mb-5">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Quantity</label>
                    <div className="flex gap-2">
                      {[1, 3, 5, 10].map(q => (
                        <button key={q} onClick={() => setGenConfig(c => ({ ...c, quantity: q }))}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                            genConfig.quantity === q ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>{q}</button>
                      ))}
                    </div>
                  </div>

                  {/* CTA Buttons */}
                  {genPackageError && (
                    <div className="mb-3 px-3 py-2 bg-red-900/20 border border-red-800 rounded-lg text-xs text-red-400">{genPackageError}</div>
                  )}
                  <div className="flex gap-3">
                    <button onClick={handleGeneratePackage} disabled={generatingPackage}
                      className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
                      {generatingPackage ? 'Generating...' : 'Generate Creative Package'}
                    </button>
                    <button onClick={() => { setGenConfig(c => ({ ...c, generationGoal: 'generate_variations' })); handleGeneratePackage(); }}
                      disabled={generatingPackage || genPackages.length === 0}
                      className="px-4 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg border border-slate-700 transition-colors">
                      Generate Variations
                    </button>
                  </div>
                </div>

                {/* ═══ Generated Output Area ═══ */}
                {generatingPackage && (
                  <div className="bg-slate-900 border border-purple-900/30 rounded-xl p-6 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-3" />
                    <p className="text-white font-medium text-sm">Generating {genConfig.quantity} creative package{genConfig.quantity > 1 ? 's' : ''}...</p>
                    <div className="flex justify-center gap-6 mt-3 text-[10px]">
                      <span className="text-emerald-400">Account data loaded</span>
                      <span className="text-emerald-400">Strategy built</span>
                      <span className="text-purple-400 animate-pulse">AI generating...</span>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-2">~5-10 seconds</p>
                  </div>
                )}

                {genPackages.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">Generated Packages ({genPackages.length})</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">v{genVersion}</span>
                        {genVersion > 1 && <span className="text-[10px] text-purple-400">variation</span>}
                      </div>
                      {comparingPackages.length >= 2 && (
                        <span className="text-[10px] text-blue-400">{comparingPackages.length} selected for comparison</span>
                      )}
                    </div>
                    {genPackages.map((pkg, idx) => {
                      const isVideo = genPackageConfig?.contentType === 'video';
                      const isOpen = expandedPackage === idx;
                      return (
                        <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                          <button onClick={() => setExpandedPackage(isOpen ? null : idx)}
                            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">#{idx + 1}</span>
                                <h4 className="text-sm font-semibold text-white truncate">{(pkg as any).title || `Package ${idx + 1}`}</h4>
                                {(pkg as any)._fallback && <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400">Draft</span>}
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${isVideo ? 'bg-blue-900/30 text-blue-400' : 'bg-orange-900/30 text-orange-400'}`}>
                                  {isVideo ? 'Video' : 'Image'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 truncate">{(pkg as any).angle || (pkg as any).conceptAngle || ''}</p>
                            </div>
                            <svg className={`w-5 h-5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {isOpen && (
                            <div className="border-t border-slate-800 px-5 py-4 space-y-4">
                              {isVideo ? (
                                <>
                                  {(pkg as VideoPackage).hook && (
                                    <div><p className="text-[10px] text-purple-400 uppercase font-semibold mb-1">Hook (0-3s)</p><p className="text-sm text-white bg-purple-900/20 border border-purple-900/30 rounded-lg p-3">{(pkg as VideoPackage).hook}</p></div>
                                  )}
                                  {(pkg as VideoPackage).script && (
                                    <div><p className="text-[10px] text-blue-400 uppercase font-semibold mb-1">Full Script</p><pre className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{(pkg as VideoPackage).script}</pre></div>
                                  )}
                                  {(pkg as VideoPackage).sceneStructure && (
                                    <div><p className="text-[10px] text-cyan-400 uppercase font-semibold mb-1">Scene Structure</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as VideoPackage).sceneStructure}</p></div>
                                  )}
                                  {(pkg as VideoPackage).visualDirection && (
                                    <div><p className="text-[10px] text-indigo-400 uppercase font-semibold mb-1">Visual Direction</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as VideoPackage).visualDirection}</p></div>
                                  )}
                                  {(pkg as VideoPackage).brollDirection && (
                                    <div><p className="text-[10px] text-teal-400 uppercase font-semibold mb-1">B-Roll Direction</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as VideoPackage).brollDirection}</p></div>
                                  )}
                                  {(pkg as VideoPackage).avatarSuggestion && (
                                    <div><p className="text-[10px] text-amber-400 uppercase font-semibold mb-1">Avatar / Presenter</p><p className="text-xs text-slate-300">{(pkg as VideoPackage).avatarSuggestion}</p></div>
                                  )}
                                  {(pkg as VideoPackage).cta && (
                                    <div><p className="text-[10px] text-emerald-400 uppercase font-semibold mb-1">CTA</p><p className="text-sm text-emerald-300 font-medium">{(pkg as VideoPackage).cta}</p></div>
                                  )}
                                </>
                              ) : (
                                <>
                                  {(pkg as ImagePackage).headline && (
                                    <div><p className="text-[10px] text-purple-400 uppercase font-semibold mb-1">Headline</p><p className="text-lg text-white font-bold">{(pkg as ImagePackage).headline}</p></div>
                                  )}
                                  {(pkg as ImagePackage).conceptAngle && (
                                    <div><p className="text-[10px] text-blue-400 uppercase font-semibold mb-1">Concept</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as ImagePackage).conceptAngle}</p></div>
                                  )}
                                  {(pkg as ImagePackage).visualComposition && (
                                    <div><p className="text-[10px] text-indigo-400 uppercase font-semibold mb-1">Visual Composition</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as ImagePackage).visualComposition}</p></div>
                                  )}
                                  {(pkg as ImagePackage).offerPlacement && (
                                    <div><p className="text-[10px] text-amber-400 uppercase font-semibold mb-1">Offer Placement</p><p className="text-xs text-slate-300">{(pkg as ImagePackage).offerPlacement}</p></div>
                                  )}
                                  {(pkg as ImagePackage).ctaDirection && (
                                    <div><p className="text-[10px] text-emerald-400 uppercase font-semibold mb-1">CTA Direction</p><p className="text-sm text-emerald-300 font-medium">{(pkg as ImagePackage).ctaDirection}</p></div>
                                  )}
                                </>
                              )}
                              {/* Ad Copy */}
                              {(pkg as any).adCopy && (
                                <div><p className="text-[10px] text-orange-400 uppercase font-semibold mb-1">Ad Copy</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{(pkg as any).adCopy}</p></div>
                              )}
                              {/* Variants */}
                              {(pkg as any).variants?.length > 0 && (
                                <div>
                                  <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">Variant Ideas</p>
                                  <ul className="space-y-1">
                                    {(pkg as any).variants.map((v: string, vi: number) => (
                                      <li key={vi} className="text-xs text-slate-400 flex items-start gap-2"><span className="text-slate-600 mt-0.5">•</span>{v}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {/* Action Buttons */}
                              <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-800">
                                {/* Generate Video — one-click pipeline */}
                                {isVideo && !packageVideoStatus[idx] && (
                                  <div className="flex gap-1">
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx, 'sora')} disabled={generatingVideoIdx !== null}
                                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-l-lg">
                                      {generatingVideoIdx === idx ? 'Sending...' : 'Generate Video'}
                                    </button>
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx, 'veo')} disabled={generatingVideoIdx !== null}
                                      className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium border-l border-emerald-500">Veo</button>
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx, 'minimax')} disabled={generatingVideoIdx !== null}
                                      className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium border-l border-emerald-500">MM</button>
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx, 'runway')} disabled={generatingVideoIdx !== null}
                                      className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium border-l border-emerald-500">Runway</button>
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx, 'higgsfield')} disabled={generatingVideoIdx !== null}
                                      className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium rounded-r-lg border-l border-emerald-500">Higgs</button>
                                  </div>
                                )}
                                {packageVideoStatus[idx] && (
                                  packageVideoStatus[idx].status === 'failed' ? (
                                    <button onClick={() => setPackageVideoStatus(prev => { const n = { ...prev }; delete n[idx]; return n; })}
                                      className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 cursor-pointer"
                                      title="Click to dismiss and retry">
                                      {packageVideoStatus[idx].reason || 'Failed'} — click to retry
                                    </button>
                                  ) : (
                                    <span className={`px-3 py-1.5 text-[10px] font-medium rounded-lg ${
                                      packageVideoStatus[idx].status === 'processing' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-emerald-900/30 text-emerald-400'
                                    }`}>
                                      {packageVideoStatus[idx].status === 'processing'
                                        ? `Generating with ${packageVideoStatus[idx].engine}...`
                                        : `Video queued${packageVideoStatus[idx].engine === 'runway' || packageVideoStatus[idx].engine === 'higgsfield' ? ' (silent — add voiceover separately)' : ''}`}
                                    </span>
                                  )
                                )}
                                <button onClick={() => handleGenerateVariations(idx)} disabled={generatingPackage}
                                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg">Vary</button>
                                <button onClick={() => toggleCompare(idx)}
                                  className={`px-3 py-1.5 text-[10px] font-medium rounded-lg border ${comparingPackages.includes(idx) ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                                  {comparingPackages.includes(idx) ? 'Comparing' : 'Compare'}
                                </button>
                                <button onClick={() => navigator.clipboard.writeText(JSON.stringify(pkg, null, 2))}
                                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-medium rounded-lg border border-slate-700">Export</button>
                                <button onClick={() => { const script = (pkg as any).script || (pkg as any).adCopy || ''; navigator.clipboard.writeText(script); }}
                                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-medium rounded-lg border border-slate-700">Copy Script</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Comparison View */}
                {comparingPackages.length >= 2 && genPackages.length > 0 && (
                  <div className="bg-slate-900 border border-blue-900/30 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-white">Compare Packages</h3>
                      <button onClick={() => setComparingPackages([])} className="text-[10px] text-slate-400 hover:text-white">Clear</button>
                    </div>
                    <div className={`grid gap-4 ${comparingPackages.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                      {comparingPackages.map(idx => {
                        const pkg = genPackages[idx];
                        if (!pkg) return null;
                        const isVideo = genPackageConfig?.contentType === 'video';
                        return (
                          <div key={idx} className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">#{idx + 1}</span>
                              <p className="text-xs font-semibold text-white truncate">{(pkg as any).title}</p>
                            </div>
                            <div><p className="text-[9px] text-slate-500 uppercase">Angle</p><p className="text-[10px] text-slate-300">{(pkg as any).angle || (pkg as any).conceptAngle}</p></div>
                            <div><p className="text-[9px] text-slate-500 uppercase">Hook</p><p className="text-[10px] text-purple-300">{isVideo ? (pkg as any).hook : (pkg as any).headline}</p></div>
                            <div><p className="text-[9px] text-slate-500 uppercase">CTA</p><p className="text-[10px] text-emerald-300">{(pkg as any).cta || (pkg as any).ctaDirection}</p></div>
                            {isVideo && <div><p className="text-[9px] text-slate-500 uppercase">Avatar</p><p className="text-[10px] text-slate-300">{(pkg as any).avatarSuggestion}</p></div>}
                            <div><p className="text-[9px] text-slate-500 uppercase">Structure</p><p className="text-[10px] text-slate-400">{isVideo ? (pkg as any).sceneStructure?.substring(0, 120) : (pkg as any).visualComposition?.substring(0, 120)}...</p></div>
                            <button onClick={() => handleGenerateVariations(idx)} disabled={generatingPackage}
                              className="w-full mt-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg">
                              Vary This One
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Account Intelligence Panel */}
              <div className="space-y-4">
                {/* Recommendations */}
                <div className="bg-slate-900 border border-indigo-900/30 rounded-xl p-4">
                  <h3 className="text-[10px] text-indigo-400 uppercase font-semibold mb-3">Recommendations</h3>
                  {accountIntel ? (
                    <div className="space-y-2.5">
                      {/* Account metrics summary */}
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="bg-slate-800/50 rounded p-2"><p className="text-[9px] text-slate-500">Avg ROAS</p><p className="text-sm font-bold text-white">{accountIntel.metrics.avgRoas}x</p></div>
                        <div className="bg-slate-800/50 rounded p-2"><p className="text-[9px] text-slate-500">Avg CTR</p><p className="text-sm font-bold text-blue-400">{accountIntel.metrics.avgCtr}%</p></div>
                        <div className="bg-slate-800/50 rounded p-2"><p className="text-[9px] text-slate-500">Avg CPA</p><p className="text-sm font-bold text-white">${accountIntel.metrics.avgCpa}</p></div>
                        <div className="bg-slate-800/50 rounded p-2"><p className="text-[9px] text-slate-500">Avg CVR</p><p className="text-sm font-bold text-emerald-400">{accountIntel.metrics.avgCvr}%</p></div>
                      </div>
                      <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Content Type</span><span className="text-xs text-white font-medium capitalize">{accountIntel.recommendations.contentType}</span></div>
                      <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Funnel Stage</span><span className="text-xs text-white font-medium">{accountIntel.recommendations.funnelStage === 'tof' ? 'Top' : accountIntel.recommendations.funnelStage === 'mof' ? 'Middle' : 'Bottom'}</span></div>
                      <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Hook Style</span><span className="text-xs text-white font-medium capitalize">{accountIntel.recommendations.hookStyle}</span></div>
                      <div className="mt-2 pt-2 border-t border-slate-800">
                        <div className="flex justify-between mb-1"><span className="text-[10px] text-slate-500">Confidence</span><span className="text-[10px] text-indigo-400 font-semibold">{accountIntel.recommendations.confidence}%</span></div>
                        <div className="w-full bg-slate-800 rounded-full h-1.5"><div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${accountIntel.recommendations.confidence}%` }} /></div>
                      </div>
                      {accountIntel.recommendations.reasons.length > 0 && (
                        <div className="pt-2">{accountIntel.recommendations.reasons.map((r, i) => <p key={i} className="text-[10px] text-slate-400 mb-0.5">• {r}</p>)}</div>
                      )}
                      <button onClick={() => setGenConfig(c => ({
                        ...c,
                        contentType: accountIntel!.recommendations.contentType as any,
                        funnelStage: accountIntel!.recommendations.funnelStage as any,
                        hookStyle: accountIntel!.recommendations.hookStyle,
                      }))} className="w-full mt-2 px-3 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-800/50 text-indigo-400 text-[10px] font-medium rounded-lg">Apply Recommendations</button>
                    </div>
                  ) : (
                    <div className="text-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-400 mx-auto mb-2" /><p className="text-[10px] text-slate-500">Loading intelligence...</p></div>
                  )}
                </div>

                {/* Top Hooks by CTR */}
                {accountIntel && accountIntel.winners.topHooksByCTR.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <h3 className="text-[10px] text-blue-400 uppercase font-semibold mb-3">Top Hooks by CTR</h3>
                    <div className="space-y-2">
                      {accountIntel.winners.topHooksByCTR.map((h, i) => (
                        <div key={i} className="bg-slate-800/50 rounded-lg p-2.5">
                          <p className="text-xs text-white truncate mb-1">{h.hook}</p>
                          <div className="flex gap-3"><span className="text-[10px] text-blue-400 font-semibold">{h.ctr}% CTR</span><span className="text-[10px] text-emerald-400">{h.roas}x</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Creatives by ROAS */}
                {accountIntel && accountIntel.winners.topCreativesByROAS.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <h3 className="text-[10px] text-emerald-400 uppercase font-semibold mb-3">Top Creatives by ROAS</h3>
                    <div className="space-y-2">
                      {accountIntel.winners.topCreativesByROAS.map((c, i) => (
                        <div key={i} className="flex items-center gap-3 bg-slate-800/30 rounded-lg p-2">
                          <div className="w-10 h-10 rounded bg-slate-800 flex-shrink-0 overflow-hidden">
                            {c.thumbnail ? <img src={c.thumbnail} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><span className="text-[10px] text-slate-600">#{i+1}</span></div>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-white truncate">{c.name}</p>
                            <div className="flex gap-2 mt-0.5">
                              <span className="text-[9px] text-emerald-400 font-semibold">{c.roas}x ROAS</span>
                              <span className="text-[9px] text-slate-500">{c.purchases} purch</span>
                              <span className="text-[9px] text-slate-600">${(c.spend / 100).toFixed(0)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Most Efficient by CPA */}
                {accountIntel && accountIntel.winners.mostEfficientByCPA.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <h3 className="text-[10px] text-amber-400 uppercase font-semibold mb-3">Most Efficient by CPA</h3>
                    <div className="space-y-1.5">
                      {accountIntel.winners.mostEfficientByCPA.map((a, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <span className="text-[10px] text-white truncate flex-1 mr-2">{a.name}</span>
                          <div className="flex gap-2 flex-shrink-0">
                            <span className="text-[10px] text-amber-400 font-semibold">${a.cpa} CPA</span>
                            <span className="text-[9px] text-slate-500">{a.purchases} purch</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Converters by CVR */}
                {accountIntel && accountIntel.winners.topConvertersByCVR.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <h3 className="text-[10px] text-purple-400 uppercase font-semibold mb-3">Top Converters by CVR</h3>
                    <div className="space-y-1.5">
                      {accountIntel.winners.topConvertersByCVR.map((a, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <span className="text-[10px] text-white truncate flex-1 mr-2">{a.name}</span>
                          <div className="flex gap-2 flex-shrink-0">
                            <span className="text-[10px] text-purple-400 font-semibold">{a.cvr}% CVR</span>
                            <span className="text-[9px] text-emerald-400">{a.roas}x</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Trends: Rising / Declining / Fatigue / Scaling */}
                {accountIntel && (accountIntel.trends.rising.length > 0 || accountIntel.trends.declining.length > 0 || accountIntel.trends.fatigueSignals.length > 0 || accountIntel.trends.scalingSignals.length > 0) && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <h3 className="text-[10px] text-cyan-400 uppercase font-semibold mb-3">7-Day Trends</h3>
                    <div className="space-y-3">
                      {accountIntel.trends.rising.length > 0 && (
                        <div>
                          <p className="text-[9px] text-emerald-500 uppercase mb-1">Rising</p>
                          {accountIntel.trends.rising.map((t, i) => (
                            <div key={i} className="flex justify-between text-[10px] mb-0.5"><span className="text-slate-300 truncate mr-2">{t.name}</span><span className="text-emerald-400 flex-shrink-0">+{t.change}x ROAS</span></div>
                          ))}
                        </div>
                      )}
                      {accountIntel.trends.declining.length > 0 && (
                        <div>
                          <p className="text-[9px] text-red-500 uppercase mb-1">Declining</p>
                          {accountIntel.trends.declining.map((t, i) => (
                            <div key={i} className="flex justify-between text-[10px] mb-0.5"><span className="text-slate-400 truncate mr-2">{t.name}</span><span className="text-red-400 flex-shrink-0">{t.change}x ROAS</span></div>
                          ))}
                        </div>
                      )}
                      {accountIntel.trends.fatigueSignals.length > 0 && (
                        <div>
                          <p className="text-[9px] text-yellow-500 uppercase mb-1">Fatigue Signals</p>
                          {accountIntel.trends.fatigueSignals.map((t, i) => (
                            <div key={i} className="flex justify-between text-[10px] mb-0.5"><span className="text-yellow-400/70 truncate mr-2">{t.name}</span><span className="text-yellow-500 flex-shrink-0">{t.prevRoas}x → {t.recentRoas}x</span></div>
                          ))}
                        </div>
                      )}
                      {accountIntel.trends.scalingSignals.length > 0 && (
                        <div>
                          <p className="text-[9px] text-blue-500 uppercase mb-1">Scaling</p>
                          {accountIntel.trends.scalingSignals.map((t, i) => (
                            <div key={i} className="flex justify-between text-[10px] mb-0.5"><span className="text-slate-300 truncate mr-2">{t.name}</span><span className="text-blue-400 flex-shrink-0">+{t.spendIncrease}% spend, {t.recentRoas}x</span></div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Product Performance */}
                {accountIntel && accountIntel.productPerformance.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <h3 className="text-[10px] text-orange-400 uppercase font-semibold mb-3">Product Performance</h3>
                    <div className="space-y-2">
                      {accountIntel.productPerformance.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 bg-slate-800/30 rounded-lg p-2">
                          <div className="w-8 h-8 rounded bg-slate-800 flex-shrink-0 overflow-hidden">
                            {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : <span className="flex w-full h-full items-center justify-center text-[8px] text-slate-600">#{i+1}</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-white truncate">{p.name}</p>
                            <div className="flex gap-2"><span className="text-[9px] text-emerald-400">{p.roas}x</span><span className="text-[9px] text-slate-500">{p.purchases} purch</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Learned Patterns — Feedback Loop */}
                {accountIntel && accountIntel.learnedPatterns && accountIntel.learnedPatterns.totalWithPerformance > 0 && (
                  <div className="bg-slate-900 border border-cyan-900/30 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[10px] text-cyan-400 uppercase font-semibold">Learned Patterns</h3>
                      <span className="text-[9px] text-slate-600">{accountIntel.learnedPatterns.totalWithPerformance} tracked</span>
                    </div>

                    {/* What works */}
                    {accountIntel.learnedPatterns.whatWorks.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[9px] text-emerald-500 uppercase mb-1.5">What Works</p>
                        {accountIntel.learnedPatterns.whatWorks.map((w, i) => (
                          <div key={i} className="bg-emerald-900/10 border border-emerald-900/20 rounded-lg p-2 mb-1.5">
                            <p className="text-[10px] text-white font-medium truncate">{w.title}</p>
                            <p className="text-[9px] text-slate-500 capitalize">{w.pattern.replace(/\|/g, ' + ')}</p>
                            <div className="flex gap-2 mt-1">
                              <span className="text-[9px] text-emerald-400 font-semibold">{w.roas}x ROAS</span>
                              <span className="text-[9px] text-blue-400">{w.ctr}% CTR</span>
                              <span className="text-[9px] text-slate-500">${w.cpa} CPA</span>
                              <span className="text-[9px] text-slate-500">{w.purchases} purch</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* What doesn't work */}
                    {accountIntel.learnedPatterns.whatDoesnt.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[9px] text-red-500 uppercase mb-1.5">What Doesn't Work</p>
                        {accountIntel.learnedPatterns.whatDoesnt.map((l, i) => (
                          <div key={i} className="bg-red-900/10 border border-red-900/20 rounded-lg p-2 mb-1.5">
                            <p className="text-[10px] text-slate-400 truncate">{l.title}</p>
                            <p className="text-[9px] text-slate-500 capitalize">{l.pattern.replace(/\|/g, ' + ')}</p>
                            <div className="flex gap-2 mt-1">
                              <span className="text-[9px] text-red-400">{l.roas}x ROAS</span>
                              <span className="text-[9px] text-slate-600">${(l.spendCents / 100).toFixed(0)} wasted</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Pattern win rates */}
                    {accountIntel.learnedPatterns.patternScores.length > 0 && (
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase mb-1.5">Pattern Win Rates</p>
                        {accountIntel.learnedPatterns.patternScores.map((p, i) => (
                          <div key={i} className="flex items-center justify-between mb-1">
                            <span className="text-[9px] text-slate-400 capitalize truncate flex-1 mr-2">{p.creativeType} + {p.funnelStage}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <div className="w-12 bg-slate-800 rounded-full h-1">
                                <div className={`h-1 rounded-full ${p.winRate >= 60 ? 'bg-emerald-500' : p.winRate >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${p.winRate}%` }} />
                              </div>
                              <span className={`text-[9px] font-semibold ${p.winRate >= 60 ? 'text-emerald-400' : p.winRate >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>{p.winRate}%</span>
                              <span className="text-[8px] text-slate-600">{p.wins}W/{p.losses}L</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Strategy Object — shown after generation */}
                {genStrategy && (
                  <div className="bg-slate-900 border border-purple-900/30 rounded-xl p-4">
                    <h3 className="text-[10px] text-purple-400 uppercase font-semibold mb-3">Strategy {viewingHistory ? '(Saved)' : '(Current)'}</h3>
                    <div className="space-y-2.5 text-xs">
                      {/* Overrides — media buyer suggestions */}
                      {genStrategy.overrides?.length > 0 && (
                        <div className="mb-2">
                          {genStrategy.overrides.map((o: any, i: number) => (
                            <div key={i} className="px-3 py-2 bg-amber-900/15 border border-amber-800/40 rounded-lg mb-1.5">
                              <p className="text-[10px] text-amber-400 font-semibold">{o.field}: {o.current} → {o.suggested}</p>
                              <p className="text-[10px] text-amber-400/70 mt-0.5">{o.reason}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div><p className="text-[9px] text-slate-500 uppercase">Angle</p><p className="text-slate-300">{genStrategy.recommendedAngle}</p></div>
                      <div><p className="text-[9px] text-slate-500 uppercase">Hook</p><p className="text-slate-300">{genStrategy.recommendedHook}</p></div>
                      <div><p className="text-[9px] text-slate-500 uppercase">Structure</p><p className="text-slate-300">{genStrategy.recommendedStructure}</p></div>
                      <div><p className="text-[9px] text-slate-500 uppercase">CTA</p><p className="text-slate-300">{genStrategy.recommendedCta}</p></div>
                      <div><p className="text-[9px] text-slate-500 uppercase">Format</p><p className="text-slate-300">{genStrategy.recommendedFormat}</p></div>
                      {/* Confidence */}
                      {genStrategy.confidence > 0 && (
                        <div className="pt-2 border-t border-slate-800">
                          <div className="flex justify-between mb-1">
                            <span className="text-[9px] text-slate-500">Data Confidence</span>
                            <span className="text-[10px] text-purple-400 font-semibold">{genStrategy.confidence}%</span>
                          </div>
                          <div className="w-full bg-slate-800 rounded-full h-1.5"><div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${genStrategy.confidence}%` }} /></div>
                        </div>
                      )}
                      {/* Evidence — "Why This Works" */}
                      {genStrategy.evidence?.length > 0 && (
                        <div className="pt-2 border-t border-slate-800">
                          <p className="text-[9px] text-emerald-500 uppercase mb-2">Why This Works</p>
                          {genStrategy.evidence.map((e: any, i: number) => (
                            <div key={i} className="bg-emerald-900/10 border border-emerald-900/20 rounded-lg p-2 mb-1.5">
                              <div className="flex justify-between items-center mb-0.5">
                                <span className="text-[9px] text-emerald-400 font-semibold">{e.metric}</span>
                                <span className="text-[10px] text-white font-bold">{e.value}</span>
                              </div>
                              <p className="text-[10px] text-slate-400">{e.leader}</p>
                              <p className="text-[10px] text-slate-500">{e.insight}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Reasoning */}
                      {genStrategy.reasons?.length > 0 && (
                        <div className="pt-2 border-t border-slate-800">
                          <p className="text-[9px] text-slate-500 uppercase mb-1">Reasoning</p>
                          {genStrategy.reasons.map((r: string, i: number) => (
                            <p key={i} className="text-[10px] text-slate-400 mb-0.5">• {r}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Generation History */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <h3 className="text-[10px] text-slate-400 uppercase font-semibold mb-3">Past Generations</h3>
                  {genHistoryLoading ? (
                    <div className="text-center py-4"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500 mx-auto" /></div>
                  ) : genHistory.length === 0 ? (
                    <p className="text-[10px] text-slate-600 text-center py-3">No generations yet</p>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {genHistory.map(h => (
                        <button key={h.id} onClick={() => loadHistoryItem(h.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-[10px] transition-colors ${
                            viewingHistory === h.id ? 'bg-purple-900/30 border border-purple-800/50' : 'bg-slate-800/50 hover:bg-slate-800'
                          }`}>
                          <div className="flex justify-between items-center mb-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-white font-medium capitalize">{h.creative_type?.replace('-', ' ')}</span>
                              {h.version > 1 && <span className="px-1 py-0 rounded text-[8px] bg-purple-900/30 text-purple-400">v{h.version}</span>}
                              {h.parent_id && <span className="text-[8px] text-purple-400/60">variation</span>}
                            </div>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] ${h.status === 'completed' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>{h.status}</span>
                          </div>
                          <div className="flex gap-2 text-slate-500">
                            <span>{h.content_type}</span>
                            <span>{h.funnel_stage?.toUpperCase()}</span>
                            <span>×{h.quantity}</span>
                            <span>{new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Winning Ads for Base Selection */}
                {(genConfig.generationGoal === 'use_winner_as_base' || genConfig.generationGoal === 'generate_variations' || genConfig.generationGoal === 'refresh_fatigued_ad') && accountIntel && accountIntel.winners.topCreativesByROAS.length > 0 && (
                  <div className="bg-slate-900 border border-amber-900/30 rounded-xl p-4">
                    <h3 className="text-[10px] text-amber-400 uppercase font-semibold mb-3">Select Base Ad</h3>
                    <div className="space-y-1.5">
                      {accountIntel.winners.topCreativesByROAS.map((c, i) => (
                        <button key={i} onClick={() => setGenConfig(cfg => ({ ...cfg, baseAdId: c.adId }))}
                          className={`w-full text-left flex items-center gap-2 p-2 rounded-lg transition-colors ${
                            genConfig.baseAdId === c.adId ? 'bg-amber-900/20 border border-amber-800/50' : 'bg-slate-800/30 hover:bg-slate-800/50'
                          }`}>
                          <div className="w-8 h-8 rounded bg-slate-800 flex-shrink-0 overflow-hidden">
                            {c.thumbnail ? <img src={c.thumbnail} alt="" className="w-full h-full object-cover" /> : <span className="flex w-full h-full items-center justify-center text-[8px] text-slate-600">#{i+1}</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-white truncate">{c.name}</p>
                            <span className="text-[9px] text-emerald-400">{c.roas}x ROAS</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
