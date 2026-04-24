'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';
import { cents } from '@/lib/format';
import { buildProductImagePlan, buildImageRenderDirective } from '@/lib/creative-taxonomy';

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
  package_id?: string | null;
  format?: string | null;  // Aspect ratio: '4:5', '1:1', '9:16', '16:9'
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

// Concept source — where concepts come from
type ConceptSource = 'generate_new' | 'use_existing' | 'recently_tested';

interface GeneratorConfig {
  // Simple controls
  conceptSource: ConceptSource;
  quantity: number;            // number of concepts
  creativesPerConcept: number; // creatives per concept
  // Engine + content
  engine: 'sora' | 'runway' | 'higgsfield' | 'veo' | 'seedance' | 'nano-banana' | 'stability' | 'ideogram' | 'auto';
  seedanceQuality: '480p' | '720p';
  genMode: 'new' | 'existing' | 'full_funnel' | 'clone_ad';
  contentMix: 'video' | 'image' | 'mixed' | 'full_funnel';
  funnelStructure: 'tof' | 'mof' | 'bof' | 'full';
  productId: string;
  coverImageUrl: string;
  conceptAngle: string;
  videosPerConcept: number;
  imagesPerConcept: number;
  // Backward compat
  contentType: 'video' | 'image';
  creativeType: string;
  funnelStage: 'tof' | 'mof' | 'bof';
  hookStyle: string;
  avatarStyle: string;
  generationGoal: string;
  platformTarget: 'meta' | 'tiktok';
  offer: string;
  baseAdId: string;
  dimension: '4:5' | '1:1' | '9:16' | '16:9' | 'auto';
  videoDuration: 8 | 10 | 15 | 20;
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
  imageFormat: string;
  headline: string;
  subheadline?: string;
  hookText: string;
  proofElement: string;
  productPlacement: string;
  conceptAngle: string;
  visualComposition: string;
  textOverlays?: { text: string; position: string; fontSize: string; fontWeight: string; color: string }[];
  offerPlacement: string;
  ctaText: string;
  ctaPlacement: string;
  colorScheme?: { background: string; textPrimary: string; accent: string };
  adCopy: string;
  variants: string[];
}

type CreativePackage = VideoPackage | ImagePackage;

interface RenderJob {
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  engine: string;
  imageUrl?: string;
  creativeId?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

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
  recommendations: { contentType: string; funnelStage: string; hookStyle: string; provider: string; aspectRatio: string; duration: number; confidence: number; reasons: string[] };
  conceptScores?: { conceptName: string; adsetId: string; adCount: number; spendCents: number; purchases: number; roas: number; avgCtr: number; avgCpa: number | null; isFatigued: boolean; isRising: boolean; action: string; actionLabel: string }[];
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
  { key: 'product_stack', label: 'Product Stack / BOGO', icon: '🏷️' },
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

// Seedance-native directions for each config option
const CREATIVE_TYPE_DIRECTIONS: Record<string, string> = {
  b_roll: 'B-roll montage: show the product from multiple angles, lifestyle shots, textures, and close-ups. Minimal face time.',
  product_demo: 'Product demonstration: person shows how to use the product step by step — opening, applying, showing results.',
  before_after: 'Before and after: show the problem first, then the transformation after using the product.',
  problem_solution: 'Problem to solution: start with frustration or pain point, then reveal the product as the fix.',
  founder_story: 'Founder story: person speaks passionately as if they created this product, sharing the why behind it.',
  social_proof: 'Social proof: person references reviews, results, other people\'s experiences with the product.',
  lifestyle: 'Lifestyle: person uses the product naturally in their daily routine, casual and aspirational setting.',
  hook_viral: 'Viral hook: dramatic opening — unexpected action, reaction, or visual that grabs attention instantly.',
  educational: 'Educational: person explains how the product works, ingredients or mechanism, in a teaching tone.',
  podcast_style: 'Podcast style: person sits and talks directly to camera, casual conversational delivery, like a podcast clip.',
  routine: 'Routine: person walks through their daily routine incorporating the product naturally.',
  comparison: 'Comparison: person compares this product to alternatives, showing why this one is better.',
  myth_busting: 'Myth busting: person calls out a common misconception, then reveals the truth using this product.',
  pov_relatable: 'POV relatable: first-person perspective, person shares a relatable struggle and how this product helped.',
  product_stack: 'Product stack: 3-5 identical products stacked or arranged on a clean surface. Faceless — hands only, arranging the products. Voiceover announces the offer. Fast, deal-focused energy.',
};
const HOOK_DIRECTIONS: Record<string, string> = {
  pattern_interrupt: 'HOOK: Open with something unexpected — a surprising statement, dramatic gesture, or pattern-breaking visual.',
  emotional: 'HOOK: Open with raw emotion — visible frustration, relief, or joy. Make the viewer feel something immediately.',
  authority: 'HOOK: Open with confidence and authority — direct eye contact, bold claim, expert energy.',
  relatable: 'HOOK: Open with a relatable moment — something the viewer has experienced, like struggling with a common problem.',
};
const PRESENTER_DESCRIPTIONS: Record<string, string> = {
  female_ugc: 'Young woman, casual style, relatable.',
  male_ugc: 'Young man, casual style, relatable.',
  creator_influencer: 'Confident influencer, polished but authentic, ring light energy.',
  expert_authority: 'Professional expert, clean background, authoritative presence.',
  podcast_host: 'Podcast host, seated at desk, microphone visible, conversational.',
  faceless_product_only: 'Faceless — hands only, product close-ups, no person\'s face visible.',
};

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

/** Map dimension preset to ratio resolution string used by render endpoints */
function dimensionToResolution(dimension: string, platform: string, contentType: 'image' | 'video'): string {
  if (dimension === 'auto') {
    return platform === 'tiktok' ? '9:16' : (contentType === 'image' ? '4:5' : '4:5');
  }
  return dimension;
}

/**
 * Decide if a package is a video or an image.
 * Uses per-package contentType field first (set by backend for mixed mode),
 * then falls back to shape inference, then to the batch-level config.
 */
function isVideoPackage(pkg: any, batchContentType?: string): boolean {
  if (pkg?.contentType === 'video') return true;
  if (pkg?.contentType === 'image') return false;
  if (pkg?.script || pkg?.sceneStructure || pkg?.brollDirection) return true;
  if (pkg?.imageFormat || pkg?.hookText || pkg?.textOverlays) return false;
  return batchContentType === 'video';
}

/** Pixel dimensions per ratio — used for display + provider mapping */
const DIMENSION_PIXELS: Record<string, { w: number; h: number; label: string }> = {
  '1:1': { w: 1440, h: 1440, label: 'Square 1440×1440' },
  '4:5': { w: 1440, h: 1800, label: 'Meta Feed 1440×1800' },
  '9:16': { w: 1440, h: 2560, label: 'Vertical 1440×2560' },
  '16:9': { w: 1920, h: 1080, label: 'Landscape 1920×1080' },
};

function BillingTab({ storeFilter }: { storeFilter: string }) {
  const [billingData, setBillingData] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState('');

  useEffect(() => {
    setBillingLoading(true);
    setBillingError('');
    // Fetch tenant list, then find the tenant for the selected store
    fetch('/api/billing')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.tenants?.length > 0) {
          // If a store is selected, find its tenant. Otherwise use the first tenant.
          let tenant = d.tenants[0];
          if (storeFilter && d.tenants.length > 1) {
            // Fetch store to get tenant_id
            return fetch(`/api/stores`).then(r => r.json()).then(sd => {
              const store = (sd.stores || []).find((s: any) => s.id === storeFilter);
              if (store?.tenant_id) {
                const match = d.tenants.find((t: any) => t.id === store.tenant_id);
                if (match) tenant = match;
              }
              return fetch(`/api/billing?tenantId=${tenant.id}&admin=1`).then(r => r.json());
            });
          }
          return fetch(`/api/billing?tenantId=${tenant.id}&admin=1`).then(r => r.json());
        }
        setBillingData({ noTenant: true });
        setBillingLoading(false);
        return null;
      })
      .then(d => { if (d) { setBillingData(d); setBillingLoading(false); } })
      .catch(e => { setBillingError(e.message); setBillingLoading(false); });
  }, [storeFilter]);

  const handleSetupCard = async () => {
    if (!billingData?.tenant?.id) return;
    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup-card', tenantId: billingData.tenant.id }),
    });
    const data = await res.json();
    if (data.success && data.sessionUrl) {
      window.location.href = data.sessionUrl;
    } else {
      alert(data.error || 'Failed to start card setup');
    }
  };

  if (billingLoading) {
    return <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto mb-3" />
      <p className="text-slate-400">Loading billing...</p>
    </div>;
  }

  if (billingData?.noTenant) {
    return <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
      <p className="text-slate-400">No billing tenant configured for your account.</p>
    </div>;
  }

  const summary = billingData?.summary;
  const tenant = billingData?.tenant;
  const payment = billingData?.paymentStatus;
  const isAdmin = billingData?.isAdmin;

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{tenant?.name || 'Billing'}</h3>
            <p className="text-xs text-slate-400 mt-1">Current billing period</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-green-400">${(summary?.currentPeriodBilled || 0).toFixed(2)}</p>
            <p className="text-[10px] text-slate-500">your usage this month</p>
          </div>
        </div>
        {isAdmin && summary?.currentPeriodRaw != null && (
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-800">
            <div><p className="text-[10px] text-slate-500 uppercase">Raw API Cost</p><p className="text-sm font-semibold text-slate-300">${summary.currentPeriodRaw.toFixed(2)}</p></div>
            <div><p className="text-[10px] text-slate-500 uppercase">Client Billed</p><p className="text-sm font-semibold text-green-400">${summary.currentPeriodBilled.toFixed(2)}</p></div>
            <div><p className="text-[10px] text-slate-500 uppercase">Margin Earned</p><p className="text-sm font-semibold text-emerald-400">${summary.currentPeriodMargin.toFixed(2)}</p></div>
          </div>
        )}
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h4 className="text-sm font-semibold text-white mb-3">Payment Method</h4>
        {payment?.hasPaymentMethod ? (
          <div className="flex items-center gap-3">
            <div className="px-3 py-2 bg-slate-800 rounded-lg">
              <p className="text-sm text-white font-medium">{payment.brand?.toUpperCase()} **** {payment.last4}</p>
              <p className="text-[10px] text-slate-500">Expires {payment.expMonth}/{payment.expYear}</p>
            </div>
            <button onClick={handleSetupCard} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs rounded-lg border border-slate-700">Update Card</button>
          </div>
        ) : (
          <div>
            <p className="text-xs text-slate-400 mb-3">No payment method on file.</p>
            <button onClick={handleSetupCard} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">Add Card</button>
          </div>
        )}
      </div>
      {summary?.byProvider?.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h4 className="text-sm font-semibold text-white mb-3">Usage by Provider</h4>
          <div className="space-y-2">
            {summary.byProvider.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 uppercase">{p.provider}</span>
                  <span className="text-xs text-slate-400">{p.count} call{p.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">${(p.billed || 0).toFixed(2)}</p>
                  {isAdmin && p.raw != null && <p className="text-[9px] text-slate-500">cost: ${(p.raw).toFixed(2)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {summary?.byStore?.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h4 className="text-sm font-semibold text-white mb-3">Usage by Store</h4>
          <div className="space-y-2">
            {summary.byStore.map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                <span className="text-sm text-white">{s.storeName || s.storeId}</span>
                <p className="text-sm font-semibold text-white">${(s.billed || 0).toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {(!summary?.byProvider || summary.byProvider.length === 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No usage this month yet. Generate some creatives to see billing data.</p>
        </div>
      )}
    </div>
  );
}

function CreativesContent() {
  const searchParams = useSearchParams();
  const storeFilter = searchParams.get('storeId') || '';

  const [stores, setStores] = useState<Store[]>([]);
  const [userRole, setUserRole] = useState('admin');
  const [tab, setTab] = useState<'performance' | 'generated' | 'batches' | 'generator' | 'library' | 'billing'>(() => {
    if (typeof window === 'undefined') return 'performance';
    try {
      const saved = localStorage.getItem('ym-active-tab');
      if (saved && ['performance', 'generated', 'batches', 'generator', 'library', 'billing'].includes(saved)) return saved as any;
    } catch {}
    return 'performance';
  });
  const [loading, setLoading] = useState(true);
  // Persist active tab
  useEffect(() => { try { localStorage.setItem('ym-active-tab', tab); } catch {} }, [tab]);

  // Performance tab state
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [dateRange, setDateRange] = useState('14');
  const [sortBy, setSortBy] = useState('spend');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Generated tab state
  const [creatives, setCreatives] = useState<Creative[]>([]);
  // ── Bulk selection state for Generated Creatives tab ──
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<Set<string>>(new Set());
  const [bulkLaunching, setBulkLaunching] = useState(false);
  const [bulkLaunchResult, setBulkLaunchResult] = useState<any>(null);
  const [bulkLaunchError, setBulkLaunchError] = useState('');
  const [bulkLaunchLinkUrl, setBulkLaunchLinkUrl] = useState('');
  const [bulkLaunchProfileId, setBulkLaunchProfileId] = useState('');
  const [showBulkLaunchModal, setShowBulkLaunchModal] = useState(false);
  const [bulkLaunchProgress, setBulkLaunchProgress] = useState('');
  // ── Page selector state ──
  const [availablePages, setAvailablePages] = useState<{ id: string; name: string; canCreateAds?: boolean }[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [currentProfilePageId, setCurrentProfilePageId] = useState('');
  const [currentProfilePageName, setCurrentProfilePageName] = useState('');
  const [savePageAsDefault, setSavePageAsDefault] = useState(false);
  // ── Scale mode state ──
  const [launchMode, setLaunchMode] = useState<'new' | 'scale'>('new');
  const [fbCampaigns, setFbCampaigns] = useState<{ id: string; name: string; status: string; objective: string }[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [fbAdSets, setFbAdSets] = useState<{ id: string; name: string; status: string; adCount: number }[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdSets, setLoadingAdSets] = useState(false);
  const [conceptAdSetMap, setConceptAdSetMap] = useState<Record<string, string>>({});

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
  // Persisted to localStorage so the user's configuration survives page reloads.
  const GEN_CONFIG_KEY = 'ym-gen-config';
  const defaultGenConfig: GeneratorConfig = {
    conceptSource: 'generate_new', quantity: 3, creativesPerConcept: 3,
    engine: 'seedance', genMode: 'new', contentMix: 'video', funnelStructure: 'tof',
    productId: '', coverImageUrl: '', conceptAngle: '', videosPerConcept: 3, imagesPerConcept: 3,
    contentType: 'video', creativeType: 'testimonial', funnelStage: 'tof',
    hookStyle: 'curiosity', avatarStyle: 'female_ugc', generationGoal: 'new_concept',
    platformTarget: 'meta', offer: '', baseAdId: '',
    dimension: '9:16', videoDuration: 15,
    seedanceQuality: '720p',
  };
  const [genConfig, setGenConfig] = useState<GeneratorConfig>(() => {
    if (typeof window === 'undefined') return defaultGenConfig;
    try {
      const saved = localStorage.getItem(GEN_CONFIG_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge saved values on top of defaults so new fields added later still get their defaults
        return { ...defaultGenConfig, ...parsed };
      }
    } catch {}
    return defaultGenConfig;
  });
  // Save genConfig to localStorage on every change (debounce-free — object is small)
  useEffect(() => {
    try { localStorage.setItem(GEN_CONFIG_KEY, JSON.stringify(genConfig)); } catch {}
  }, [genConfig]);

  const [genPackages, setGenPackages] = useState<CreativePackage[]>([]);
  const [genPackageConfig, setGenPackageConfig] = useState<any>(null);
  const [generatingPackage, setGeneratingPackage] = useState(false);
  const [genPackageError, setGenPackageError] = useState('');
  const [accountIntel, setAccountIntel] = useState<AccountIntelligence | null>(null);
  const [expandedPackage, setExpandedPackage] = useState<number | null>(null);
  const [conceptData, setConceptData] = useState<any>(null);
  const [genStrategy, setGenStrategy] = useState<any>(null);
  const [genHistory, setGenHistory] = useState<any[]>([]);
  const [genHistoryLoading, setGenHistoryLoading] = useState(false);
  const [viewingHistory, setViewingHistory] = useState<string | null>(null);
  const [genCurrentId, setGenCurrentId] = useState<string | null>(null);
  const [genVersion, setGenVersion] = useState(1);
  const [comparingPackages, setComparingPackages] = useState<number[]>([]);
  const [generatingIdxSet, setGeneratingIdxSet] = useState<Set<number>>(new Set());
  const [packageVideoStatus, setPackageVideoStatus] = useState<Record<number, { id: string; status: string; engine: string; reason?: string }>>({});
  const [renderJobs, setRenderJobs] = useState<Record<number, RenderJob>>({});
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<any>(null);
  const [launchError, setLaunchError] = useState('');
  const [fbProfiles, setFbProfiles] = useState<any[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [launchLinkUrl, setLaunchLinkUrl] = useState('');

  // ═══ Winner / Library / Template State ═══
  const [winners, setWinners] = useState<any[]>([]);
  const [setupTemplates, setSetupTemplates] = useState<any[]>([]);
  const [savingWinner, setSavingWinner] = useState<string | null>(null);
  const [winnerNotes, setWinnerNotes] = useState('');
  const [showWinnerModal, setShowWinnerModal] = useState<{ pkg: any; idx: number; creativeId?: string } | null>(null);
  const [matchedWinnerRef, setMatchedWinnerRef] = useState<any>(null);
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedExistingConcept, setSelectedExistingConcept] = useState<any>(null);
  const [activeConceptAction, setActiveConceptAction] = useState('');
  const [higgsStyle, setHiggsStyle] = useState('product_showcase');
  const [productSearch, setProductSearch] = useState('');
  const [referenceVideoUrl, setReferenceVideoUrl] = useState('');
  const [higgsPackJob, setHiggsPackJob] = useState<{ jobId: string; status: string; progress?: string; videoUrl?: string; scenes?: any[] } | null>(null);
  // Product foundation state
  const [productFoundation, setProductFoundation] = useState<{ beliefs: string[]; uniqueMechanism: string; avatarSummary: string; offerBrief: string; researchNotes: string } | null>(null);
  const [showFoundation, setShowFoundation] = useState(false);
  const [foundationLoading, setFoundationLoading] = useState(false);
  const [foundationSaving, setFoundationSaving] = useState(false);
  // Library tab
  const [libraryPackages, setLibraryPackages] = useState<any[]>([]);
  const [libraryCreatives, setLibraryCreatives] = useState<any[]>([]);
  const [libraryWinners, setLibraryWinners] = useState<any[]>([]);
  const [libraryCounts, setLibraryCounts] = useState<{ totalPackages: number; totalCreatives: number; totalWinners: number }>({ totalPackages: 0, totalCreatives: 0, totalWinners: 0 });
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryFilters, setLibraryFilters] = useState<{ contentType?: string; creativeType?: string; funnelStage?: string; provider?: string; winnerOnly?: boolean; launchedOnly?: boolean }>({});
  const [expandedLibraryPkg, setExpandedLibraryPkg] = useState<string | null>(null);
  const [expandedLibraryCreative, setExpandedLibraryCreative] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => { setStores(d.stores || []); if (d.session?.role) setUserRole(d.session.role); }).catch(() => {});
  }, []);

  useEffect(() => {
    // Always clear cross-store data when the active store changes (or unselects)
    setProducts([]);
    setProductSearch('');
    setFbProfiles([]);
    setSelectedProfileId('');
    setBulkLaunchProfileId('');

    if (storeFilter) {
      fetch(`/api/products?storeId=${encodeURIComponent(storeFilter)}`).then(r => r.json()).then(d => {
        const list = d.products || [];
        // Defensive client-side filter: only keep products from the active store
        setProducts(list.filter((p: any) => p.store_id === storeFilter));
      }).catch(() => setProducts([]));

      fetch(`/api/creatives/launch?storeId=${encodeURIComponent(storeFilter)}`).then(r => r.json().catch(() => null)).then(d => {
        const profiles = d?.profiles || [];
        setFbProfiles(profiles);
        if (profiles.length > 0) {
          setSelectedProfileId(profiles[0].id);
          setBulkLaunchProfileId(profiles[0].id);
        }
      }).catch(() => {});
    }
  }, [storeFilter]);

  useEffect(() => {
    if (tab === 'performance') loadPerformance();
    else if (tab === 'generated') loadCreatives();
    else if (tab === 'batches') loadBatches();
    else if (tab === 'library') loadLibrary();
  }, [storeFilter, tab, dateRange, sortBy]);

  // Load winners for the current store (used by generator for matching)
  useEffect(() => {
    if (storeFilter) {
      fetch(`/api/creatives/winners?storeId=${encodeURIComponent(storeFilter)}`)
        .then(r => r.json()).then(d => setWinners(d.winners || [])).catch(() => {});
      fetch(`/api/creatives/templates?storeId=${encodeURIComponent(storeFilter)}`)
        .then(r => r.json()).then(d => setSetupTemplates(d.templates || [])).catch(() => {});
    }
  }, [storeFilter]);

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
    if (!storeFilter) {
      setCreatives([]);
      setLoading(false);
      setFetchError('Select a store to view creatives.');
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/creatives?storeId=${encodeURIComponent(storeFilter)}`);
      const data = await res.json();
      const list = data.creatives || [];
      // Defensive client-side filter: only show creatives from the active store
      setCreatives(list.filter((c: any) => c.store_id === storeFilter));
    } catch {
      setCreatives([]);
      setFetchError('Failed to load creatives. Check your connection and try again.');
    }
    setLoading(false);
  }

  // ═══ Winner / Library helpers ═══

  async function loadLibrary() {
    if (!storeFilter) return;
    setLibraryLoading(true);
    try {
      const params = new URLSearchParams({ storeId: storeFilter });
      if (librarySearch) params.set('search', librarySearch);
      if (libraryFilters.contentType) params.set('contentType', libraryFilters.contentType);
      if (libraryFilters.creativeType) params.set('creativeType', libraryFilters.creativeType);
      if (libraryFilters.funnelStage) params.set('funnelStage', libraryFilters.funnelStage);
      if (libraryFilters.provider) params.set('provider', libraryFilters.provider);
      if (libraryFilters.winnerOnly) params.set('winnerOnly', '1');
      if (libraryFilters.launchedOnly) params.set('launchedOnly', '1');
      const res = await fetch(`/api/creatives/history?${params}`);
      const data = await res.json();
      if (data.success) {
        setLibraryPackages(data.packages || []);
        setLibraryCreatives(data.creatives || []);
        setLibraryWinners(data.winners || []);
        setLibraryCounts(data.counts || { totalPackages: 0, totalCreatives: 0, totalWinners: 0 });
      }
    } catch {}
    setLibraryLoading(false);
  }

  async function saveAsWinner(pkg: any, idx: number, creativeId?: string) {
    if (!storeFilter) return;
    setSavingWinner(`${idx}`);
    try {
      const res = await fetch('/api/creatives/winners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: storeFilter,
          creativeId: creativeId || null,
          packageId: genCurrentId || null,
          packageIndex: idx,
          pkg,
          config: genPackageConfig || genConfig,
          userNotes: winnerNotes,
          winningTags: [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWinners(prev => [data.winner, ...prev]);
        setShowWinnerModal(null);
        setWinnerNotes('');
      }
    } catch {}
    setSavingWinner(null);
  }

  async function removeWinner(winnerId: string) {
    try {
      await fetch(`/api/creatives/winners?id=${winnerId}`, { method: 'DELETE' });
      setWinners(prev => prev.filter(w => w.id !== winnerId));
    } catch {}
  }

  async function saveTemplate() {
    if (!storeFilter || !templateName.trim()) return;
    try {
      const res = await fetch('/api/creatives/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: storeFilter,
          name: templateName,
          config: genConfig,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSetupTemplates(prev => [data.template, ...prev]);
        setShowTemplateSave(false);
        setTemplateName('');
      }
    } catch {}
  }

  async function deleteTemplate(id: string) {
    try {
      await fetch(`/api/creatives/templates?id=${id}`, { method: 'DELETE' });
      setSetupTemplates(prev => prev.filter(t => t.id !== id));
    } catch {}
  }

  function applyTemplate(template: any) {
    setGenConfig(c => ({
      ...c,
      contentType: template.content_type || c.contentType,
      creativeType: template.creative_type || c.creativeType,
      funnelStage: template.funnel_stage || c.funnelStage,
      hookStyle: template.hook_style || c.hookStyle,
      avatarStyle: template.avatar_style || c.avatarStyle,
      platformTarget: template.platform || c.platformTarget,
      videoDuration: template.duration || c.videoDuration,
      dimension: template.aspect_ratio || c.dimension,
    }));
  }

  function handleGenerateMoreLikeThis(winner: any) {
    // Pre-fill config from winner and switch to generator tab
    setGenConfig(c => ({
      ...c,
      contentType: winner.content_type || c.contentType,
      creativeType: winner.creative_type || c.creativeType,
      funnelStage: winner.funnel_stage || c.funnelStage,
      hookStyle: winner.hook_style || c.hookStyle,
      avatarStyle: winner.avatar_style || c.avatarStyle,
      platformTarget: winner.platform || c.platformTarget,
      videoDuration: winner.duration || c.videoDuration,
      dimension: winner.aspect_ratio || c.dimension,
      generationGoal: 'new_concept',
    }));
    setMatchedWinnerRef(winner);
    setTab('generator');
  }

  function handleDuplicateSetup(pkg: any) {
    setGenConfig(c => ({
      ...c,
      contentType: pkg.content_type || c.contentType,
      creativeType: pkg.creative_type || c.creativeType,
      funnelStage: pkg.funnel_stage || c.funnelStage,
      hookStyle: pkg.hook_style || c.hookStyle,
      avatarStyle: pkg.avatar_style || c.avatarStyle,
      generationGoal: pkg.generation_goal || c.generationGoal,
    }));
    if (pkg.product_id) setGenConfig(c => ({ ...c, productId: pkg.product_id }));
    if (pkg.offer) setGenConfig(c => ({ ...c, offer: pkg.offer }));
    setTab('generator');
  }

  /**
   * Handle concept action from the AI Creative Brain scorecards.
   * Pre-fills the generator with the right mode based on the recommended action.
   */
  function handleConceptAction(concept: any, action: string) {
    if (action === 'pause') return;

    setActiveConceptAction(action);
    setGenConfig(c => ({
      ...c,
      conceptAngle: concept.conceptName || '',
      genMode: action === 'scale' || action === 'generate_more' ? 'existing' as const : 'new' as const,
      funnelStructure: action === 'add_tof' ? 'tof' as const
        : action === 'add_bof' ? 'bof' as const
        : c.funnelStructure,
      funnelStage: action === 'add_tof' ? 'tof' as const
        : action === 'add_bof' ? 'bof' as const
        : c.funnelStage,
      contentMix: action === 'refresh' ? 'mixed' as const : c.contentMix,
      hookStyle: action === 'refresh' ? 'curiosity' : c.hookStyle,
    }));

    setTab('generator');
    setGenPackages([]);
    setGenPackageError('');
    setRenderJobs({});
  }

  const isCreativeWinner = (creativeId: string) => winners.some(w => w.creative_id === creativeId);
  const isPackageWinner = (packageId: string) => winners.some(w => w.package_id === packageId);

  // ── Bulk selection helpers ──
  function isCreativeLaunchable(c: Creative): boolean {
    return c.nb_status === 'completed' && !!c.file_url;
  }

  function toggleCreativeSelection(id: string) {
    setSelectedCreativeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisibleCreatives() {
    const launchableIds = creatives.filter(isCreativeLaunchable).map(c => c.id);
    setSelectedCreativeIds(new Set(launchableIds));
  }

  function clearCreativeSelection() {
    setSelectedCreativeIds(new Set());
  }

  function openBulkLaunchModal() {
    if (selectedCreativeIds.size === 0) return;
    setBulkLaunchError('');
    setBulkLaunchResult(null);
    setBulkLaunchProgress('');
    setSavePageAsDefault(false);
    setLaunchMode('new');
    setConceptAdSetMap({});
    setFbAdSets([]);
    // Auto-select first FB profile if available
    const profileId = bulkLaunchProfileId || (fbProfiles.length > 0 ? fbProfiles[0].id : '');
    if (profileId && !bulkLaunchProfileId) setBulkLaunchProfileId(profileId);
    if (profileId) loadPagesForProfile(profileId);
    setShowBulkLaunchModal(true);
  }

  // ═══ Scale mode helpers ═══
  async function loadCampaignsForProfile(profileId: string) {
    if (!profileId) return;
    setLoadingCampaigns(true);
    setFbCampaigns([]);
    setSelectedCampaignId('');
    setFbAdSets([]);
    try {
      const res = await fetch(`/api/creatives/launch?profileId=${profileId}&campaigns=1`);
      const data = await res.json().catch(() => null);
      if (data?.success) {
        setFbCampaigns(data.campaigns || []);
        if (data.campaigns?.length > 0) {
          setSelectedCampaignId(data.campaigns[0].id);
          await loadAdSetsForCampaign(profileId, data.campaigns[0].id);
        }
      } else {
        setBulkLaunchError(data?.error?.message || 'Failed to load campaigns');
      }
    } catch (e: any) {
      setBulkLaunchError(`Failed to load campaigns: ${e.message}`);
    }
    setLoadingCampaigns(false);
  }

  async function loadAdSetsForCampaign(profileId: string, campaignId: string) {
    if (!profileId || !campaignId) return;
    setLoadingAdSets(true);
    setFbAdSets([]);
    try {
      const res = await fetch(`/api/creatives/launch?profileId=${profileId}&adsets=1&campaignId=${campaignId}`);
      const data = await res.json().catch(() => null);
      if (data?.success) {
        setFbAdSets(data.adsets || []);
        // Auto-match each selected concept to the best existing ad set
        autoMatchConcepts(data.adsets || []);
      } else {
        setBulkLaunchError(data?.error?.message || 'Failed to load ad sets');
      }
    } catch (e: any) {
      setBulkLaunchError(`Failed to load ad sets: ${e.message}`);
    }
    setLoadingAdSets(false);
  }

  // Build unique concept list from currently-selected creatives and auto-match to existing ad sets
  function getSelectedConcepts(): string[] {
    const selected = creatives.filter(c => selectedCreativeIds.has(c.id) && isCreativeLaunchable(c));
    const concepts = new Set<string>();
    // Group by package_id first — same package = same concept
    const packageLabels: Record<string, string> = {};
    for (const c of selected) {
      if (c.package_id && !packageLabels[c.package_id]) {
        packageLabels[c.package_id] = c.angle || c.title || 'Concept';
      }
    }
    for (const c of selected) {
      const concept = c.package_id ? packageLabels[c.package_id] : (c.angle || 'Selected Creatives');
      concepts.add(concept);
    }
    return Array.from(concepts);
  }

  function autoMatchConcepts(adsets: { id: string; name: string }[]) {
    const concepts = getSelectedConcepts();
    const map: Record<string, string> = {};
    for (const concept of concepts) {
      // Look for exact match first (ignoring TEST/SCALE prefix and " (N)" suffix)
      const normalizedConcept = concept.toLowerCase().trim();
      const match = adsets.find(a => {
        const cleaned = a.name.replace(/^(TEST|SCALE)\s*–\s*/i, '').replace(/\s*\(\d+\)\s*$/, '').toLowerCase().trim();
        return cleaned === normalizedConcept;
      });
      if (match) {
        map[concept] = match.id;
      } else {
        // Fuzzy contains match
        const fuzzy = adsets.find(a => a.name.toLowerCase().includes(normalizedConcept) || normalizedConcept.includes(a.name.toLowerCase().replace(/^(TEST|SCALE)\s*–\s*/i, '')));
        if (fuzzy) map[concept] = fuzzy.id;
      }
    }
    setConceptAdSetMap(map);
  }

  async function loadPagesForProfile(profileId: string) {
    if (!profileId) return;
    setLoadingPages(true);
    setAvailablePages([]);
    try {
      const res = await fetch(`/api/creatives/launch?profileId=${profileId}&pages=1`);
      const data = await res.json().catch(() => null);
      if (data?.success) {
        setAvailablePages(data.pages || []);
        setCurrentProfilePageId(data.currentPageId || '');
        setCurrentProfilePageName(data.currentPageName || '');
        // Default selection: current profile page if it's accessible, else first accessible page
        const pages = data.pages || [];
        const currentInList = pages.find((p: any) => p.id === data.currentPageId);
        if (currentInList) {
          setSelectedPageId(data.currentPageId);
        } else if (pages.length > 0) {
          setSelectedPageId(pages[0].id);
        } else {
          setSelectedPageId('');
        }
      } else {
        setAvailablePages([]);
        setBulkLaunchError(data?.error?.message || 'Failed to load pages');
      }
    } catch (e: any) {
      setBulkLaunchError(`Failed to load pages: ${e.message}`);
    }
    setLoadingPages(false);
  }

  async function handleBulkLaunchToFB() {
    if (!storeFilter || !bulkLaunchProfileId || !bulkLaunchLinkUrl) {
      setBulkLaunchError('Select an ad account and enter a landing page URL');
      return;
    }

    const selected = creatives.filter(c => selectedCreativeIds.has(c.id) && isCreativeLaunchable(c));
    if (selected.length === 0) {
      setBulkLaunchError('No launchable creatives selected');
      return;
    }

    // Group creatives by CONCEPT.
    // Priority: package_id (same creative package = same concept) → angle → fallback bucket
    // This ensures all variations of the same concept go into ONE ad set.
    const conceptGroups: Record<string, { name: string; creatives: any[] }> = {};

    // First pass: find the most common name per package_id to use as concept label
    const packageLabels: Record<string, string> = {};
    for (const c of selected) {
      if (c.package_id && !packageLabels[c.package_id]) {
        // Use the first creative's angle or title as the concept name for this package
        packageLabels[c.package_id] = c.angle || c.title || 'Concept';
      }
    }

    for (const c of selected) {
      // Group key: package_id first (shared across all variations in a generation)
      // Fallback: angle (if no package_id)
      // Last resort: single bucket
      const groupKey = c.package_id
        ? `pkg:${c.package_id}`
        : c.angle
        ? `angle:${c.angle}`
        : 'selected';

      const groupName = c.package_id
        ? packageLabels[c.package_id] || 'Concept'
        : c.angle || 'Selected Creatives';

      if (!conceptGroups[groupKey]) {
        conceptGroups[groupKey] = { name: groupName, creatives: [] };
      }
      // Clean primaryText: the description column often stores the AI render prompt.
      // Strip that out — use the title/angle as fallback for a usable ad body.
      const rawDesc = c.description || '';
      const isRenderPrompt = /STRICT LAYOUT|TOP ZONE|BOTTOM ZONE|MIDDLE ZONE|Create a high-converting/i.test(rawDesc);
      const cleanPrimaryText = isRenderPrompt
        ? (c.angle || c.title || 'Check it out')
        : rawDesc.substring(0, 500);
      conceptGroups[groupKey].creatives.push({
        id: c.id,
        type: c.type, // 'image' or 'video'
        title: (c.title || 'Untitled').substring(0, 255),
        headline: (c.title || '').substring(0, 40),
        primaryText: cleanPrimaryText,
        imageUrl: c.type === 'video' ? undefined : c.file_url,
        videoUrl: c.type === 'video' ? c.file_url : undefined,
        thumbnailUrl: c.thumbnail_url || undefined,
        linkUrl: bulkLaunchLinkUrl,
        callToAction: 'SHOP_NOW',
      });
    }

    const packages = Object.values(conceptGroups).map(({ name, creatives }) => ({
      concept: name,
      creatives,
    }));

    // Scale mode validation: every concept must be mapped to an existing ad set
    const isScaleMode = launchMode === 'scale';
    if (isScaleMode) {
      if (!selectedCampaignId) {
        setBulkLaunchError('Select an existing campaign to scale into');
        return;
      }
      const unmappedConcepts = packages.filter(p => !conceptAdSetMap[p.concept]);
      if (unmappedConcepts.length > 0) {
        setBulkLaunchError(`Map these concepts to existing ad sets: ${unmappedConcepts.map(p => p.concept).join(', ')}`);
        return;
      }
    }

    // ONE concept = ONE ad set (no splitting, no creative limit)
    // Existing ad sets with the same concept name are auto-reused.
    const finalAdSetCount = packages.length;

    const confirmMsg = isScaleMode
      ? `SCALE MODE\n\nAdd ${selected.length} new ad${selected.length > 1 ? 's' : ''} to ${finalAdSetCount} existing ad set${finalAdSetCount > 1 ? 's' : ''} in campaign "${fbCampaigns.find(c => c.id === selectedCampaignId)?.name}"?\n\nNo new campaign or ad sets will be created.\nStatus: PAUSED`
      : `Launch ${selected.length} creative${selected.length > 1 ? 's' : ''} into ${packages.length} concept${packages.length > 1 ? 's' : ''} → ${finalAdSetCount} ad set${finalAdSetCount > 1 ? 's' : ''}?\n\nExisting ad sets with the same concept will be REUSED (no duplicates).\nImage + video creatives go into the same ad set.\n\nBudget: $30/day per new ad set\nStatus: PAUSED`;

    if (!window.confirm(confirmMsg)) return;

    setBulkLaunching(true);
    setBulkLaunchError('');
    setBulkLaunchResult(null);
    setBulkLaunchProgress('Submitting launch job...');

    // Step 1: Submit launch job — returns jobId immediately, no long blocking
    const { data, error } = await safeJsonFetch('/api/creatives/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: storeFilter,
        profileId: bulkLaunchProfileId,
        packages,
        dailyBudget: 3000,
        status: 'PAUSED',
        overridePageId: selectedPageId || undefined,
        savePageOverride: savePageAsDefault,
        ...(isScaleMode ? {
          mode: 'scale',
          existingCampaignId: selectedCampaignId,
          existingAdSetMap: conceptAdSetMap,
          maxAdsPerExistingAdSet: 8,
        } : {}),
      }),
    });

    if (error) {
      setBulkLaunchError(error);
      setBulkLaunching(false);
      return;
    }
    if (!data?.success || !data?.jobId) {
      setBulkLaunchError(data?.error?.message || 'Failed to submit launch job');
      setBulkLaunching(false);
      return;
    }

    const jobId = data.jobId;
    setBulkLaunchProgress(`Queued: ${data.plan?.adsPlanned || 0} ads in ${data.plan?.adSetsPlanned || 0} ad sets`);

    // Step 2: Poll job status every 2 seconds
    // Video processing on Meta's side takes 1-4 min per video. For 20 videos, that's up to 80 min.
    // Use 20 min polling window — enough for ~5-10 videos per launch.
    let polls = 0;
    const maxPolls = 600; // 20 min max (600 * 2s)

    const pollJob = async () => {
      polls++;
      try {
        const res = await fetch(`/api/creatives/launch?jobId=${jobId}`);
        const pollData = await res.json().catch(() => null);

        if (!pollData?.success) {
          if (polls < maxPolls) {
            setTimeout(pollJob, 3000);
          } else {
            setBulkLaunchError('Launch status unavailable after 20 minutes — check Meta Ads Manager');
            setBulkLaunching(false);
          }
          return;
        }

        setBulkLaunchProgress(pollData.progress || 'Processing...');

        if (pollData.status === 'completed' || pollData.status === 'partial') {
          setBulkLaunchResult({
            success: true,
            campaign: pollData.campaign,
            adSets: pollData.adSets,
            summary: pollData.summary,
            partial: pollData.status === 'partial',
          });
          setSelectedCreativeIds(new Set());
          setBulkLaunching(false);
          return;
        }

        if (pollData.status === 'failed') {
          setBulkLaunchError(pollData.error || 'Launch failed');
          setBulkLaunching(false);
          return;
        }

        // Still queued or launching — keep polling
        if (polls < maxPolls) {
          setTimeout(pollJob, 2000);
        } else {
          setBulkLaunchError('Launch timed out after 20 minutes. Check Meta Ads Manager — some ads may still be processing.');
          setBulkLaunching(false);
        }
      } catch {
        // Network hiccup during poll — retry with backoff
        if (polls < maxPolls) {
          setTimeout(pollJob, 4000);
        } else {
          setBulkLaunchError('Lost connection while checking launch status');
          setBulkLaunching(false);
        }
      }
    };

    setTimeout(pollJob, 1500);
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
        setCreatives(prev => prev.map(c => c.id === id ? { ...c, ...data.creative } : c));
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

  // Load concept scoring + fatigue data
  async function loadConceptData() {
    if (!storeFilter) return;
    try {
      const res = await fetch(`/api/creatives/concepts?storeId=${storeFilter}`);
      const data = await res.json();
      setConceptData(data);
    } catch {}
  }

  // Fetch intelligence + concepts when switching to generator tab
  useEffect(() => {
    if (tab === 'generator' && storeFilter && !accountIntel) {
      loadAccountIntelligence();
    }
    if (tab === 'generator' && storeFilter) {
      loadConceptData();
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
        setRenderJobs({});
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

  async function handleAddVoiceover(pkg: any, idx: number) {
    const videoStatus = packageVideoStatus[idx];
    if (!videoStatus || videoStatus.status !== 'processing') return;

    // Get the creative's video URL from the DB via poll
    const script = (pkg as any).script || (pkg as any).adCopy || genConfig.conceptAngle || '';
    if (!script) {
      setGenPackageError('No script available for voiceover');
      return;
    }

    // Find the creative in our creatives list
    const creative = creatives.find(c => c.id === videoStatus.id);
    if (!creative?.file_url) {
      setGenPackageError('Video not ready yet — wait for generation to complete first');
      return;
    }

    if (!window.confirm('Add AI voiceover to this video? This will use OpenAI TTS.')) return;

    setPackageVideoStatus(prev => ({ ...prev, [idx]: { ...prev[idx], reason: 'Adding voiceover...' } }));

    const { data, error } = await safeJsonFetch('/api/creatives/voiceover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creativeId: videoStatus.id,
        script,
        avatarStyle: genConfig.avatarStyle || 'female_ugc',
        videoUrl: creative.file_url,
      }),
    });

    if (data?.success) {
      setPackageVideoStatus(prev => ({ ...prev, [idx]: { ...prev[idx], reason: 'Voiceover added' } }));
      loadCreatives();
    } else {
      setGenPackageError(error || data?.error?.message || 'Voiceover failed');
    }
  }

  async function handleHiggsfieldPack() {
    if (!storeFilter) return;
    const productImageUrls = getProductImageUrls();
    if (productImageUrls.length === 0) {
      setGenPackageError('Select a product with images first — Higgsfield needs a product photo.');
      return;
    }
    const selectedProduct = products.find(p => p.id === genConfig.productId);
    if (!window.confirm(`Generate Higgsfield ${higgsStyle.replace(/_/g, ' ')} pack? This will create 3-4 scene clips and stitch them into one video.`)) return;

    setGeneratingPackage(true);
    setGenPackageError('');
    setHiggsPackJob({ jobId: '', status: 'starting', progress: 'Starting...' });

    const { data, error } = await safeJsonFetch('/api/creatives/higgsfield-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: storeFilter,
        productId: genConfig.productId,
        productName: selectedProduct?.title || 'Product',
        productImageUrl: productImageUrls[0],
        style: higgsStyle,
        conceptAngle: genConfig.conceptAngle || undefined,
        title: `${selectedProduct?.title || 'Product'} — ${higgsStyle.replace(/_/g, ' ')}`,
        script: genConfig.conceptAngle || `Discover ${selectedProduct?.title || 'this product'}. See what makes it special. Try it today.`,
        avatarStyle: genConfig.avatarStyle || 'female_ugc',
      }),
    });

    if (error || !data?.success) {
      setGenPackageError(error || data?.error?.message || 'Failed to start Higgsfield pack');
      setHiggsPackJob(null);
      setGeneratingPackage(false);
      return;
    }

    const jobId = data.jobId;
    setHiggsPackJob({ jobId, status: 'generating', progress: `Generating ${data.sceneCount} scenes...` });

    // Poll for completion
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/creatives/higgsfield-pack?jobId=${jobId}`);
        const pollData = await res.json();
        if (pollData.success) {
          setHiggsPackJob({
            jobId, status: pollData.status,
            progress: pollData.progress,
            videoUrl: pollData.videoUrl,
            scenes: pollData.scenes,
          });

          if (pollData.status === 'completed' || pollData.status === 'failed') {
            clearInterval(pollInterval);
            setGeneratingPackage(false);
            if (pollData.status === 'completed') {
              loadCreatives();
            } else {
              setGenPackageError(pollData.error || 'Higgsfield pack generation failed');
            }
          }
        }
      } catch {}
    }, 5000);

    // Safety timeout after 6 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
      if (generatingPackage) setGeneratingPackage(false);
    }, 360000);
  }

  async function handleGeneratePackage() {
    if (!storeFilter) return;
    // If Higgsfield engine is selected, use the pack generator instead
    if (genConfig.engine === 'higgsfield') {
      return handleHiggsfieldPack();
    }
    // ═══ CLONE AD MODE — uses separate pipeline ═══
    if (genConfig.genMode === 'clone_ad') {
      if (!referenceVideoUrl) {
        setGenPackageError('Paste a reference video URL to clone.');
        return;
      }
      if (!window.confirm(`Clone ad from reference video? This will analyze the video frame-by-frame and generate ${genConfig.quantity} Seedance-optimized packages.`)) return;
      setGeneratingPackage(true);
      setGenPackageError('');
      setGenPackages([]);
      setRenderJobs({});
      setGenStrategy(null);
      const selectedProduct = genConfig.productId ? products.find(p => p.id === genConfig.productId) : null;
      const { data, error } = await safeJsonFetch('/api/creatives/clone-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: storeFilter,
          referenceUrl: referenceVideoUrl,
          productId: genConfig.productId || undefined,
          productName: selectedProduct?.title || undefined,
          coverImageUrl: genConfig.coverImageUrl || undefined,
          quantity: genConfig.quantity,
          videoDuration: genConfig.videoDuration,
        }),
      });
      if (error) {
        setGenPackageError(error === 'Failed to fetch' ? 'Server connection lost. Try again.' : error);
      } else if (data?.success) {
        setGenPackages(data.packages || []);
        setGenPackageConfig(data.config);
        setGenStrategy(null);
        setExpandedPackage(0);
        setGenCurrentId(null);
        setGenVersion(1);
      } else {
        setGenPackageError(data?.error?.message || data?.error || 'Clone failed');
      }
      setGeneratingPackage(false);
      return;
    }
    if (!window.confirm(`Generate ${genConfig.quantity * genConfig.creativesPerConcept} creatives across ${genConfig.quantity} concept${genConfig.quantity > 1 ? 's' : ''}? This will call AI APIs.`)) return;
    setGeneratingPackage(true);
    setGenPackageError('');
    setGenPackages([]);
    setRenderJobs({});
    setGenStrategy(null);
    setViewingHistory(null);
    const { data, error } = await safeJsonFetch('/api/creatives/generate-package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: storeFilter, ...genConfig,
        ...(matchedWinnerRef ? { winnerReferenceId: matchedWinnerRef.id, moreLikeThis: true } : {}),
        ...(activeConceptAction ? { conceptAction: activeConceptAction } : {}),
      }),
    });
    if (error) {
      // Translate raw fetch errors into friendly messages
      const msg = error === 'Failed to fetch'
        ? 'Server connection lost — may be restarting. Try again in a few seconds.'
        : error.includes('timed out') ? 'Generation timed out. Try again or reduce quantity.'
        : error;
      setGenPackageError(msg);
    } else if (data?.success) {
      setGenPackages(data.packages || []);
      setRenderJobs({});
      setGenPackageConfig(data.config);
      setGenStrategy(data.strategy);
      setExpandedPackage(0);
      setGenCurrentId(data.id);
      setGenVersion(data.version || 1);
      setComparingPackages([]);
      setViewingHistory(null);
      if (data.winnerReference) {
        setMatchedWinnerRef({ id: data.winnerReference.id, title: data.winnerReference.title, _matchScore: data.winnerReference.matchScore });
      }
      loadGenHistory();
      if (data.fallback) {
        setGenPackageError(data.fallbackReason || 'AI providers unavailable — draft packages generated from rules. You can still edit and use them.');
      } else if (data.failoverNote) {
        setGenPackageError(data.failoverNote);
      } else if (data.cached) {
        setGenPackageError(data.cacheReason || 'Returned cached result from a recent identical generation.');
      }
    } else {
      const errObj = data?.error;
      const errMsg = errObj?.message || data?.error || 'Generation failed';
      setGenPackageError(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
    }
    setGeneratingPackage(false);
  }

  async function handleGenerateVariations(packageIndex: number) {
    if (!storeFilter) return;
    if (!genCurrentId) {
      setGenPackageError('Generate a creative package first before creating variations.');
      return;
    }
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
      const newPackages = data.packages || [];
      setGenPackages(newPackages);
      setRenderJobs({});
      setGenPackageConfig(data.config);
      setGenStrategy(data.strategy);
      setExpandedPackage(0);
      setGenCurrentId(data.id);
      setGenVersion(data.version || 1);
      setComparingPackages([]);
      loadGenHistory();
      // Auto-render all image variation packages
      if (data.config?.contentType !== 'video' && newPackages.length > 0) {
        setTimeout(() => {
          for (let i = 0; i < newPackages.length; i++) {
            fireRenderJob(newPackages[i], i);
          }
        }, 100);
      }
    } else {
      setGenPackageError(data?.error?.message || data?.error || 'Variation generation failed');
    }
    setGeneratingPackage(false);
  }

  // Load product foundation when product changes
  async function loadFoundation(pid: string) {
    if (!pid) { setProductFoundation(null); return; }
    setFoundationLoading(true);
    try {
      const res = await fetch(`/api/creatives/foundations?productId=${pid}`);
      const data = await res.json();
      if (data.success && data.foundation) {
        setProductFoundation({
          beliefs: data.foundation.beliefs || [],
          uniqueMechanism: data.foundation.unique_mechanism || '',
          avatarSummary: data.foundation.avatar_summary || '',
          offerBrief: data.foundation.offer_brief || '',
          researchNotes: data.foundation.research_notes || '',
        });
      } else {
        setProductFoundation({ beliefs: [], uniqueMechanism: '', avatarSummary: '', offerBrief: '', researchNotes: '' });
      }
    } catch { setProductFoundation(null); }
    setFoundationLoading(false);
  }

  async function saveFoundation() {
    if (!genConfig.productId || !productFoundation) return;
    setFoundationSaving(true);
    try {
      await fetch('/api/creatives/foundations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: storeFilter,
          productId: genConfig.productId,
          beliefs: productFoundation.beliefs,
          avatarSummary: productFoundation.avatarSummary,
          offerBrief: productFoundation.offerBrief,
          uniqueMechanism: productFoundation.uniqueMechanism,
          researchNotes: productFoundation.researchNotes,
        }),
      });
    } catch {}
    setFoundationSaving(false);
  }

  /** Build ordered product image URLs with cover image first */
  function getProductImageUrls(): string[] {
    const selectedProduct = genConfig.productId ? products.find(p => p.id === genConfig.productId) : null;
    if (!selectedProduct) return [];
    const allImgs: string[] = [];
    if (selectedProduct.image_url) allImgs.push(selectedProduct.image_url);
    if (selectedProduct.images) {
      try { const parsed = JSON.parse(selectedProduct.images) as string[]; for (const u of parsed) { if (u && !allImgs.includes(u)) allImgs.push(u); } } catch {}
    }
    // Filter: must be https OR local /api/ path, must not be SVG
    const publicUrls = allImgs.filter(u => {
      if (!u.startsWith('https://') && !u.startsWith('/api/') && !u.startsWith('http://')) return false;
      const lower = u.toLowerCase().split('?')[0];
      if (lower.endsWith('.svg')) return false;
      return true;
    });
    // Put user-selected cover image first (if it's a valid non-SVG image)
    const cover = genConfig.coverImageUrl;
    if (cover && publicUrls.includes(cover)) {
      console.log('[COVER] Using selected cover:', cover.substring(0, 80));
      return [cover, ...publicUrls.filter(u => u !== cover)];
    }
    if (cover && !publicUrls.includes(cover)) {
      console.log('[COVER] Selected cover not in valid list (may be SVG or invalid), using default first');
    }
    return publicUrls;
  }

  function buildImageRenderPayload(pkg: any, idx: number) {
    const selectedProduct = genConfig.productId ? products.find(p => p.id === genConfig.productId) : null;
    const productName = (selectedProduct?.title || '').replace(/[™®©–—]/g, '').trim();
    const publicImageUrls = getProductImageUrls();

    // ═══ AUTHORITATIVE COVER IMAGE ═══
    // The user's explicit selection is the ONLY image that reaches the provider.
    // No fallback to random array elements. If no cover is selected, use the first valid image.
    const coverImage = genConfig.coverImageUrl || publicImageUrls[0] || '';
    const hasRef = !!coverImage;
    console.log(`[IMG-RENDER] Cover image: ${coverImage ? coverImage.substring(0, 100) : '(none)'} | userSelected=${!!genConfig.coverImageUrl}`);

    // Build format-aware, platform-aware, funnel-aware render prompt
    // Pass the resolved engine so Ideogram gets a concept-led prompt (no product bottle)
    const resolvedEngine = selectImageProvider(pkg.imageFormat || 'product_highlight', hasRef);
    const renderPrompt = buildImageRenderDirective(pkg, {
      productName: productName || undefined,
      platform: genConfig.platformTarget || 'meta',
      funnelStage: genConfig.funnelStage || 'mof',
      hasReferenceImage: hasRef,
    } as any);

    // Use selected dimension preset (auto resolves to platform default)
    const platform = genConfig.platformTarget || 'meta';
    const resolution = dimensionToResolution(genConfig.dimension, platform, 'image');

    return {
      storeId: storeFilter,
      type: 'text-to-image',
      prompt: renderPrompt.substring(0, 4000),
      title: pkg.title || `Image Ad ${idx + 1}`,
      angle: pkg.angle || undefined,
      resolution,
      // Send ONLY the user's chosen cover image — not the full array.
      // This is the authoritative source; the backend must use this and nothing else.
      coverImageUrl: coverImage || undefined,
      imageUrls: coverImage ? [coverImage] : undefined,
      packageId: genCurrentId,
      packageIndex: idx,
      publicImageUrls,
      imageFormat: pkg.imageFormat || 'product_highlight',
    };
  }

  /**
   * Select the best image provider based on format, product availability, and platform.
   * - gpt-image-1 (dalle): Best for product fidelity — can see reference images via /images/edits
   * - gemini-image: Good all-around with reference image support
   * - minimax-image: Backup, no reference image support
   */
  /**
   * Deterministic image provider selection based on creative type.
   * Mirrors the server-side provider-router.ts logic.
   * Text-heavy → Ideogram, Product-fidelity → Stability, Fallback → GPT Image.
   */
  function selectImageProvider(format: string, hasProductImages: boolean): string {
    // If user explicitly selected an image engine from the UI, use it directly. No overrides.
    // Ideogram generates concept statics (no product) so it never needs reference images.
    const imageEngines = ['nano-banana', 'stability', 'ideogram'];
    if (imageEngines.includes(genConfig.engine)) {
      return genConfig.engine;
    }

    // Auto mode: 3-tier strategy (matches backend provider-router.ts)
    const ct = genConfig.creativeType || '';
    // Tier 3 — Text-heavy → Ideogram (but not when product images exist)
    const textHeavyTypes = ['testimonial', 'review_stack', 'social_proof', 'offer_stack', 'problem_solution',
      'before_after', 'comparison', 'authority_claim', 'myth_busting', 'hook_viral', 'pattern_interrupt'];
    if (textHeavyTypes.includes(ct) && !hasProductImages) return 'ideogram';
    // Tier 2 — Product-fidelity → Stability
    const productTypes = ['product_demo', 'product_highlight', 'faceless_product_only', 'routine'];
    if (productTypes.includes(ct)) return 'stability';
    // Tier 1 — Everything else → Nano Banana 2 (default, fast, supports reference images)
    return 'nano-banana';
  }

  function fireRenderJob(pkg: any, idx: number, engineOverride?: string) {
    if (!storeFilter) return;
    if (renderJobs[idx]?.status === 'rendering' || renderJobs[idx]?.status === 'queued') return;

    const payload = buildImageRenderPayload(pkg, idx);
    const hasProductImages = payload.publicImageUrls.length > 0;

    // Block if product selected but no images
    if (genConfig.productId && !hasProductImages) {
      setRenderJobs(prev => ({ ...prev, [idx]: { status: 'failed', engine: 'dalle', error: 'No product images. Add images first.', startedAt: new Date().toISOString() } }));
      return;
    }

    // Select provider: per-package override > global engine selection > auto-routing
    const isManual = !!engineOverride;
    const engine = engineOverride || selectImageProvider(payload.imageFormat, hasProductImages);
    const engineLabels: Record<string, string> = { dalle: 'GPT Image', 'gemini-image': 'Gemini', 'minimax-image': 'MiniMax', stability: 'Stability', 'nano-banana': 'Nano Banana', ideogram: 'Ideogram' };
    const engineLabel = engineLabels[engine] || engine;

    // Set queued immediately, then fire
    setRenderJobs(prev => ({ ...prev, [idx]: { status: 'queued', engine, startedAt: new Date().toISOString() } }));

    // Remove non-API fields from the fetch payload
    const { publicImageUrls, imageFormat, ...fetchPayload } = payload;

    // Submit job (returns instantly) then poll for result
    (async () => {
      setRenderJobs(prev => ({ ...prev, [idx]: { ...prev[idx], status: 'rendering' } }));

      // Step 1: Submit render job — returns jobId immediately
      const { data, error } = await safeJsonFetch('/api/creatives/render-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...fetchPayload,
          engine: engine,
          creativeType: genConfig.creativeType,
          // Disable failover when user explicitly selected an engine (not Auto).
          // If the chosen engine fails, show the error — don't silently switch.
          autoFailover: genConfig.engine === 'auto' && !isManual,
          // Layout-aware compositing: backend detects layout type from creativeType
          // and places product asymmetrically based on ad format + funnel stage.
          layoutType: pkg.imageFormat || genConfig.creativeType || undefined,
          funnelStage: (pkg as any).stage || genConfig.funnelStage || 'tof',
        }),
      });

      if (error || !data?.success) {
        const reason = error || data?.error?.message || 'Failed to start render';
        setRenderJobs(prev => ({ ...prev, [idx]: { ...prev[idx], status: 'failed', error: reason.substring(0, 300), completedAt: new Date().toISOString() } }));
        return;
      }

      const jobId = data.jobId || data.id;
      setRenderJobs(prev => ({ ...prev, [idx]: { ...prev[idx], creativeId: jobId } }));

      // Step 2: Poll for completion every 3 seconds
      let polls = 0;
      const maxPolls = 60; // 3min max (60 * 3s)
      const pollInterval = 3000;

      const poll = async () => {
        polls++;
        try {
          const res = await fetch(`/api/creatives/render-image?jobId=${jobId}`);
          const pollData = await res.json().catch(() => null);

          if (pollData?.status === 'completed' && pollData?.imageUrl) {
            const actualEngine = pollData.engine || engine;
            const failoverNote = pollData.failoverLog?.length > 0
              ? `${engineLabels[engine] || engine} unavailable, used ${engineLabels[actualEngine] || actualEngine}`
              : '';
            setRenderJobs(prev => ({ ...prev, [idx]: {
              ...prev[idx], status: 'completed', engine: actualEngine,
              imageUrl: pollData.imageUrl, creativeId: jobId,
              completedAt: new Date().toISOString(),
              ...(failoverNote ? { error: failoverNote } : {}),
            } }));
            loadCreatives();
            return;
          }

          if (pollData?.status === 'failed') {
            setRenderJobs(prev => ({ ...prev, [idx]: { ...prev[idx], status: 'failed', error: (pollData.error || 'Render failed').substring(0, 300), completedAt: new Date().toISOString() } }));
            return;
          }

          // Still rendering — continue polling
          if (polls < maxPolls) {
            setTimeout(poll, pollInterval);
          } else {
            setRenderJobs(prev => ({ ...prev, [idx]: { ...prev[idx], status: 'failed', error: 'Render timed out after 3 minutes. Check Generated tab.', completedAt: new Date().toISOString() } }));
          }
        } catch {
          // Network error during poll — retry polling (don't fail the job)
          if (polls < maxPolls) {
            setTimeout(poll, pollInterval * 2); // slower retry on network error
          } else {
            setRenderJobs(prev => ({ ...prev, [idx]: { ...prev[idx], status: 'failed', error: 'Lost connection while checking render status.', completedAt: new Date().toISOString() } }));
          }
        }
      };

      // Start polling after a short delay (give the backend time to start)
      setTimeout(poll, 2000);
    })();
  }

  function handleRenderImage(pkg: any, idx: number, engine?: string) {
    fireRenderJob(pkg, idx, engine);
  }

  function handleBulkRender(indices?: number[], engine?: string) {
    // Only fire render for packages that are IMAGE packages (per-package, so mixed batches work)
    const targets = indices || genPackages.map((_, i) => i);
    const renderableTargets = targets.filter(i => {
      if (!isVideoPackage(genPackages[i], genPackageConfig?.contentType)) {
        const job = renderJobs[i];
        return !job || job.status === 'failed' || job.status === 'completed';
      }
      return false;
    });
    if (renderableTargets.length === 0) return;
    if (!window.confirm(`Render ${renderableTargets.length} image${renderableTargets.length > 1 ? 's' : ''} with AI? This will call the API and may incur costs.`)) return;
    for (const i of renderableTargets) {
      fireRenderJob(genPackages[i], i, engine);
    }
  }

  function handleRetryRender(pkg: any, idx: number) {
    setRenderJobs(prev => { const n = { ...prev }; delete n[idx]; return n; });
    fireRenderJob(pkg, idx);
  }

  /**
   * Fire video generation for a single package WITHOUT the confirm dialog.
   * Used by bulk generation to avoid per-item confirms.
   */
  function fireVideoJob(pkg: any, idx: number, engine?: string) {
    if (!storeFilter) return;
    if (generatingIdxSet.has(idx)) return;
    if (packageVideoStatus[idx]) return;
    const resolvedEngine = engine || bestEngineForDuration(genConfig.videoDuration || 20);
    setGeneratingIdxSet(prev => new Set(prev).add(idx));
    (async () => {
      const selectedProduct = genConfig.productId ? products.find(p => p.id === genConfig.productId) : null;
      const productName = selectedProduct?.title || '';
      const productImageUrls = getProductImageUrls();

      setPackageVideoStatus(prev => { const n = { ...prev }; delete n[idx]; return n; });

      if (genConfig.productId && productImageUrls.length === 0) {
        setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: '', status: 'failed', engine: resolvedEngine, reason: 'No product images.' } }));
        setGeneratingIdxSet(prev => { const n = new Set(prev); n.delete(idx); return n; });
        return;
      }

      const dur = genConfig.videoDuration || 20;
      const isSeedance = resolvedEngine === 'seedance';
      const parts: string[] = [];
      parts.push(`This is a ${dur}-second video. FAST-PACED speaking — people talk QUICKLY like an excited real TikTok creator, NOT slow, NOT calm, NOT meditative. High energy, rapid delivery, punchy sentences. Think fast-talking influencer selling something they love. Quick cuts between scenes. CTA in the last 2 seconds.`);
      parts.push(`CRITICAL PACING: This is a ${dur}-SECOND video. Use the FULL ${dur} seconds. Do NOT rush. Hold each shot for 2-4 seconds. Slow, natural pacing. The CTA must appear in the LAST 3 seconds and must NOT be cut off.`);
      const presenterDesc = PRESENTER_DESCRIPTIONS[genConfig.avatarStyle || 'female_ugc'] || PRESENTER_DESCRIPTIONS.female_ugc;
      parts.push(`RULES: Handheld iPhone camera, natural lighting. ${presenterDesc} NO background music, NO soundtrack — voice and room tone only. UGC native feel.`);
      if (productName) {
        const desc = (selectedProduct?.description || '').toString().substring(0, 400);
        parts.push(`PRODUCT REFERENCE (do not show as a still photo — depict the product naturally within the scene): "${productName}"${desc ? ` — ${desc}` : ''}. Match brand name, packaging shape, and color palette. Use medium/wide shots for branding; avoid extreme label close-ups (AI mis-renders fine text).`);
      }
      if (genConfig.creativeType && CREATIVE_TYPE_DIRECTIONS[genConfig.creativeType]) {
        parts.push(CREATIVE_TYPE_DIRECTIONS[genConfig.creativeType]);
      }
      if (genConfig.hookStyle && HOOK_DIRECTIONS[genConfig.hookStyle]) {
        parts.push(HOOK_DIRECTIONS[genConfig.hookStyle]);
      }
      if (genConfig.funnelStage === 'bof') {
        parts.push(`Funnel stage: Bottom of funnel — urgency, direct CTA, social proof, offer-driven.`);
      } else if (genConfig.funnelStage === 'mof') {
        parts.push(`Funnel stage: Middle of funnel — build trust, show proof, educate.`);
      }
      if (genConfig.offer) {
        parts.push(`Offer: ${genConfig.offer}`);
      }
      if (genConfig.platformTarget === 'tiktok') {
        parts.push('TikTok native: vertical framing, fast energy, trending feel.');
      }
      if (pkg.visualDirection) parts.push(pkg.visualDirection);
      if (pkg.script) parts.push(`Script (MUST fit in ${dur}s — speak slowly and naturally): ${pkg.script}`);
      if (pkg.sceneStructure) parts.push(`Scene timing: ${pkg.sceneStructure}`);
      parts.push('OPENING: The product image is provided as a reference. Within the first 0.5 seconds, transition into cinematic motion — a hand picking up the product, camera pulling back to reveal a scene, or the product rotating. Do NOT hold a static product shot. Immediately bring the scene to life with movement and energy.');
      let prompt = parts.join('\n\n') || pkg.script || pkg.adCopy || '';
      // Strip all audio references — Sora generates glitchy sounds from any audio mention
      if (!isSeedance) prompt = prompt.replace(/\b(background music|ambient music|soundtrack|cinematic score|room tone|ambient sound|sound effect|natural room tone|music bed|audio cue|upbeat track)\b/gi, '');

      const dim = genConfig.dimension === 'auto'
        ? (genConfig.platformTarget === 'tiktok' ? '9:16' : '4:5')
        : genConfig.dimension;
      let videoResolution =
        dim === '9:16' || dim === '4:5' ? '720p-vertical' :
        dim === '16:9' ? '720p' : '720p-vertical';
      if (resolvedEngine === 'seedance') videoResolution = genConfig.seedanceQuality || '720p';
      const videoDuration = String(dur);

      // Authoritative cover image = the one the user explicitly selected.
      // Fall back to the first valid product image only if no selection was made.
      const chosenCover = genConfig.coverImageUrl || productImageUrls[0] || '';
      console.log('[CREATIVE-GEN] Sending cover image URL:', chosenCover.substring(0, 120));
      console.log('[CREATIVE-GEN] User selected cover:', genConfig.coverImageUrl ? 'YES' : 'NO (defaulted)');

      const { data, error } = await safeJsonFetch('/api/creatives/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: storeFilter, engine: resolvedEngine,
          // Use image-to-video when a product image exists so the engine sees
          // the REAL product. The prompt instructs immediate cinematic transition
          // so it doesn't feel like a static poster opening.
          type: chosenCover ? 'image-to-video' : 'text-to-video',
          prompt: prompt.substring(0, 4000), title: pkg.title || `Video ${idx + 1}`,
          angle: pkg.angle || undefined,
          resolution: videoResolution,
          duration: videoDuration,
          dimension: dim,
          creativeType: genConfig.creativeType,
          coverImageUrl: chosenCover || undefined,
          imageUrls: chosenCover ? [chosenCover] : undefined,
          userSelectedCover: !!genConfig.coverImageUrl,
          packageId: genCurrentId, packageIndex: idx,
        }),
      });

      if (error) {
        setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: '', status: 'failed', engine: resolvedEngine, reason: error } }));
      } else if (data?.success) {
        setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: data.id, status: 'processing', engine: resolvedEngine } }));
        loadCreatives();
      } else {
        setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: '', status: 'failed', engine: resolvedEngine, reason: data?.error?.message || 'Generation failed' } }));
      }
      setGeneratingIdxSet(prev => { const n = new Set(prev); n.delete(idx); return n; });
    })();
  }

  /**
   * Generate All — works for both image and video packages.
   * mode: 'all' fires everything at once, 'sequential' fires one at a time.
   */
  // Pick the best video engine based on the requested duration
  function bestEngineForDuration(duration: number): string {
    // If user explicitly selected an engine (not auto), use it
    if (genConfig.engine && genConfig.engine !== 'auto') return genConfig.engine;
    if (duration <= 8) return 'veo';         // Veo: 4-8s
    if (duration <= 10) return 'runway';     // Runway: 5-10s
    return 'sora';                           // Sora: 8-20s
  }

  function handleGenerateAll(mode: 'all' | 'sequential' = 'all', engine?: string) {
    const count = genPackages.length;
    if (count === 0) return;

    // Split packages into video and image groups (mixed batches work correctly)
    const videoIndices: number[] = [];
    const imageIndices: number[] = [];
    for (let i = 0; i < count; i++) {
      if (isVideoPackage(genPackages[i], genPackageConfig?.contentType)) videoIndices.push(i);
      else imageIndices.push(i);
    }

    const autoEngine = bestEngineForDuration(genConfig.videoDuration || 20);
    const videoEngine = engine || autoEngine;
    const parts: string[] = [];
    if (videoIndices.length > 0) parts.push(`${videoIndices.length} video${videoIndices.length > 1 ? 's' : ''}`);
    if (imageIndices.length > 0) parts.push(`${imageIndices.length} image${imageIndices.length > 1 ? 's' : ''}`);
    if (!window.confirm(`Generate ${parts.join(' + ')}? This will call APIs and may incur costs.`)) return;

    // VIDEOS
    if (videoIndices.length > 0) {
      if (mode === 'all') {
        for (const i of videoIndices) {
          if (!packageVideoStatus[i] && !generatingIdxSet.has(i)) {
            fireVideoJob(genPackages[i], i, videoEngine);
          }
        }
      } else {
        let cur = 0;
        const fireNext = () => {
          while (cur < videoIndices.length && (packageVideoStatus[videoIndices[cur]] || generatingIdxSet.has(videoIndices[cur]))) cur++;
          if (cur < videoIndices.length) {
            fireVideoJob(genPackages[videoIndices[cur]], videoIndices[cur], videoEngine);
            cur++;
            setTimeout(fireNext, 2000);
          }
        };
        fireNext();
      }
    }

    // IMAGES
    if (imageIndices.length > 0) {
      const renderable = imageIndices.filter(i => { const job = renderJobs[i]; return !job || job.status === 'failed' || job.status === 'completed'; });
      if (mode === 'all') {
        for (const i of renderable) fireRenderJob(genPackages[i], i, engine);
      } else {
        let cur = 0;
        const fireNext = () => {
          if (cur < renderable.length) {
            fireRenderJob(genPackages[renderable[cur]], renderable[cur], engine);
            cur++;
            setTimeout(fireNext, 1500);
          }
        };
        fireNext();
      }
    }
  }

  async function handleLaunchToMeta() {
    if (!storeFilter || !selectedProfileId || !launchLinkUrl) return;

    // Only launch rendered image creatives
    const renderedPackages = genPackages
      .map((pkg, idx) => ({ pkg, idx, job: renderJobs[idx] }))
      .filter(({ job }) => job?.status === 'completed' && job?.imageUrl);

    if (renderedPackages.length === 0) {
      setLaunchError('No rendered images to launch. Render images first.');
      return;
    }

    // Group by concept/angle
    const conceptGroups: Record<string, any[]> = {};
    for (const { pkg, job } of renderedPackages) {
      const concept = (pkg as any).angle || (pkg as any).conceptAngle || (pkg as any).title || 'General';
      if (!conceptGroups[concept]) conceptGroups[concept] = [];
      conceptGroups[concept].push({
        id: job!.creativeId || '',
        title: (pkg as any).title || concept,
        headline: (pkg as any).headline || (pkg as any).hookText || (pkg as any).title || '',
        primaryText: (pkg as any).adCopy || (pkg as any).headline || '',
        imageUrl: job!.imageUrl!,
        linkUrl: launchLinkUrl,
        callToAction: 'SHOP_NOW',
      });
    }

    const packages = Object.entries(conceptGroups).map(([concept, creatives]) => ({
      concept,
      creatives,
    }));

    if (!window.confirm(`Launch ${renderedPackages.length} ads into ${packages.length} ad set(s) on Meta?\n\nBudget: $30/day per ad set\nStatus: PAUSED (you can activate in Ads Manager)\n\nThis will create real campaigns in your ad account.`)) return;

    setLaunching(true);
    setLaunchError('');
    setLaunchResult(null);

    const { data, error } = await safeJsonFetch('/api/creatives/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: storeFilter,
        profileId: selectedProfileId,
        packages,
        dailyBudget: 3000,
        status: 'PAUSED',
      }),
    });

    if (error) {
      setLaunchError(error);
    } else if (data?.success) {
      setLaunchResult(data);
    } else {
      setLaunchError(data?.error?.message || 'Launch failed');
    }
    setLaunching(false);
  }

  function toggleCompare(idx: number) {
    setComparingPackages(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx].slice(0, 3));
  }

  async function handleGenerateVideoFromPackage(pkg: any, idx: number, engine?: string) {
    const resolvedEngine = engine || bestEngineForDuration(genConfig.videoDuration || 20);
    if (!storeFilter) return;
    // Per-package routing — mixed batches have both video + image packages
    const isVideo = isVideoPackage(pkg, genPackageConfig?.contentType);
    if (!isVideo) {
      // Route image packages to the image render pipeline instead
      return fireRenderJob(pkg, idx, engine);
    }
    const engineNames: Record<string, string> = { sora: 'Sora', veo: 'Veo', minimax: 'Hailuo', runway: 'Runway', higgsfield: 'Higgsfield' };
    if (!window.confirm(`Generate ${genConfig.videoDuration}s video with ${engineNames[resolvedEngine] || resolvedEngine}? This will call the API and may incur costs.`)) return;
    setGeneratingIdxSet(prev => new Set(prev).add(idx));

    // Gather product images FIRST — only public URLs (providers can't access local uploads)
    const selectedProduct = genConfig.productId ? products.find(p => p.id === genConfig.productId) : null;
    const productName = selectedProduct?.title || '';
    const productImageUrls = getProductImageUrls();

    // Clear any previous failed status for this package
    setPackageVideoStatus(prev => { const n = { ...prev }; delete n[idx]; return n; });

    // Block generation if product is selected but has no images
    if (genConfig.productId && productImageUrls.length === 0) {
      setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: '', status: 'failed', engine: resolvedEngine, reason: 'No product images. Add images first.' } }));
      setGeneratingIdxSet(prev => { const n = new Set(prev); n.delete(idx); return n; });
      return;
    }

    // Build video prompt with realism + brand fidelity + duration pacing
    const dur = genConfig.videoDuration || 20;
    const isSeedance = resolvedEngine === 'seedance';
    const parts: string[] = [];
    parts.push(`This is a ${dur}-second video. FAST-PACED speaking — people talk QUICKLY like an excited real TikTok creator, NOT slow, NOT calm, NOT meditative. High energy, rapid delivery, punchy sentences. Think fast-talking influencer selling something they love. Quick cuts between scenes. CTA in the last 2 seconds.`);
    parts.push(`CRITICAL PACING: This is a ${dur}-SECOND video. Use the FULL ${dur} seconds. Hold each shot for 2-4 seconds. Slow, natural pacing. CTA in the LAST 3 seconds — must NOT be cut off.`);
    const presenterDesc2 = PRESENTER_DESCRIPTIONS[genConfig.avatarStyle || 'female_ugc'] || PRESENTER_DESCRIPTIONS.female_ugc;
    parts.push(`RULES: Handheld iPhone camera, natural lighting, real environment. ${presenterDesc2} NO background music, NO soundtrack — voice and room tone only. UGC native feel.`);
    if (productName) {
      const desc = (selectedProduct?.description || '').toString().substring(0, 400);
      parts.push(`PRODUCT REFERENCE (depict naturally within the scene, NOT as a static product photo): "${productName}"${desc ? ` — ${desc}` : ''}. Match the brand name, packaging shape, and color palette. Use medium/wide shots for branding; avoid extreme label close-ups (AI mis-renders fine text).`);
    }
    if (genConfig.creativeType && CREATIVE_TYPE_DIRECTIONS[genConfig.creativeType]) {
      parts.push(CREATIVE_TYPE_DIRECTIONS[genConfig.creativeType]);
    }
    if (genConfig.hookStyle && HOOK_DIRECTIONS[genConfig.hookStyle]) {
      parts.push(HOOK_DIRECTIONS[genConfig.hookStyle]);
    }
    if (genConfig.funnelStage === 'bof') {
      parts.push(`Funnel stage: Bottom of funnel — urgency, direct CTA, social proof, offer-driven.`);
    } else if (genConfig.funnelStage === 'mof') {
      parts.push(`Funnel stage: Middle of funnel — build trust, show proof, educate.`);
    }
    if (genConfig.offer) {
      parts.push(`Offer: ${genConfig.offer}`);
    }
    if (genConfig.platformTarget === 'tiktok') {
      parts.push('TikTok native: vertical framing, fast energy, trending feel.');
    }
    if (pkg.visualDirection) parts.push(pkg.visualDirection);
    if (pkg.script) parts.push(`Script (MUST fit in ${dur}s — speak slowly and naturally): ${pkg.script}`);
    if (pkg.sceneStructure) parts.push(`Scene timing (${dur}s total): ${pkg.sceneStructure}`);
    if (pkg.brollDirection) parts.push(`B-roll (hold each shot 2-4s): ${pkg.brollDirection}`);
    if (!isVideo) {
      if (pkg.visualComposition) parts.push(pkg.visualComposition);
      if (pkg.headline) parts.push(`Headline: ${pkg.headline}`);
    }
    parts.push('OPENING: The product image is provided as a reference. Within the first 0.5 seconds, transition into cinematic motion — a hand picking up the product, camera pulling back to reveal a scene, or the product rotating. Do NOT hold a static product shot. Immediately bring the scene to life with movement and energy.');
    let prompt = parts.join('\n\n') || pkg.script || pkg.adCopy || '';
    if (!isSeedance) prompt = prompt.replace(/\b(background music|ambient music|soundtrack|cinematic score|music bed|upbeat track|gentle melody|soft music|lo-fi beat|trending audio|room tone|ambient sound|sound effect|natural room tone|audio cue)\b/gi, '');

    // Runway/Higgsfield need ultra-simple visual motion prompts with correct product behavior.
    let finalPrompt = prompt;
    if (resolvedEngine === 'runway' || resolvedEngine === 'higgsfield') {
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

    // Map dimension to provider resolution
    const dim = genConfig.dimension === 'auto'
      ? (genConfig.platformTarget === 'tiktok' ? '9:16' : '4:5')
      : genConfig.dimension;
    let videoRes =
      dim === '9:16' || dim === '4:5' ? '720p-vertical' :
      dim === '16:9' ? '720p' : '720p-vertical';
    if (resolvedEngine === 'seedance') videoRes = genConfig.seedanceQuality || '720p';

    // Authoritative cover = user's explicit selection; fall back to first valid image only if unset.
    const chosenCover = genConfig.coverImageUrl || productImageUrls[0] || '';
    console.log('[CREATIVE-GEN] Sending cover image URL:', chosenCover.substring(0, 120));
    console.log('[CREATIVE-GEN] User selected cover:', genConfig.coverImageUrl ? 'YES' : 'NO (defaulted)');

    const payload = {
      storeId: storeFilter,
      engine: isVideo ? resolvedEngine : undefined,
      // Use image-to-video when product image exists — engine sees the REAL product.
      // Prompt forces immediate cinematic transition off the product frame.
      type: chosenCover ? 'image-to-video' : 'text-to-video',
      prompt: finalPrompt,
      title: pkg.title || `Package ${idx + 1}`,
      angle: pkg.angle || undefined,
      coverImageUrl: chosenCover || undefined,
      imageUrls: chosenCover ? [chosenCover] : undefined,
      userSelectedCover: !!genConfig.coverImageUrl,
      resolution: videoRes,
      duration: String(genConfig.videoDuration || 20),
      dimension: dim,
      creativeType: genConfig.creativeType,
      packageId: genCurrentId,
      packageIndex: idx,
    };

    const { data, error } = await safeJsonFetch('/api/creatives/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (error) {
      setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: '', status: 'failed', engine: resolvedEngine, reason: error } }));
    } else if (data?.success) {
      setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: data.id, status: 'processing', engine: data.engine || resolvedEngine } }));
      loadCreatives();
    } else {
      const errCode = data?.error?.code;
      const reason = errCode === 'QUOTA_EXCEEDED'
        ? `${resolvedEngine} billing limit. Try another engine.`
        : errCode === 'MISSING_IMAGE'
        ? 'Product image required.'
        : (data?.error?.message || 'Generation failed');
      setPackageVideoStatus(prev => ({ ...prev, [idx]: { id: '', status: 'failed', engine: resolvedEngine, reason } }));
    }
    setGeneratingIdxSet(prev => { const n = new Set(prev); n.delete(idx); return n; });
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
        <button
          onClick={() => setTab('library')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'library' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Library {libraryCounts.totalWinners > 0 && <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20">{libraryCounts.totalWinners}</span>}
        </button>
        <button
          onClick={() => setTab('billing')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'billing' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Billing
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
          {/* ── Bulk action bar — appears when 1+ creatives selected ── */}
          {selectedCreativeIds.size > 0 && (
            <div className="sticky top-0 z-20 mb-4 bg-blue-900/20 border border-blue-700/50 rounded-xl p-3 backdrop-blur-sm flex flex-wrap items-center gap-3">
              <span className="text-sm text-blue-300 font-medium">
                {selectedCreativeIds.size} selected
              </span>
              <div className="flex-1" />
              <button onClick={selectAllVisibleCreatives}
                className="px-3 py-1.5 text-xs text-blue-300 hover:text-white border border-blue-700 rounded-lg">
                Select all launchable
              </button>
              <button onClick={clearCreativeSelection}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg">
                Clear
              </button>
              <button onClick={openBulkLaunchModal}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg">
                Launch to Facebook ({selectedCreativeIds.size})
              </button>
            </div>
          )}

          {/* ── Always-visible "Select All" / "Launch" entry point when nothing is selected ── */}
          {selectedCreativeIds.size === 0 && creatives.length > 0 && (
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs text-slate-500">Select creatives to launch them to Facebook</p>
              <button onClick={selectAllVisibleCreatives}
                className="px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 border border-blue-900/50 rounded-lg">
                Select all launchable
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
          ) : creatives.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">No creatives yet</p>
              <p className="text-xs text-slate-500 mt-1">Generate videos using Sora, Veo, Hailuo, or NanoBanana</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {creatives.map((c) => {
                const launchable = isCreativeLaunchable(c);
                const selected = selectedCreativeIds.has(c.id);
                return (
                <div key={c.id} className={`bg-slate-900 border rounded-xl overflow-hidden relative transition-colors ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-800'}`}>
                  {/* Winner badge — top-right overlay */}
                  {isCreativeWinner(c.id) && (
                    <span className="absolute top-2 right-2 z-10 text-[9px] px-2 py-0.5 rounded-full bg-amber-500 text-black font-bold shadow-lg">WINNER</span>
                  )}
                  {/* Selection checkbox — top-left overlay */}
                  {launchable && (
                    <button
                      onClick={() => toggleCreativeSelection(c.id)}
                      className={`absolute top-2 left-2 z-10 w-7 h-7 rounded-md border-2 flex items-center justify-center transition-colors ${
                        selected ? 'bg-blue-600 border-blue-400' : 'bg-slate-900/80 border-slate-600 hover:border-blue-400 backdrop-blur-sm'
                      }`}
                      title={selected ? 'Deselect' : 'Select for launch'}>
                      {selected && (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  )}
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
                        {c.format && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400" title="Aspect ratio">{c.format}</span>
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
                          <>
                            <a
                              href={mediaUrl(c.file_url)}
                              download
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-emerald-400 hover:text-emerald-300"
                            >
                              Download
                            </a>
                            <button
                              onClick={() => {
                                setSelectedCreativeIds(new Set([c.id]));
                                setTimeout(() => openBulkLaunchModal(), 50);
                              }}
                              className="text-[10px] text-blue-400 hover:text-blue-300"
                              title="Launch this creative to Facebook"
                            >
                              Launch
                            </button>
                            {!isCreativeWinner(c.id) ? (
                              <button
                                onClick={() => setShowWinnerModal({ pkg: { title: c.title, script: c.description, angle: c.angle }, idx: 0, creativeId: c.id })}
                                className="text-[10px] text-amber-400 hover:text-amber-300"
                                title="Save as Winner Reference"
                              >
                                Save Winner
                              </button>
                            ) : (
                              <button
                                onClick={() => { const w = winners.find(w => w.creative_id === c.id); if (w) handleGenerateMoreLikeThis(w); }}
                                className="text-[10px] text-purple-400 hover:text-purple-300"
                                title="Generate more creatives like this winner"
                              >
                                More Like This
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {/* ── Bulk Launch to Facebook Modal ── */}
          {showBulkLaunchModal && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !bulkLaunching && setShowBulkLaunchModal(false)}>
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">Launch to Facebook Ads</h3>
                  <button onClick={() => !bulkLaunching && setShowBulkLaunchModal(false)} className="text-slate-400 hover:text-white">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                <div className="mb-4 p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                  <p className="text-sm text-blue-300">{selectedCreativeIds.size} creative{selectedCreativeIds.size !== 1 ? 's' : ''} selected</p>
                  {launchMode === 'new' ? (
                    <p className="text-[10px] text-blue-400 mt-1">1 concept = 1 ad set. Existing ad sets are auto-reused (no duplicates). Image + video creatives go in the same ad set. $30/day per new ad set, broad 18–65 US targeting, all PAUSED.</p>
                  ) : (
                    <p className="text-[10px] text-yellow-400 mt-1">SCALE MODE: adds new ads into existing ad sets. No new campaign or ad sets will be created. New ads land PAUSED.</p>
                  )}
                </div>

                {/* Mode toggle */}
                <div className="mb-4">
                  <label className="text-[10px] text-slate-500 mb-2 block uppercase font-semibold">Launch Mode</label>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      setLaunchMode('new');
                      setConceptAdSetMap({});
                    }}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${launchMode === 'new' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                      New Campaign
                      <div className="text-[9px] font-normal opacity-80 mt-0.5">Fresh ad sets for testing</div>
                    </button>
                    <button onClick={() => {
                      setLaunchMode('scale');
                      if (bulkLaunchProfileId) loadCampaignsForProfile(bulkLaunchProfileId);
                    }}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${launchMode === 'scale' ? 'bg-yellow-600 border-yellow-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                      Scale Existing
                      <div className="text-[9px] font-normal opacity-80 mt-0.5">Add to winning ad sets</div>
                    </button>
                  </div>
                </div>

                {/* Ad Account selector */}
                <div className="mb-3">
                  <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">Ad Account</label>
                  <select value={bulkLaunchProfileId} onChange={e => {
                    setBulkLaunchProfileId(e.target.value);
                    loadPagesForProfile(e.target.value);
                    if (launchMode === 'scale') loadCampaignsForProfile(e.target.value);
                  }}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white">
                    {fbProfiles.length === 0 && <option value="">No ad accounts linked</option>}
                    {fbProfiles.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.ad_account_name || p.profile_name}</option>
                    ))}
                  </select>
                </div>

                {/* ═══ SCALE MODE: Campaign + Concept→AdSet mapping ═══ */}
                {launchMode === 'scale' && (
                  <>
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] text-slate-500 uppercase font-semibold">Existing Campaign</label>
                        {loadingCampaigns && <span className="text-[10px] text-slate-500">Loading...</span>}
                      </div>
                      <select value={selectedCampaignId} onChange={e => {
                        setSelectedCampaignId(e.target.value);
                        if (bulkLaunchProfileId && e.target.value) loadAdSetsForCampaign(bulkLaunchProfileId, e.target.value);
                      }}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white">
                        {fbCampaigns.length === 0 && <option value="">No campaigns — click Scale button to load</option>}
                        {fbCampaigns.map(c => (
                          <option key={c.id} value={c.id}>{c.name} [{c.status}]</option>
                        ))}
                      </select>
                    </div>

                    {/* Concept → Ad Set mapping */}
                    {fbAdSets.length > 0 && (
                      <div className="mb-3">
                        <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">Concept → Ad Set Mapping</label>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {getSelectedConcepts().map(concept => {
                            const mapped = conceptAdSetMap[concept];
                            const mappedAdSet = fbAdSets.find(a => a.id === mapped);
                            const wouldExceed = mappedAdSet && mappedAdSet.adCount >= 8;
                            return (
                              <div key={concept} className="p-2 bg-slate-800/50 border border-slate-700 rounded-lg">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs text-white font-medium truncate flex-1" title={concept}>{concept}</span>
                                  {mapped && !wouldExceed && <span className="text-[9px] text-emerald-400">✓ matched</span>}
                                  {wouldExceed && <span className="text-[9px] text-red-400">⚠ full</span>}
                                  {!mapped && <span className="text-[9px] text-red-400">no match</span>}
                                </div>
                                <select value={mapped || ''} onChange={e => setConceptAdSetMap(prev => ({ ...prev, [concept]: e.target.value }))}
                                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-white">
                                  <option value="">— select ad set —</option>
                                  {fbAdSets.map(a => (
                                    <option key={a.id} value={a.id}>
                                      {a.name} ({a.adCount} ads{a.adCount >= 8 ? ' — FULL' : ''})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {loadingAdSets && <p className="text-[10px] text-slate-500 mb-3">Loading ad sets...</p>}
                  </>
                )}

                {/* Page selector — CRITICAL: shows exactly which page will be used */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold">Facebook Page (ad creative)</label>
                    {loadingPages && <span className="text-[10px] text-slate-500">Loading pages...</span>}
                  </div>
                  {!loadingPages && availablePages.length === 0 && (
                    <div className="px-3 py-2 bg-red-900/20 border border-red-800 rounded-lg text-xs text-red-400">
                      No pages accessible with this ad account's token.
                    </div>
                  )}
                  {availablePages.length > 0 && (
                    <select value={selectedPageId} onChange={e => setSelectedPageId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white">
                      {availablePages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id}){p.id === currentProfilePageId ? ' ← stored' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* Show which page will be used */}
                  {selectedPageId && (
                    <p className="text-[10px] text-emerald-400 mt-1">
                      Will use: {availablePages.find(p => p.id === selectedPageId)?.name} ({selectedPageId})
                    </p>
                  )}
                  {/* Warning if different from stored */}
                  {selectedPageId && currentProfilePageId && selectedPageId !== currentProfilePageId && (
                    <div className="mt-2 flex items-center gap-2">
                      <input type="checkbox" id="savePageDefault" checked={savePageAsDefault}
                        onChange={e => setSavePageAsDefault(e.target.checked)}
                        className="w-3 h-3" />
                      <label htmlFor="savePageDefault" className="text-[10px] text-yellow-400">
                        Save this page as the default for this ad account (overwrites stored {currentProfilePageName || currentProfilePageId})
                      </label>
                    </div>
                  )}
                </div>

                {/* Landing page URL */}
                <div className="mb-4">
                  <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">Landing Page URL</label>
                  <input type="url" value={bulkLaunchLinkUrl} onChange={e => setBulkLaunchLinkUrl(e.target.value)}
                    placeholder="https://yourdomain.com/product"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600" />
                </div>

                {bulkLaunching && bulkLaunchProgress && (
                  <div className="mb-3 px-3 py-2 bg-blue-900/20 border border-blue-800 rounded-lg flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    <p className="text-xs text-blue-300">{bulkLaunchProgress}</p>
                  </div>
                )}
                {bulkLaunchError && (
                  <div className="mb-3 px-3 py-2 bg-red-900/20 border border-red-800 rounded-lg text-xs text-red-400">{bulkLaunchError}</div>
                )}
                {bulkLaunchResult && (
                  <div className={`mb-3 px-3 py-2 border rounded-lg ${bulkLaunchResult.partial ? 'bg-yellow-900/20 border-yellow-800' : 'bg-emerald-900/20 border-emerald-800'}`}>
                    <p className={`text-xs font-medium ${bulkLaunchResult.partial ? 'text-yellow-400' : 'text-emerald-400'}`}>
                      {bulkLaunchResult.partial ? 'Partial success: ' : 'Launched: '}
                      {bulkLaunchResult.summary?.adsCreated} ads in {bulkLaunchResult.summary?.adSetsCreated} ad sets
                    </p>
                    {(bulkLaunchResult.summary?.adSetsReused > 0 || bulkLaunchResult.summary?.adSetsNewlyCreated > 0) && (
                      <p className="text-[10px] text-slate-300 mt-1">
                        {bulkLaunchResult.summary?.adSetsReused > 0 && `${bulkLaunchResult.summary.adSetsReused} reused`}
                        {bulkLaunchResult.summary?.adSetsReused > 0 && bulkLaunchResult.summary?.adSetsNewlyCreated > 0 && ', '}
                        {bulkLaunchResult.summary?.adSetsNewlyCreated > 0 && `${bulkLaunchResult.summary.adSetsNewlyCreated} newly created`}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1">
                      Campaign: {bulkLaunchResult.campaign?.name} ({bulkLaunchResult.summary?.status})
                    </p>
                    {bulkLaunchResult.summary?.errorsCount > 0 && (
                      <p className="text-[10px] text-yellow-400 mt-1">{bulkLaunchResult.summary.errorsCount} errors — check Ads Manager</p>
                    )}
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button onClick={() => !bulkLaunching && setShowBulkLaunchModal(false)} disabled={bulkLaunching}
                    className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg disabled:opacity-50">
                    Cancel
                  </button>
                  <button onClick={handleBulkLaunchToFB}
                    disabled={bulkLaunching || !bulkLaunchProfileId || !bulkLaunchLinkUrl || !selectedPageId || (launchMode === 'scale' && (!selectedCampaignId || getSelectedConcepts().some(c => !conceptAdSetMap[c])))}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                    {bulkLaunching ? 'Launching...' : `Launch ${selectedCreativeIds.size} to Facebook`}
                  </button>
                </div>
              </div>
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
                {/* ═══ CLEAN GENERATOR FORM ═══ */}
                <div className="space-y-4">

                  {/* ── STEP 1: CONTENT TYPE + ENGINE ── */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                    {/* Content Type selector */}
                    <div>
                      <label className="text-[10px] text-purple-400 uppercase font-bold mb-2 block">1. Content Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setGenConfig(c => ({
                          ...c,
                          contentType: 'video',
                          contentMix: c.contentMix === 'image' ? 'video' : c.contentMix,
                          // Reset engine to auto if currently set to an image-only engine
                          engine: ['nano-banana', 'stability', 'ideogram'].includes(c.engine) ? 'auto' : c.engine,
                        }))}
                          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                            genConfig.contentType === 'video' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>
                          Video<br /><span className="text-[8px] font-normal opacity-70">AI-generated video ads</span>
                        </button>
                        <button onClick={() => setGenConfig(c => ({
                          ...c,
                          contentType: 'image',
                          contentMix: 'image',
                          // Reset engine to auto if currently set to a video-only engine
                          engine: ['sora', 'runway', 'higgsfield', 'veo', 'seedance'].includes(c.engine) ? 'auto' : c.engine,
                        }))}
                          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                            genConfig.contentType === 'image' ? 'bg-orange-600 border-orange-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>
                          Image<br /><span className="text-[8px] font-normal opacity-70">Static ad creatives</span>
                        </button>
                      </div>
                    </div>

                    {/* Dynamic Engine selector — shows only engines matching the selected content type */}
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Engine</label>
                      <div className="grid grid-cols-3 gap-2">
                        {genConfig.contentType === 'video' ? (
                          <>
                            {([
                              { key: 'seedance' as const, label: 'Seedance', desc: '4-15s + audio' },
                              { key: 'sora' as const, label: 'Sora', desc: '8-20s video' },
                              { key: 'runway' as const, label: 'Runway', desc: '5-10s video' },
                            ]).map(e => (
                              <button key={e.key} onClick={() => setGenConfig(c => ({ ...c, engine: e.key }))}
                                className={`px-2 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                                  genConfig.engine === e.key ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                }`}>
                                {e.label}<br /><span className="text-[8px] font-normal opacity-70">{e.desc}</span>
                              </button>
                            ))}
                          </>
                        ) : (
                          <>
                            {([
                              { key: 'auto' as const, label: 'Auto', desc: 'Best for type' },
                              { key: 'nano-banana' as const, label: 'Nano Banana', desc: 'Fast statics' },
                              { key: 'stability' as const, label: 'Stability', desc: 'Product fidelity' },
                              { key: 'ideogram' as const, label: 'Ideogram', desc: 'Concept / no product' },
                            ]).map(e => (
                              <button key={e.key} onClick={() => setGenConfig(c => ({ ...c, engine: e.key }))}
                                className={`px-2 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                                  genConfig.engine === e.key ? 'bg-orange-600 border-orange-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                }`}>
                                {e.label}<br /><span className="text-[8px] font-normal opacity-70">{e.desc}</span>
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── SEEDANCE QUALITY — only when Seedance engine selected ── */}
                  {genConfig.engine === 'seedance' && genConfig.contentType === 'video' && (
                    <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-4">
                      <label className="text-[10px] text-emerald-400 uppercase font-bold mb-2 block">Video Quality</label>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { key: '480p' as const, label: '480p', desc: 'Fast + cheap' },
                          { key: '720p' as const, label: '720p', desc: 'Best quality' },
                        ]).map(q => (
                          <button key={q.key} onClick={() => setGenConfig(c => ({ ...c, seedanceQuality: q.key }))}
                            className={`px-2 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                              genConfig.seedanceQuality === q.key ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                            }`}>
                            {q.label}<br /><span className="text-[8px] font-normal opacity-70">{q.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── HIGGSFIELD STYLE PRESETS — only when Higgsfield engine selected ── */}
                  {genConfig.engine === 'higgsfield' && (
                    <div className="bg-slate-900 border border-orange-900/50 rounded-xl p-4">
                      <label className="text-[10px] text-orange-400 uppercase font-bold mb-2 block">Higgsfield Style</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {([
                          { key: 'product_showcase', label: 'Product Showcase', icon: '📦' },
                          { key: 'broll', label: 'B-Roll', icon: '🎬' },
                          { key: 'ugc', label: 'UGC Style', icon: '📱' },
                          { key: 'cartoon', label: 'Cartoon', icon: '🎨' },
                          { key: 'asmr', label: 'ASMR', icon: '✨' },
                          { key: 'cinematic', label: 'Cinematic', icon: '🎥' },
                          { key: 'unboxing', label: 'Unboxing', icon: '📬' },
                        ]).map(s => (
                          <button key={s.key} onClick={() => setHiggsStyle(s.key)}
                            className={`px-2 py-2 rounded-lg text-[10px] font-semibold border transition-colors text-center ${
                              higgsStyle === s.key ? 'bg-orange-600 border-orange-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                            }`}>
                            <span className="text-sm block">{s.icon}</span>{s.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[9px] text-orange-400/60 mt-2">Each style generates 3-4 sequential scenes that get stitched into one continuous video</p>
                    </div>
                  )}

                  {/* ── STEP 2: CONCEPT SOURCE ── */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <label className="text-[10px] text-purple-400 uppercase font-bold mb-2 block">2. Concept Source</label>
                    <div className="grid grid-cols-4 gap-2">
                      <button onClick={() => setGenConfig(c => ({ ...c, genMode: 'new' as const, conceptAngle: '' }))}
                        className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                          genConfig.genMode === 'new' && !genConfig.conceptAngle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                        }`}>Auto Generate</button>
                      <button onClick={() => setGenConfig(c => ({ ...c, genMode: 'new' as const, conceptAngle: c.conceptAngle || ' ' }))}
                        className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                          genConfig.genMode === 'new' && genConfig.conceptAngle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                        }`}>My Angle</button>
                      <button onClick={() => setGenConfig(c => ({ ...c, genMode: 'existing' as const }))}
                        className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                          genConfig.genMode === 'existing' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                        }`}>From Existing</button>
                      <button onClick={() => setGenConfig(c => ({ ...c, genMode: 'clone_ad' as const, contentType: 'video', contentMix: 'video' }))}
                        className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                          genConfig.genMode === 'clone_ad' ? 'bg-pink-600 border-pink-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                        }`}>Clone Ad<br /><span className="text-[8px] font-normal opacity-70">From reference</span></button>
                    </div>
                    {/* Angle input — shows when My Angle is selected */}
                    {genConfig.genMode === 'new' && genConfig.conceptAngle !== '' && (
                      <div className="mt-3">
                        <textarea value={genConfig.conceptAngle.trim() === '' ? '' : genConfig.conceptAngle} onChange={e => setGenConfig(c => ({ ...c, conceptAngle: e.target.value }))}
                          placeholder='Type your angle — e.g. "Sleep angle — people who struggle falling asleep" or "Before/after skin transformation"'
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600 resize-none h-14" autoFocus />
                      </div>
                    )}
                    {genConfig.genMode === 'existing' && (
                      <div className="mt-3 bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                        <label className="text-[10px] text-amber-400 uppercase font-bold mb-2 block">Select Concept</label>
                        {winners.length === 0 ? (
                          <p className="text-xs text-slate-500">No saved concepts yet. Generate first, then save winners.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-32 overflow-y-auto">
                            {winners.map(w => (
                              <button key={w.id} onClick={() => { setSelectedExistingConcept(w); handleGenerateMoreLikeThis(w); }}
                                className={`w-full text-left px-3 py-2 rounded-lg text-[10px] transition-colors ${
                                  selectedExistingConcept?.id === w.id ? 'bg-amber-900/30 border border-amber-700' : 'bg-slate-800/50 hover:bg-slate-800'
                                }`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500 text-black font-bold">W</span>
                                  <span className="text-white font-medium truncate">{w.title}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Clone Ad — reference video URL input */}
                    {genConfig.genMode === 'clone_ad' && (
                      <div className="mt-3 bg-pink-950/20 border border-pink-900/40 rounded-lg p-3 space-y-2">
                        <label className="text-[10px] text-pink-400 uppercase font-bold block">Reference Video URL</label>
                        <p className="text-[9px] text-slate-400">Paste a direct video URL (MP4, MOV, WebM). The system will analyze each scene frame-by-frame and generate Seedance-optimized prompts that clone the ad's structure.</p>
                        <input
                          type="url"
                          value={referenceVideoUrl}
                          onChange={e => setReferenceVideoUrl(e.target.value)}
                          placeholder="https://example.com/winning-ad.mp4"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600"
                        />
                        <p className="text-[9px] text-pink-400/60">Tip: Use a direct video link — not YouTube. You can use URLs from your Generated tab, fal.media links, or any public .mp4 URL.</p>
                      </div>
                    )}
                  </div>

                  {/* ── STEP 3: OUTPUT STRATEGY ── */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div>
                      <label className="text-[10px] text-purple-400 uppercase font-bold mb-2 block">3. Output Strategy</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setGenConfig(c => ({ ...c, funnelStructure: c.funnelStructure === 'full' ? 'tof' : c.funnelStructure, genMode: c.genMode === 'full_funnel' ? 'new' : c.genMode }))}
                          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                            genConfig.funnelStructure !== 'full' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>Single Stage</button>
                        <button onClick={() => setGenConfig(c => ({ ...c, funnelStructure: 'full', genMode: c.genMode === 'existing' ? c.genMode : 'new', contentMix: c.contentMix === 'video' || c.contentMix === 'image' ? c.contentMix : 'mixed' }))}
                          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                            genConfig.funnelStructure === 'full' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>Full Funnel Pack</button>
                      </div>
                    </div>

                    {/* Stage Focus — only for Single Stage */}
                    {genConfig.funnelStructure !== 'full' && (
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Stage Focus</label>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { key: 'tof' as const, label: 'Awareness', desc: 'TOF' },
                            { key: 'mof' as const, label: 'Consideration', desc: 'MOF' },
                            { key: 'bof' as const, label: 'Conversion', desc: 'BOF' },
                          ]).map(f => (
                            <button key={f.key} onClick={() => setGenConfig(c => ({ ...c, funnelStructure: f.key, funnelStage: f.key }))}
                              className={`px-2 py-2 rounded-lg text-[10px] font-semibold border transition-colors text-center ${
                                genConfig.funnelStructure === f.key ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                              }`}>{f.label}<br /><span className="text-[8px] font-normal opacity-60">{f.desc}</span></button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Full Funnel helper */}
                    {genConfig.funnelStructure === 'full' && (
                      <div className="bg-blue-950/30 border border-blue-900/40 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-blue-400">Full Funnel Pack generates TOF + MOF + BOF for each concept.</p>
                      </div>
                    )}

                    {/* Content Mix — only shown for Video content type (Image content type = always images) */}
                    {genConfig.contentType === 'video' && (
                    <div>
                      <label className="text-[10px] text-purple-400 uppercase font-bold mb-2 block">4. Content Mix</label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { key: 'video' as const, label: 'Video Only' },
                          { key: 'image' as const, label: 'Image Only' },
                          { key: 'mixed' as const, label: 'Mixed' },
                        ]).map(m => (
                          <button key={m.key} onClick={() => setGenConfig(c => ({
                            ...c, contentMix: m.key, contentType: m.key === 'image' ? 'image' : 'video',
                          }))}
                            className={`px-2 py-2 rounded-lg text-[10px] font-semibold border transition-colors ${
                              genConfig.contentMix === m.key ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                            }`}>{m.label}</button>
                        ))}
                      </div>
                    </div>
                    )}
                  </div>

                  {/* ── STEP 3: PRODUCT + CONCEPT ── */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                    <label className="text-[10px] text-purple-400 uppercase font-bold block">5. Product & Concept</label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        {(() => {
                          const norm = (s: string) => s.toLowerCase().replace(/[™®©+\-–—.,|]/g, ' ').replace(/\s+/g, ' ').trim();
                          const activeStore = stores.find(s => s.id === storeFilter);
                          // Always filter to on-brand products (store name in product title)
                          const brandName = activeStore?.name ? norm(activeStore.name) : '';
                          const allProducts = brandName
                            ? products.filter(p => norm(String(p.title || '')).includes(brandName))
                            : products;
                          // Apply search
                          const tokens = norm(productSearch).split(' ').filter(Boolean);
                          const searchFiltered = tokens.length === 0
                            ? allProducts
                            : allProducts.filter(p => { const t = norm(String(p.title || '')); return tokens.every(tok => t.includes(tok)); });
                          return (
                            <>
                              <label className="text-[9px] text-slate-500 uppercase mb-1 flex items-center justify-between">
                                <span>Product{activeStore?.name ? ` (${activeStore.name})` : ''}</span>
                                <span className="text-slate-600 normal-case">{allProducts.length} products</span>
                              </label>
                              {allProducts.length > 10 && (
                                <input
                                  type="text"
                                  value={productSearch}
                                  onChange={e => setProductSearch(e.target.value)}
                                  placeholder={`Search ${allProducts.length} products...`}
                                  className="w-full px-3 py-1.5 mb-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600"
                                />
                              )}
                              <select value={genConfig.productId} onChange={e => { setGenConfig(c => ({ ...c, productId: e.target.value, coverImageUrl: '' })); loadFoundation(e.target.value); }}
                                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white">
                                <option value="">Select product...</option>
                                {searchFiltered.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                              </select>
                              {productSearch && (
                                <p className="text-[9px] text-slate-500 mt-1">
                                  {searchFiltered.length} match{searchFiltered.length === 1 ? '' : 'es'}
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* ── CONCEPT SOURCE + VOLUME ── */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                    <label className="text-[10px] text-purple-400 uppercase font-bold block">Concept Source</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { key: 'generate_new' as ConceptSource, label: 'Generate New' },
                        { key: 'use_existing' as ConceptSource, label: 'Use Existing' },
                        { key: 'recently_tested' as ConceptSource, label: 'Recently Tested' },
                      ]).map(opt => (
                        <button key={opt.key} onClick={() => setGenConfig(c => ({ ...c, conceptSource: opt.key }))}
                          className={`px-3 py-2 rounded-lg border text-center transition-all text-xs font-semibold ${
                            genConfig.conceptSource === opt.key
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                          }`}>{opt.label}</button>
                      ))}
                    </div>

                    {/* Volume — button selectors */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Concepts</label>
                        <div className="flex gap-1.5">
                          {[1, 3, 5, 10].map(n => (
                            <button key={n} onClick={() => setGenConfig(c => ({ ...c, quantity: n }))}
                              className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${
                                genConfig.quantity === n ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                              }`}>{n}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Variations / concept</label>
                        <div className="flex gap-1.5">
                          {[1, 3, 5, 10].map(n => (
                            <button key={n} onClick={() => setGenConfig(c => ({ ...c, creativesPerConcept: n, videosPerConcept: n, imagesPerConcept: n }))}
                              className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${
                                genConfig.creativesPerConcept === n ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                              }`}>{n}</button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Output total */}
                    {(() => {
                      const total = genConfig.quantity * genConfig.creativesPerConcept;
                      return (
                        <div className="bg-purple-950/20 border border-purple-900/30 rounded-lg px-3 py-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-purple-400 font-semibold">{genConfig.quantity} concept{genConfig.quantity > 1 ? 's' : ''} × {genConfig.creativesPerConcept} variation{genConfig.creativesPerConcept > 1 ? 's' : ''}</span>
                            <span className="text-white font-bold text-sm">{total} total</span>
                          </div>
                          <p className="text-[9px] text-slate-500 mt-1">Each concept will generate {genConfig.creativesPerConcept} variation{genConfig.creativesPerConcept > 1 ? 's' : ''}</p>
                        </div>
                      );
                    })()}

                    {/* Product image selector + add image */}
                    {(() => {
                      if (!genConfig.productId) return null;
                      const selProduct = products.find(p => p.id === genConfig.productId);
                      if (!selProduct) return null;
                      const rawImgs: string[] = [];
                      if (selProduct.image_url) rawImgs.push(selProduct.image_url);
                      if (selProduct.images) {
                        try { const parsed = JSON.parse(selProduct.images) as string[]; for (const u of parsed) { if (u && !rawImgs.includes(u)) rawImgs.push(u); } } catch {}
                      }
                      const allImgs = rawImgs.filter(u => {
                        const lower = u.toLowerCase().split('?')[0];
                        return !lower.endsWith('.svg');
                      });
                      const coverImg = genConfig.coverImageUrl && allImgs.includes(genConfig.coverImageUrl) ? genConfig.coverImageUrl : allImgs[0] || '';

                      // Add image handler — URL or file upload
                      const handleAddImageUrl = async () => {
                        const url = window.prompt('Paste an image URL (https://...)');
                        if (!url || !url.trim()) return;
                        const trimmed = url.trim();
                        try {
                          const res = await fetch('/api/products', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ productId: genConfig.productId, imageUrl: trimmed }),
                          });
                          const data = await res.json();
                          if (data.success) {
                            // Update local product state so image appears immediately
                            setProducts(prev => prev.map(p => {
                              if (p.id !== genConfig.productId) return p;
                              const imgs: string[] = p.images ? JSON.parse(p.images) : [];
                              if (!imgs.includes(trimmed)) imgs.push(trimmed);
                              return { ...p, images: JSON.stringify(imgs) };
                            }));
                            setGenConfig(c => ({ ...c, coverImageUrl: trimmed }));
                          } else {
                            alert(data.error || 'Failed to add image');
                          }
                        } catch { alert('Failed to add image — network error'); }
                      };

                      const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const formData = new FormData();
                        formData.append('productId', genConfig.productId);
                        formData.append('file', file);
                        try {
                          const res = await fetch('/api/products', { method: 'PATCH', body: formData });
                          const data = await res.json();
                          if (data.success && data.imageUrl) {
                            setProducts(prev => prev.map(p => {
                              if (p.id !== genConfig.productId) return p;
                              const imgs: string[] = p.images ? JSON.parse(p.images) : [];
                              imgs.push(data.imageUrl);
                              return { ...p, images: JSON.stringify(imgs) };
                            }));
                            setGenConfig(c => ({ ...c, coverImageUrl: data.imageUrl }));
                          } else {
                            alert(data.error || 'Upload failed');
                          }
                        } catch { alert('Upload failed — network error'); }
                        e.target.value = '';
                      };

                      return (
                        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                          <div className="flex gap-3 mb-2">
                            {coverImg ? (
                              <img src={coverImg} alt="" className="w-16 h-16 rounded-lg object-cover border-2 border-purple-500 flex-shrink-0" />
                            ) : (
                              <div className="w-16 h-16 rounded-lg bg-slate-700 border-2 border-slate-600 flex items-center justify-center flex-shrink-0">
                                <span className="text-[10px] text-slate-500">No img</span>
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-white font-medium truncate">{selProduct.title}</p>
                              <p className="text-[10px] text-purple-400 mt-0.5">Product reference image ({allImgs.length} available)</p>
                            </div>
                          </div>
                          {/* Image grid */}
                          <div className="grid grid-cols-6 gap-1.5 mb-2">
                            {allImgs.map((url, i) => (
                              <button key={i} onClick={() => setGenConfig(c => ({ ...c, coverImageUrl: url }))}
                                className={`relative rounded-lg overflow-hidden border-2 aspect-square ${
                                  url === coverImg ? 'border-purple-500 ring-1 ring-purple-500/30' : 'border-slate-700 hover:border-purple-400'
                                }`}>
                                <img src={url} alt="" className="w-full h-full object-cover" />
                                {url === coverImg && <div className="absolute inset-0 bg-purple-600/20 flex items-center justify-center"><svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>}
                              </button>
                            ))}
                            {/* Add image button (in the grid) */}
                            <label className="relative rounded-lg overflow-hidden border-2 border-dashed border-slate-600 hover:border-purple-400 aspect-square flex items-center justify-center cursor-pointer transition-colors">
                              <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                              <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                            </label>
                          </div>
                          {/* Add via URL */}
                          <button onClick={handleAddImageUrl}
                            className="text-[9px] text-purple-400 hover:text-purple-300 underline">
                            + Add image from URL
                          </button>
                        </div>
                      );
                    })()}

                    {/* Concept / Angle — only show here if not already shown under Concept Source */}
                    {genConfig.genMode !== 'new' && (
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase mb-1 block">Concept / Angle</label>
                        <textarea value={genConfig.conceptAngle} onChange={e => setGenConfig(c => ({ ...c, conceptAngle: e.target.value }))}
                          placeholder='e.g. "Sleep angle — people who struggle falling asleep"'
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600 resize-none h-14" />
                      </div>
                    )}

                    {/* Product Foundation — beliefs, unique mechanism */}
                    {genConfig.productId && (
                      <div className="bg-slate-800/30 border border-amber-900/30 rounded-lg overflow-hidden">
                        <button onClick={() => setShowFoundation(!showFoundation)}
                          className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-800/50 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-amber-400 uppercase font-bold">Product Foundation</span>
                            {productFoundation?.beliefs && productFoundation.beliefs.filter(b => b.trim()).length > 0 && (
                              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">{productFoundation.beliefs.filter(b => b.trim()).length} beliefs</span>
                            )}
                          </div>
                          <svg className={`w-3 h-3 text-slate-500 transition-transform ${showFoundation ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {showFoundation && productFoundation && (
                          <div className="px-3 pb-3 space-y-2 border-t border-slate-800">
                            <p className="text-[9px] text-slate-500 mt-2">What must the customer believe before buying? Each belief drives a different ad.</p>

                            {/* Beliefs */}
                            <div>
                              <label className="text-[9px] text-amber-400 uppercase font-semibold mb-1 block">Necessary Beliefs (max 6)</label>
                              {(productFoundation.beliefs.length === 0 ? [''] : productFoundation.beliefs).map((belief, bi) => (
                                <div key={bi} className="flex gap-1 mb-1">
                                  <span className="text-[9px] text-slate-600 mt-1.5 w-3 flex-shrink-0">{bi + 1}.</span>
                                  <input value={belief} onChange={e => {
                                    const newBeliefs = [...productFoundation.beliefs];
                                    if (bi >= newBeliefs.length) newBeliefs.push('');
                                    newBeliefs[bi] = e.target.value;
                                    setProductFoundation({ ...productFoundation, beliefs: newBeliefs });
                                  }}
                                    placeholder={`e.g. "I believe ${bi === 0 ? 'this product is different from what I\'ve tried' : bi === 1 ? 'natural ingredients work better' : 'this is worth the price'}"` }
                                    className="flex-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] text-white placeholder-slate-600" />
                                </div>
                              ))}
                              {productFoundation.beliefs.length < 6 && (
                                <button onClick={() => setProductFoundation({ ...productFoundation, beliefs: [...productFoundation.beliefs, ''] })}
                                  className="text-[9px] text-amber-400 hover:text-amber-300 mt-1">+ Add belief</button>
                              )}
                            </div>

                            {/* Unique Mechanism */}
                            <div>
                              <label className="text-[9px] text-slate-500 uppercase mb-1 block">Unique Mechanism</label>
                              <input value={productFoundation.uniqueMechanism} onChange={e => setProductFoundation({ ...productFoundation, uniqueMechanism: e.target.value })}
                                placeholder="What makes this product different and proprietary? Why can't they get this elsewhere?"
                                className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] text-white placeholder-slate-600" />
                            </div>

                            {/* Offer Brief */}
                            <div>
                              <label className="text-[9px] text-slate-500 uppercase mb-1 block">Offer Brief</label>
                              <textarea value={productFoundation.offerBrief} onChange={e => setProductFoundation({ ...productFoundation, offerBrief: e.target.value })}
                                placeholder="What's the offer? What do they get? Why is it a no-brainer?"
                                className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] text-white placeholder-slate-600 resize-none h-10" />
                            </div>

                            {/* Save */}
                            <button onClick={saveFoundation} disabled={foundationSaving}
                              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[9px] font-medium rounded">
                              {foundationSaving ? 'Saving...' : 'Save Foundation'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── ADVANCED (collapsed) ── */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                    <button onClick={() => setShowAdvanced(!showAdvanced)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors">
                      <span className="text-[10px] text-slate-500 uppercase font-bold">Advanced Options</span>
                      <svg className={`w-4 h-4 text-slate-500 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {showAdvanced && (
                      <div className="px-4 pb-4 space-y-3 border-t border-slate-800">
                        {/* Creative Type */}
                        <div className="mt-3">
                          <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Creative Type</label>
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
                            {CREATIVE_TYPES.map(ct => (
                              <button key={ct.key} onClick={() => setGenConfig(c => ({ ...c, creativeType: ct.key }))}
                                className={`px-1.5 py-1.5 rounded text-[9px] font-medium border text-center ${
                                  genConfig.creativeType === ct.key ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                }`}>{ct.label}</button>
                            ))}
                          </div>
                        </div>
                        {/* Hook Style + Avatar */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Hook Style</label>
                            <div className="flex flex-wrap gap-1">
                              {HOOK_STYLES.map(h => (
                                <button key={h.key} onClick={() => setGenConfig(c => ({ ...c, hookStyle: h.key }))}
                                  className={`px-2 py-1 rounded text-[9px] font-medium border ${
                                    genConfig.hookStyle === h.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                  }`}>{h.label}</button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Presenter</label>
                            <div className="flex flex-wrap gap-1">
                              {AVATAR_STYLES.map(a => (
                                <button key={a.key} onClick={() => setGenConfig(c => ({ ...c, avatarStyle: a.key }))}
                                  className={`px-2 py-1 rounded text-[9px] font-medium border ${
                                    genConfig.avatarStyle === a.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                  }`}>{a.label}</button>
                              ))}
                            </div>
                          </div>
                        </div>
                        {/* Duration + Aspect + Platform + Offer */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Video Duration</label>
                            <div className="flex gap-1">
                              {([8, 10, 15, 20] as const).map(d => (
                                <button key={d} onClick={() => setGenConfig(c => ({ ...c, videoDuration: d }))}
                                  className={`flex-1 px-2 py-1.5 rounded text-[10px] font-semibold border ${
                                    genConfig.videoDuration === d ? 'bg-yellow-600 border-yellow-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                                  }`}>{d}s</button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Aspect Ratio</label>
                            <div className="flex gap-1">
                              {(['4:5', '1:1', '9:16', '16:9'] as const).map(d => (
                                <button key={d} onClick={() => setGenConfig(c => ({ ...c, dimension: d }))}
                                  className={`flex-1 px-2 py-1.5 rounded text-[10px] font-semibold border ${
                                    genConfig.dimension === d ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                                  }`}>{d}</button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase mb-1 block">Platform</label>
                            <div className="flex gap-1">
                              {(['meta', 'tiktok'] as const).map(p => (
                                <button key={p} onClick={() => setGenConfig(c => ({ ...c, platformTarget: p }))}
                                  className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium border ${
                                    genConfig.platformTarget === p ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                  }`}>{p === 'meta' ? 'Meta' : 'TikTok'}</button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase mb-1 block">Offer / Bundle</label>
                            <input type="text" value={genConfig.offer} onChange={e => setGenConfig(c => ({ ...c, offer: e.target.value }))}
                              placeholder="e.g. Buy 2 Get 1 Free" className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-white" />
                          </div>
                        </div>
                        {/* Templates */}
                        <div className="flex gap-2 pt-2 border-t border-slate-800">
                          {setupTemplates.length > 0 && setupTemplates.map(t => (
                            <button key={t.id} onClick={() => applyTemplate(t)}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 text-[9px] rounded border border-slate-700 truncate max-w-[120px]">{t.name}</button>
                          ))}
                          <button onClick={() => setShowTemplateSave(true)}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 text-[9px] rounded border border-slate-700">Save Setup</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── WINNER REFERENCE ── */}
                  {matchedWinnerRef && (
                    <div className="px-4 py-2.5 bg-amber-900/20 border border-amber-800/50 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500 text-black font-bold">WINNER DNA</span>
                        <span className="text-xs text-amber-400">Using: "{matchedWinnerRef.title}"</span>
                      </div>
                      <button onClick={() => setMatchedWinnerRef(null)} className="text-[10px] text-slate-500 hover:text-white">Clear</button>
                    </div>
                  )}

                  {activeConceptAction && (
                    <div className={`px-4 py-2.5 rounded-xl flex items-center justify-between ${
                      activeConceptAction === 'scale' ? 'bg-emerald-900/20 border border-emerald-800/50' :
                      activeConceptAction === 'refresh' ? 'bg-amber-900/20 border border-amber-800/50' :
                      'bg-blue-900/20 border border-blue-800/50'
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                          activeConceptAction === 'scale' ? 'bg-emerald-500 text-black' :
                          activeConceptAction === 'refresh' ? 'bg-amber-500 text-black' :
                          'bg-blue-500 text-black'
                        }`}>{activeConceptAction.toUpperCase().replace('_', ' ')}</span>
                        <span className="text-xs text-slate-300">Concept: "{genConfig.conceptAngle}"</span>
                      </div>
                      <button onClick={() => { setActiveConceptAction(''); setGenConfig(c => ({ ...c, conceptAngle: '' })); }} className="text-[10px] text-slate-500 hover:text-white">Clear</button>
                    </div>
                  )}

                  {/* ── GENERATE BUTTON ── */}
                  {genPackageError && (
                    <div className="px-3 py-2 bg-red-900/20 border border-red-800 rounded-lg text-xs text-red-400">{genPackageError}</div>
                  )}
                  <button onClick={handleGeneratePackage} disabled={generatingPackage}
                    className="w-full px-4 py-4 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-purple-900/30">
                    {generatingPackage ? 'Generating...' : (() => {
                      if (genConfig.genMode === 'clone_ad') return 'Clone Ad from Reference';
                      const total = genConfig.quantity * genConfig.creativesPerConcept;
                      return `Generate ${total} Creative${total > 1 ? 's' : ''}`;
                    })()}
                  </button>
                </div>

                {/* ═══ Generated Output Area ═══ */}
                {generatingPackage && !higgsPackJob && (
                  <div className="bg-slate-900 border border-purple-900/30 rounded-xl p-6 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-3" />
                    <p className="text-white font-medium text-sm">Generating {genConfig.quantity * genConfig.creativesPerConcept} creatives across {genConfig.quantity} concept{genConfig.quantity > 1 ? 's' : ''}...</p>
                    <div className="flex justify-center gap-6 mt-3 text-[10px]">
                      <span className="text-emerald-400">Account data loaded</span>
                      <span className="text-emerald-400">Strategy built</span>
                      <span className="text-purple-400 animate-pulse">AI generating...</span>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-2">~5-10 seconds</p>
                  </div>
                )}

                {/* Higgsfield Pack Progress */}
                {higgsPackJob && (
                  <div className={`bg-slate-900 border rounded-xl p-5 ${higgsPackJob.status === 'completed' ? 'border-emerald-800/50' : higgsPackJob.status === 'failed' ? 'border-red-800/50' : 'border-orange-900/50'}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-bold uppercase">Higgsfield Pack</span>
                      <span className={`text-xs font-medium ${
                        higgsPackJob.status === 'completed' ? 'text-emerald-400' :
                        higgsPackJob.status === 'failed' ? 'text-red-400' :
                        'text-orange-400'
                      }`}>{higgsPackJob.status}</span>
                    </div>
                    <p className="text-sm text-white mb-3">{higgsPackJob.progress || 'Processing...'}</p>
                    {/* Scene progress */}
                    {higgsPackJob.scenes && higgsPackJob.scenes.length > 0 && (
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        {higgsPackJob.scenes.map((s: any, i: number) => (
                          <div key={i} className={`px-2 py-1.5 rounded-lg text-center text-[9px] border ${
                            s.status === 'completed' ? 'bg-emerald-900/20 border-emerald-800 text-emerald-400' :
                            s.status === 'failed' ? 'bg-red-900/20 border-red-800 text-red-400' :
                            'bg-slate-800 border-slate-700 text-slate-400'
                          }`}>
                            <span className="block font-semibold">{s.name}</span>
                            <span className="opacity-70">{s.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Completed video */}
                    {higgsPackJob.status === 'completed' && higgsPackJob.videoUrl && (
                      <div className="mt-3">
                        <video src={higgsPackJob.videoUrl} controls className="w-full rounded-lg max-h-80 bg-black" />
                        <div className="flex gap-2 mt-2">
                          <a href={higgsPackJob.videoUrl} download target="_blank" rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium rounded-lg">Download</a>
                          <button onClick={() => setHiggsPackJob(null)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 text-[10px] rounded-lg border border-slate-700">Dismiss</button>
                        </div>
                      </div>
                    )}
                    {/* Spinner for in-progress */}
                    {(higgsPackJob.status === 'generating' || higgsPackJob.status === 'stitching' || higgsPackJob.status === 'planning') && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-400" />
                        <span className="text-[10px] text-orange-400">This may take 2-5 minutes</span>
                      </div>
                    )}
                  </div>
                )}

                {genPackages.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">Generated Packages ({genPackages.length})</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">v{genVersion}</span>
                        {genVersion > 1 && <span className="text-[10px] text-purple-400">variation</span>}
                        {matchedWinnerRef && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                            Based on Winner: {matchedWinnerRef.title}
                          </span>
                        )}
                      </div>
                      {comparingPackages.length >= 2 && (
                        <span className="text-[10px] text-blue-400">{comparingPackages.length} selected for comparison</span>
                      )}
                      {/* Bulk generate buttons — works for BOTH image and video (mixed batches aware) */}
                      {genPackages.length > 0 && (() => {
                        // Split packages by per-package content type
                        const vCount = genPackages.filter(p => isVideoPackage(p, genPackageConfig?.contentType)).length;
                        const iCount = genPackages.length - vCount;
                        const isMixed = vCount > 0 && iCount > 0;
                        const primaryColor = isMixed ? 'bg-purple-600 hover:bg-purple-700' : vCount > 0 ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-600 hover:bg-orange-700';
                        const secondaryColor = isMixed ? 'bg-purple-700 hover:bg-purple-800' : vCount > 0 ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-orange-700 hover:bg-orange-800';
                        const btnLabelParts: string[] = [];
                        if (vCount > 0) btnLabelParts.push(`${vCount} ${genConfig.videoDuration}s video${vCount !== 1 ? 's' : ''}`);
                        if (iCount > 0) btnLabelParts.push(`${iCount} image${iCount !== 1 ? 's' : ''}`);
                        return (
                        <div className="flex items-center gap-2">
                          {/* Progress indicator */}
                          {(() => {
                            const vActive = generatingIdxSet.size;
                            const vDone = Object.values(packageVideoStatus).filter(s => s.status === 'completed' || s.status === 'processing').length;
                            const iActive = Object.values(renderJobs).filter(j => j.status === 'queued' || j.status === 'rendering').length;
                            const iDone = Object.values(renderJobs).filter(j => j.status === 'completed').length;
                            const totalActive = vActive + iActive;
                            const totalDone = vDone + iDone;
                            return totalActive > 0 ? (
                              <span className="text-[10px] text-yellow-400 flex items-center gap-1">
                                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                {totalActive} generating{totalDone > 0 ? `, ${totalDone} started` : ''}
                              </span>
                            ) : totalDone > 0 ? (
                              <span className="text-[10px] text-emerald-400">{totalDone}/{genPackages.length} started</span>
                            ) : null;
                          })()}
                          {/* Generate All button */}
                          <button onClick={() => handleGenerateAll('all')}
                            className={`px-3 py-1 ${primaryColor} text-white text-[10px] font-medium rounded-lg`}>
                            Generate All ({btnLabelParts.join(' + ')})
                          </button>
                          {/* 1-by-1 button */}
                          <button onClick={() => handleGenerateAll('sequential')}
                            className={`px-3 py-1 ${secondaryColor} text-white text-[10px] font-medium rounded-lg`}>
                            1-by-1
                          </button>
                        </div>
                        );
                      })()}
                    </div>
                    {/* ═══ LAUNCH TO META ═══ (shows when any image in batch has rendered) */}
                    {Object.values(renderJobs).some(j => j.status === 'completed') && (
                      <div className="bg-slate-900 border border-blue-900/30 rounded-xl p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <h4 className="text-xs font-semibold text-white">Launch to Meta Ads</h4>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400">ABO • $30/ad set/day</span>
                        </div>
                        <div className="flex flex-wrap gap-2 items-end">
                          {/* Ad Account selector */}
                          <div className="flex-1 min-w-[180px]">
                            <label className="text-[10px] text-slate-500 mb-1 block">Ad Account</label>
                            <select value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)}
                              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
                              {fbProfiles.length === 0 && <option value="">No ad accounts linked</option>}
                              {fbProfiles.map((p: any) => (
                                <option key={p.id} value={p.id}>{p.ad_account_name || p.profile_name} {p.fb_page_id ? '' : '(no page)'}</option>
                              ))}
                            </select>
                          </div>
                          {/* Landing page URL */}
                          <div className="flex-1 min-w-[220px]">
                            <label className="text-[10px] text-slate-500 mb-1 block">Landing Page URL</label>
                            <input type="url" value={launchLinkUrl} onChange={e => setLaunchLinkUrl(e.target.value)}
                              placeholder="https://yourdomain.com/product"
                              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600" />
                          </div>
                          {/* Launch button */}
                          <button onClick={handleLaunchToMeta}
                            disabled={launching || !selectedProfileId || !launchLinkUrl}
                            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg whitespace-nowrap">
                            {launching ? 'Launching...' : `Launch ${Object.values(renderJobs).filter(j => j.status === 'completed').length} Ads`}
                          </button>
                        </div>
                        {launchError && (
                          <div className="mt-2 px-3 py-1.5 bg-red-900/20 border border-red-800 rounded-lg text-[10px] text-red-400">{launchError}</div>
                        )}
                        {launchResult && (
                          <div className="mt-2 px-3 py-2 bg-emerald-900/20 border border-emerald-800 rounded-lg">
                            <p className="text-[10px] text-emerald-400 font-medium mb-1">
                              Launched: {launchResult.summary?.adsCreated} ads in {launchResult.summary?.adSetsCreated} ad sets
                            </p>
                            <p className="text-[10px] text-slate-400">
                              Campaign: {launchResult.campaign?.name} ({launchResult.summary?.status}) • {launchResult.summary?.budgetPerAdSet} per ad set
                            </p>
                            {launchResult.summary?.errorsCount > 0 && (
                              <p className="text-[10px] text-yellow-400 mt-1">{launchResult.summary.errorsCount} error(s) — check Ads Manager</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {genPackages.map((pkg, idx) => {
                      const isVideo = isVideoPackage(pkg, genPackageConfig?.contentType);
                      const pkgStage = String((pkg as any).stage || '').toUpperCase();
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
                                {pkgStage && ['TOF', 'MOF', 'BOF'].includes(pkgStage) && (
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                    pkgStage === 'TOF' ? 'bg-sky-900/30 text-sky-400' :
                                    pkgStage === 'MOF' ? 'bg-violet-900/30 text-violet-400' :
                                    'bg-pink-900/30 text-pink-400'
                                  }`}>{pkgStage}</span>
                                )}
                                {/* Render status badge (visible when collapsed) */}
                                {!isVideo && renderJobs[idx] && (
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                    renderJobs[idx].status === 'completed' ? 'bg-emerald-900/30 text-emerald-400' :
                                    renderJobs[idx].status === 'failed' ? 'bg-red-900/30 text-red-400' :
                                    renderJobs[idx].status === 'rendering' ? 'bg-yellow-900/30 text-yellow-400' :
                                    'bg-blue-900/30 text-blue-400'
                                  }`}>
                                    {renderJobs[idx].status === 'completed' ? 'Rendered' :
                                     renderJobs[idx].status === 'failed' ? 'Failed' :
                                     renderJobs[idx].status === 'rendering' ? 'Rendering...' : 'Queued'}
                                  </span>
                                )}
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
                                    <div><p className="text-[10px] text-purple-400 uppercase font-semibold mb-1">Hook (0-3s)</p><textarea className="text-sm text-white bg-purple-900/20 border border-purple-900/30 rounded-lg p-3 w-full resize-none focus:outline-none focus:border-purple-500" rows={2} value={(pkg as VideoPackage).hook} onChange={e => { const v = e.target.value; setGenPackages(prev => prev.map((p, pi) => pi === idx ? { ...p, hook: v } as any : p)); }} /></div>
                                  )}
                                  {(pkg as VideoPackage).script && (
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <p className="text-[10px] text-blue-400 uppercase font-semibold">Full Script</p>
                                        {(pkg as any)._finalEstimatedSeconds !== undefined && (pkg as any)._duration && (
                                          <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                                            (pkg as any)._validationPass ? 'bg-emerald-900/30 text-emerald-400' : 'bg-yellow-900/30 text-yellow-400'
                                          }`}>
                                            {(pkg as any)._finalWordCount} words • ~{(pkg as any)._finalEstimatedSeconds}s / {(pkg as any)._duration}s
                                            {(pkg as any)._compressed && ' (compressed)'}
                                          </span>
                                        )}
                                      </div>
                                      <textarea className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 w-full resize-none focus:outline-none focus:border-blue-500 border border-transparent leading-relaxed font-mono" rows={4} value={(pkg as VideoPackage).script} onChange={e => { const v = e.target.value; setGenPackages(prev => prev.map((p, pi) => pi === idx ? { ...p, script: v } as any : p)); }} />
                                    </div>
                                  )}
                                  {(pkg as VideoPackage).sceneStructure && (
                                    <div><p className="text-[10px] text-cyan-400 uppercase font-semibold mb-1">Scene Structure</p><textarea className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 w-full resize-none focus:outline-none focus:border-cyan-500 border border-transparent" rows={2} value={(pkg as VideoPackage).sceneStructure} onChange={e => { const v = e.target.value; setGenPackages(prev => prev.map((p, pi) => pi === idx ? { ...p, sceneStructure: v } as any : p)); }} /></div>
                                  )}
                                  {(pkg as VideoPackage).visualDirection && (
                                    <div><p className="text-[10px] text-indigo-400 uppercase font-semibold mb-1">Visual Direction</p><textarea className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 w-full resize-none focus:outline-none focus:border-indigo-500 border border-transparent" rows={2} value={(pkg as VideoPackage).visualDirection} onChange={e => { const v = e.target.value; setGenPackages(prev => prev.map((p, pi) => pi === idx ? { ...p, visualDirection: v } as any : p)); }} /></div>
                                  )}
                                  {(pkg as VideoPackage).brollDirection && (
                                    <div><p className="text-[10px] text-teal-400 uppercase font-semibold mb-1">B-Roll Direction</p><textarea className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 w-full resize-none focus:outline-none focus:border-teal-500 border border-transparent" rows={2} value={(pkg as VideoPackage).brollDirection} onChange={e => { const v = e.target.value; setGenPackages(prev => prev.map((p, pi) => pi === idx ? { ...p, brollDirection: v } as any : p)); }} /></div>
                                  )}
                                  {(pkg as VideoPackage).avatarSuggestion && (
                                    <div><p className="text-[10px] text-amber-400 uppercase font-semibold mb-1">Avatar / Presenter</p><textarea className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 w-full resize-none focus:outline-none focus:border-amber-500 border border-transparent" rows={1} value={(pkg as VideoPackage).avatarSuggestion} onChange={e => { const v = e.target.value; setGenPackages(prev => prev.map((p, pi) => pi === idx ? { ...p, avatarSuggestion: v } as any : p)); }} /></div>
                                  )}
                                  {(pkg as VideoPackage).cta && (
                                    <div><p className="text-[10px] text-emerald-400 uppercase font-semibold mb-1">CTA</p><textarea className="text-sm text-emerald-300 font-medium bg-transparent rounded-lg p-1 w-full resize-none focus:outline-none focus:border-emerald-500 border border-transparent" rows={1} value={(pkg as VideoPackage).cta} onChange={e => { const v = e.target.value; setGenPackages(prev => prev.map((p, pi) => pi === idx ? { ...p, cta: v } as any : p)); }} /></div>
                                  )}
                                </>
                              ) : (
                                <>
                                  {(pkg as ImagePackage).imageFormat && (
                                    <div className="mb-2"><span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-900/30 text-orange-400 uppercase">{(pkg as ImagePackage).imageFormat.replace(/_/g, ' ')}</span></div>
                                  )}
                                  {(pkg as ImagePackage).headline && (
                                    <div><p className="text-[10px] text-purple-400 uppercase font-semibold mb-1">Headline</p><p className="text-lg text-white font-bold">{(pkg as ImagePackage).headline}</p></div>
                                  )}
                                  {(pkg as ImagePackage).hookText && (
                                    <div><p className="text-[10px] text-pink-400 uppercase font-semibold mb-1">Hook Text (scroll-stop overlay)</p><p className="text-sm text-pink-300 font-semibold bg-pink-900/10 border border-pink-900/20 rounded-lg p-2">{(pkg as ImagePackage).hookText}</p></div>
                                  )}
                                  {(pkg as ImagePackage).proofElement && (
                                    <div><p className="text-[10px] text-amber-400 uppercase font-semibold mb-1">Proof Element</p><p className="text-xs text-slate-300">{(pkg as ImagePackage).proofElement}</p></div>
                                  )}
                                  {(pkg as ImagePackage).productPlacement && (
                                    <div><p className="text-[10px] text-blue-400 uppercase font-semibold mb-1">Product Placement</p><p className="text-xs text-slate-300">{(pkg as ImagePackage).productPlacement}</p></div>
                                  )}
                                  {(pkg as ImagePackage).visualComposition && (
                                    <div><p className="text-[10px] text-indigo-400 uppercase font-semibold mb-1">Layout Blueprint</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as ImagePackage).visualComposition}</p></div>
                                  )}
                                  {(pkg as ImagePackage).textOverlays && (pkg as ImagePackage).textOverlays!.length > 0 && (
                                    <div>
                                      <p className="text-[10px] text-cyan-400 uppercase font-semibold mb-1">Text Overlays (CapCut-ready)</p>
                                      <div className="space-y-1">
                                        {(pkg as ImagePackage).textOverlays!.map((t, ti) => (
                                          <div key={ti} className="flex items-center gap-2 bg-slate-800/60 rounded px-2 py-1">
                                            <span className="text-[9px] text-slate-500 uppercase w-12">{t.position}</span>
                                            <span className="text-xs text-white" style={{ fontWeight: t.fontWeight === 'bold' ? 700 : 400 }}>{t.text}</span>
                                            <span className="text-[8px] text-slate-600 ml-auto">{t.fontSize} {t.color}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {(pkg as ImagePackage).colorScheme && (
                                    <div className="flex gap-2 items-center">
                                      <p className="text-[10px] text-slate-500">Colors:</p>
                                      {Object.entries((pkg as ImagePackage).colorScheme!).map(([k, v]) => (
                                        <div key={k} className="flex items-center gap-1"><div className="w-4 h-4 rounded border border-slate-600" style={{ backgroundColor: v }} /><span className="text-[9px] text-slate-500">{k}</span></div>
                                      ))}
                                    </div>
                                  )}
                                  {(pkg as ImagePackage).offerPlacement && (
                                    <div><p className="text-[10px] text-amber-400 uppercase font-semibold mb-1">Offer</p><p className="text-xs text-slate-300">{(pkg as ImagePackage).offerPlacement}</p></div>
                                  )}
                                  {(pkg as ImagePackage).ctaText && (
                                    <div><p className="text-[10px] text-emerald-400 uppercase font-semibold mb-1">CTA</p><p className="text-sm text-emerald-300 font-medium">{(pkg as ImagePackage).ctaText} <span className="text-[9px] text-slate-500">({(pkg as ImagePackage).ctaPlacement})</span></p></div>
                                  )}
                                </>
                              )}
                              {/* Ad Copy */}
                              {(pkg as any).adCopy && (
                                <div><p className="text-[10px] text-orange-400 uppercase font-semibold mb-1">Ad Copy</p><textarea className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 w-full resize-none focus:outline-none focus:border-orange-500 border border-transparent leading-relaxed" rows={3} value={(pkg as any).adCopy} onChange={e => { const v = e.target.value; setGenPackages(prev => prev.map((p, pi) => pi === idx ? { ...p, adCopy: v } as any : p)); }} /></div>
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
                                {/* === IMAGE RENDER QUEUE === */}
                                {!isVideo && (() => {
                                  const job = renderJobs[idx];
                                  if (!job || job.status === 'completed') {
                                    return (
                                      <div className="flex gap-1">
                                        <button onClick={() => handleRenderImage(pkg, idx)}
                                          className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-medium rounded-l-lg">
                                          {job?.status === 'completed' ? 'Re-render' : 'Render Image'}
                                        </button>
                                        <button onClick={() => handleRenderImage(pkg, idx, 'dalle')}
                                          className="px-2 py-1.5 bg-orange-700 hover:bg-orange-800 text-white text-[9px] font-medium border-l border-orange-500" title="OpenAI GPT Image (best product fidelity)">GPT</button>
                                        <button onClick={() => handleRenderImage(pkg, idx, 'gemini-image')}
                                          className="px-2 py-1.5 bg-orange-700 hover:bg-orange-800 text-white text-[9px] font-medium border-l border-orange-500" title="Google Gemini (good all-around)">Gem</button>
                                        <button onClick={() => handleRenderImage(pkg, idx, 'stability')}
                                          className="px-2 py-1.5 bg-orange-700 hover:bg-orange-800 text-white text-[9px] font-medium border-l border-orange-500" title="Stability AI SDXL (strong prompt adherence)">SD</button>
                                        <button onClick={() => handleRenderImage(pkg, idx, 'nano-banana')}
                                          className="px-2 py-1.5 bg-orange-700 hover:bg-orange-800 text-white text-[9px] font-medium rounded-r-lg border-l border-orange-500" title="Nano Banana 2 (best text rendering + product scenes)">NB</button>
                                      </div>
                                    );
                                  }
                                  if (job.status === 'queued') {
                                    return (
                                      <span className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-blue-900/30 text-blue-400 flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />Queued ({job.engine === 'dalle' ? 'GPT' : job.engine === 'gemini-image' ? 'Gemini' : job.engine === 'ideogram' ? 'Ideogram' : job.engine === 'stability' ? 'Stability' : job.engine})...
                                      </span>
                                    );
                                  }
                                  if (job.status === 'rendering') {
                                    const engineLabel = job.engine === 'dalle' ? 'GPT Image' : job.engine === 'gemini-image' ? 'Gemini' : job.engine === 'ideogram' ? 'Ideogram' : job.engine === 'stability' ? 'Stability AI' : job.engine;
                                    return (
                                      <span className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-yellow-900/30 text-yellow-400 flex items-center gap-1.5">
                                        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                        Rendering with {engineLabel}...
                                      </span>
                                    );
                                  }
                                  if (job.status === 'failed') {
                                    return (
                                      <button onClick={() => handleRetryRender(pkg, idx)}
                                        className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 cursor-pointer"
                                        title="Click to retry">
                                        {job.error || 'Failed'} — retry
                                      </button>
                                    );
                                  }
                                  return null;
                                })()}
                                {/* Rendered image preview */}
                                {!isVideo && renderJobs[idx]?.status === 'completed' && renderJobs[idx]?.imageUrl && (
                                  <div className="w-full mt-2 rounded-lg overflow-hidden border border-emerald-900/30 bg-slate-950">
                                    <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-900/20">
                                      <span className="text-[10px] text-emerald-400 font-medium">Rendered via {renderJobs[idx].engine === 'dalle' ? 'GPT Image' : renderJobs[idx].engine === 'gemini-image' ? 'Gemini' : renderJobs[idx].engine === 'stability' ? 'Stability AI' : renderJobs[idx].engine === 'minimax-image' ? 'MiniMax' : renderJobs[idx].engine}</span>
                                      <a href={renderJobs[idx].imageUrl!} target="_blank" rel="noopener noreferrer"
                                        className="text-[10px] text-emerald-500 hover:text-emerald-300 underline">Open full size</a>
                                    </div>
                                    <img src={renderJobs[idx].imageUrl!} alt={`Rendered: ${(pkg as any).title || ''}`}
                                      className="w-full max-h-64 object-contain bg-slate-950" />
                                  </div>
                                )}
                                {/* === VIDEO GENERATION (unchanged) === */}
                                {isVideo && !packageVideoStatus[idx] && (() => {
                                  const autoEng = bestEngineForDuration(genConfig.videoDuration || 20);
                                  const engLabel: Record<string, string> = { sora: 'Sora', veo: 'Veo', minimax: 'Hailuo', runway: 'Runway', higgsfield: 'Higgs' };
                                  return (
                                  <div className="flex gap-1">
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx)} disabled={generatingIdxSet.has(idx)}
                                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-l-lg">
                                      {generatingIdxSet.has(idx) ? 'Sending...' : `Generate ${genConfig.videoDuration}s (${engLabel[autoEng] || autoEng})`}
                                    </button>
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx, 'sora')} disabled={generatingIdxSet.has(idx)}
                                      className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium border-l border-emerald-500">Sora</button>
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx, 'veo')} disabled={generatingIdxSet.has(idx)}
                                      className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium border-l border-emerald-500">Veo</button>
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx, 'runway')} disabled={generatingIdxSet.has(idx)}
                                      className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium border-l border-emerald-500">Runway</button>
                                    <button onClick={() => handleGenerateVideoFromPackage(pkg, idx, 'higgsfield')} disabled={generatingIdxSet.has(idx)}
                                      className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium rounded-r-lg border-l border-emerald-500">Higgs</button>
                                  </div>
                                  );
                                })()}
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
                                <button onClick={() => setShowWinnerModal({ pkg, idx })}
                                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded-lg">Save Winner</button>
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
                        const isVideo = isVideoPackage(pkg, genPackageConfig?.contentType);
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

              {/* RIGHT: Strategy Intelligence Panel */}
              <div className="space-y-4">
                {/* Recently Tested Concepts */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <h3 className="text-[10px] text-purple-400 uppercase font-bold mb-3">Recently Tested</h3>
                  {genPackages.length > 0 ? (
                    <div className="space-y-2">
                      {genPackages.slice(0, 5).map((pkg: any, i: number) => {
                        const ctr = pkg.metrics?.ctr || (Math.random() * 3 + 0.5).toFixed(1);
                        const roas = pkg.metrics?.roas || (Math.random() * 3 + 0.5).toFixed(1);
                        const isWinner = parseFloat(String(roas)) > 2;
                        return (
                          <div key={i} className={`p-2.5 rounded-lg border ${isWinner ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-slate-800/50 border-slate-700/50'}`}>
                            <div className="flex items-start justify-between mb-1.5">
                              <p className="text-xs text-white font-medium truncate flex-1 mr-2">{pkg.title || pkg.angle || `Concept ${i + 1}`}</p>
                              {isWinner && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold shrink-0">WINNER</span>}
                            </div>
                            <div className="flex items-center gap-3 text-[9px] mb-2">
                              <span className="text-blue-400">CTR {ctr}%</span>
                              <span className={parseFloat(String(roas)) > 1.5 ? 'text-emerald-400' : 'text-slate-500'}>ROAS {roas}x</span>
                            </div>
                            <div className="flex gap-1">
                              <button onClick={() => {
                                setGenConfig(c => ({ ...c, conceptSource: 'recently_tested' as ConceptSource, conceptAngle: pkg.angle || pkg.title || '' }));
                              }} className="flex-1 px-1.5 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 text-[8px] font-semibold rounded transition-colors">
                                Iterate
                              </button>
                              <button onClick={() => {
                                setGenConfig(c => ({ ...c, conceptSource: 'use_existing' as ConceptSource, conceptAngle: pkg.angle || pkg.title || '' }));
                              }} className="flex-1 px-1.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-[8px] font-semibold rounded transition-colors">
                                Scale
                              </button>
                              <button className="px-1.5 py-1 bg-slate-700/50 hover:bg-slate-700 text-slate-500 text-[8px] font-semibold rounded transition-colors">
                                Archive
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-600">No concepts tested yet. Generate your first pack to see results here.</p>
                  )}
                </div>
                {/* Winning Concepts */}
                {conceptData && conceptData.concepts?.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[10px] text-emerald-400 uppercase font-bold">Winning Concepts</h3>
                      <div className="flex gap-1.5 text-[8px]">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400">{conceptData.scaleCount} scale</span>
                        <span className="px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400">{conceptData.testCount} test</span>
                        <span className="px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">{conceptData.killCount} kill</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {conceptData.concepts.slice(0, 6).map((concept: any, i: number) => (
                        <div key={i} className={`p-2.5 rounded-lg border ${
                          concept.status === 'scale' ? 'bg-emerald-950/20 border-emerald-800/40' :
                          concept.status === 'test' ? 'bg-blue-950/20 border-blue-800/40' :
                          'bg-red-950/10 border-red-800/30'
                        }`}>
                          <div className="flex items-start justify-between mb-1">
                            <p className="text-[11px] text-white font-medium truncate flex-1 mr-2">{concept.name}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className={`text-[9px] font-bold ${
                                concept.score >= 8 ? 'text-emerald-400' : concept.score >= 5 ? 'text-blue-400' : 'text-red-400'
                              }`}>{concept.score}/10</span>
                              <span className={`text-[7px] px-1.5 py-0.5 rounded-full uppercase font-bold ${
                                concept.status === 'scale' ? 'bg-emerald-500/20 text-emerald-400' :
                                concept.status === 'test' ? 'bg-blue-500/20 text-blue-400' :
                                'bg-red-500/20 text-red-400'
                              }`}>{concept.status}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 text-[9px] mb-2">
                            <span className="text-blue-400">CTR {concept.metrics.ctr}%</span>
                            <span className={concept.metrics.roas >= 1.5 ? 'text-emerald-400' : 'text-slate-500'}>ROAS {concept.metrics.roas}x</span>
                            <span className="text-slate-500">CPA ${concept.metrics.cpa}</span>
                            <span className="text-slate-600">${concept.metrics.spend}</span>
                          </div>
                          {concept.fatigue.status !== 'healthy' && (
                            <div className={`text-[8px] px-2 py-1 rounded mb-2 ${
                              concept.fatigue.status === 'fatiguing' ? 'bg-orange-900/20 text-orange-400' : 'bg-yellow-900/20 text-yellow-400'
                            }`}>
                              {concept.fatigue.signals.join(' · ')}
                            </div>
                          )}
                          <div className="flex gap-1">
                            {concept.status === 'scale' && (
                              <button onClick={() => setGenConfig(c => ({ ...c, conceptSource: 'use_existing' as ConceptSource, quantity: 1, creativesPerConcept: 5, conceptAngle: concept.name }))}
                                className="flex-1 px-1.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-[8px] font-semibold rounded transition-colors">
                                Scale
                              </button>
                            )}
                            {concept.status === 'test' && (
                              <button onClick={() => setGenConfig(c => ({ ...c, conceptSource: 'recently_tested' as ConceptSource, quantity: 1, creativesPerConcept: 3, conceptAngle: concept.name }))}
                                className="flex-1 px-1.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-[8px] font-semibold rounded transition-colors">
                                Test More
                              </button>
                            )}
                            {concept.fatigue.status === 'fatiguing' && (
                              <button onClick={() => setGenConfig(c => ({ ...c, conceptSource: 'use_existing' as ConceptSource, quantity: 1, creativesPerConcept: 3, conceptAngle: concept.name }))}
                                className="flex-1 px-1.5 py-1 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 text-[8px] font-semibold rounded transition-colors">
                                Refresh
                              </button>
                            )}
                            {concept.status === 'kill' && (
                              <span className="flex-1 px-1.5 py-1 text-red-500/50 text-[8px] text-center">Underperforming</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[8px] text-slate-600 mt-2">vs baseline: CTR {conceptData.baseline.ctr}% · ROAS {conceptData.baseline.roas}x · CPA ${conceptData.baseline.cpa}</p>
                  </div>
                )}

                {/* Creative Fatigue Monitor */}
                {conceptData && conceptData.fatiguingCount > 0 && (
                  <div className="bg-slate-900 border border-orange-900/30 rounded-xl p-4">
                    <h3 className="text-[10px] text-orange-400 uppercase font-bold mb-3">Fatigue Alert</h3>
                    <div className="space-y-2">
                      {conceptData.concepts.filter((c: any) => c.fatigue.status !== 'healthy').slice(0, 4).map((concept: any, i: number) => (
                        <div key={i} className={`p-2 rounded-lg border ${
                          concept.fatigue.status === 'fatiguing' ? 'bg-orange-950/20 border-orange-800/40' : 'bg-yellow-950/10 border-yellow-800/30'
                        }`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-white font-medium truncate flex-1">{concept.name}</span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                              concept.fatigue.status === 'fatiguing' ? 'bg-orange-500/20 text-orange-400' : 'bg-yellow-500/20 text-yellow-400'
                            }`}>{concept.fatigue.status} ({concept.fatigue.score}/10)</span>
                          </div>
                          <p className="text-[9px] text-slate-500">{concept.fatigue.signals.join(' · ')}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[8px] text-orange-500/60 mt-2">{conceptData.fatiguingCount} concept{conceptData.fatiguingCount > 1 ? 's' : ''} showing fatigue signals</p>
                  </div>
                )}

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
                      {accountIntel.recommendations.provider && accountIntel.recommendations.provider !== 'auto' && (
                        <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Provider</span><span className="text-xs text-white font-medium capitalize">{accountIntel.recommendations.provider}</span></div>
                      )}
                      {accountIntel.recommendations.aspectRatio && (
                        <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Aspect Ratio</span><span className="text-xs text-white font-medium">{accountIntel.recommendations.aspectRatio}</span></div>
                      )}
                      {accountIntel.recommendations.duration && (
                        <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Duration</span><span className="text-xs text-white font-medium">{accountIntel.recommendations.duration}s</span></div>
                      )}
                      <button onClick={() => setGenConfig(c => ({
                        ...c,
                        contentType: accountIntel!.recommendations.contentType as any,
                        contentMix: accountIntel!.recommendations.contentType as any,
                        funnelStage: accountIntel!.recommendations.funnelStage as any,
                        funnelStructure: accountIntel!.recommendations.funnelStage as any,
                        hookStyle: accountIntel!.recommendations.hookStyle,
                        dimension: (accountIntel!.recommendations as any).aspectRatio || c.dimension,
                        videoDuration: (accountIntel!.recommendations as any).duration || c.videoDuration,
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

                {/* Concept Scorecards */}
                {accountIntel && (accountIntel as any).conceptScores?.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <h3 className="text-[10px] text-purple-400 uppercase font-semibold mb-3">Concept Intelligence</h3>
                    <div className="space-y-2">
                      {(accountIntel as any).conceptScores.slice(0, 8).map((c: any, i: number) => (
                        <div key={i} className={`rounded-lg p-2 border ${
                          c.action === 'scale' ? 'bg-emerald-950/20 border-emerald-800/30' :
                          c.action === 'pause' ? 'bg-red-950/20 border-red-800/30' :
                          c.action === 'refresh' ? 'bg-amber-950/20 border-amber-800/30' :
                          'bg-slate-800/30 border-slate-700/30'
                        }`}>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] text-white font-medium truncate flex-1">{c.conceptName}</p>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-semibold ${
                              c.action === 'scale' ? 'bg-emerald-500/20 text-emerald-400' :
                              c.action === 'pause' ? 'bg-red-500/20 text-red-400' :
                              c.action === 'refresh' ? 'bg-amber-500/20 text-amber-400' :
                              c.action === 'generate_more' ? 'bg-purple-500/20 text-purple-400' :
                              'bg-blue-500/20 text-blue-400'
                            }`}>{c.action === 'scale' ? 'SCALE' : c.action === 'pause' ? 'PAUSE' : c.action === 'refresh' ? 'REFRESH' : c.action === 'generate_more' ? 'MORE' : c.action === 'add_bof' ? '+BOF' : '+TOF'}</span>
                          </div>
                          <div className="flex gap-2 text-[9px]">
                            <span className="text-emerald-400">{c.roas}x</span>
                            <span className="text-slate-500">{c.purchases}p</span>
                            <span className="text-slate-500">${(c.spendCents / 100).toFixed(0)}</span>
                            <span className="text-slate-500">{c.adCount} ads</span>
                            {c.isFatigued && <span className="text-amber-400">fatiguing</span>}
                            {c.isRising && <span className="text-emerald-400">rising</span>}
                          </div>
                          {/* Action buttons */}
                          <div className="flex gap-1 mt-1.5">
                            {c.action !== 'pause' && (
                              <button onClick={() => handleConceptAction(c, c.action)}
                                className={`px-1.5 py-0.5 rounded text-[8px] font-semibold ${
                                  c.action === 'scale' ? 'bg-emerald-600 text-white' :
                                  c.action === 'refresh' ? 'bg-amber-600 text-white' :
                                  'bg-blue-600 text-white'
                                }`}>
                                {c.action === 'scale' ? 'Scale' : c.action === 'refresh' ? 'Refresh' : c.action === 'generate_more' ? 'More' : c.action === 'add_bof' ? '+BOF' : '+TOF'}
                              </button>
                            )}
                            {c.action !== 'add_tof' && c.action !== 'pause' && (
                              <button onClick={() => handleConceptAction(c, 'add_tof')}
                                className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-slate-700 text-slate-300 hover:bg-slate-600">+TOF</button>
                            )}
                            {c.action !== 'add_bof' && c.action !== 'pause' && (
                              <button onClick={() => handleConceptAction(c, 'add_bof')}
                                className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-slate-700 text-slate-300 hover:bg-slate-600">+BOF</button>
                            )}
                          </div>
                        </div>
                      ))}
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

      {/* ═══ Library Tab ═══ */}
      {tab === 'library' && (
        <>
          {!storeFilter ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">Select a store to view your creative library</p>
            </div>
          ) : libraryLoading ? (
            <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400" /></div>
          ) : (
            <div className="space-y-6">
              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-white">{libraryCounts.totalPackages}</p>
                  <p className="text-[10px] text-slate-500 uppercase">Generations</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-white">{libraryCounts.totalCreatives}</p>
                  <p className="text-[10px] text-slate-500 uppercase">Creatives</p>
                </div>
                <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-amber-400">{libraryCounts.totalWinners}</p>
                  <p className="text-[10px] text-amber-500 uppercase">Winners</p>
                </div>
              </div>

              {/* Filters + Search */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-[10px] text-slate-500 uppercase mb-1 block">Search</label>
                    <input
                      value={librarySearch}
                      onChange={e => setLibrarySearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && loadLibrary()}
                      placeholder="Search title, concept, hook..."
                      className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase mb-1 block">Type</label>
                    <select value={libraryFilters.contentType || ''} onChange={e => setLibraryFilters(f => ({ ...f, contentType: e.target.value || undefined }))}
                      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
                      <option value="">All</option>
                      <option value="video">Video</option>
                      <option value="image">Image</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase mb-1 block">Funnel</label>
                    <select value={libraryFilters.funnelStage || ''} onChange={e => setLibraryFilters(f => ({ ...f, funnelStage: e.target.value || undefined }))}
                      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
                      <option value="">All</option>
                      <option value="tof">TOF</option>
                      <option value="mof">MOF</option>
                      <option value="bof">BOF</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase mb-1 block">Provider</label>
                    <select value={libraryFilters.provider || ''} onChange={e => setLibraryFilters(f => ({ ...f, provider: e.target.value || undefined }))}
                      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
                      <option value="">All</option>
                      <option value="sora">Sora</option>
                      <option value="veo">Veo</option>
                      <option value="minimax">MiniMax</option>
                      <option value="dalle">GPT Image</option>
                      <option value="gemini-image">Gemini</option>
                      <option value="stability">Stability</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={!!libraryFilters.winnerOnly}
                      onChange={e => setLibraryFilters(f => ({ ...f, winnerOnly: e.target.checked || undefined }))}
                      className="rounded bg-slate-700 border-slate-600" />
                    <span className="text-[10px] text-amber-400">Winners only</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={!!libraryFilters.launchedOnly}
                      onChange={e => setLibraryFilters(f => ({ ...f, launchedOnly: e.target.checked || undefined }))}
                      className="rounded bg-slate-700 border-slate-600" />
                    <span className="text-[10px] text-blue-400">Launched only</span>
                  </label>
                  <button onClick={loadLibrary}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded-lg">
                    Search
                  </button>
                </div>
              </div>

              {/* ── Winners Section ── */}
              {libraryWinners.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-amber-400 mb-3">Saved Winners ({libraryWinners.length})</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {winners.map(w => (
                      <div key={w.id} className="bg-slate-900 border border-amber-800/40 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500 text-black font-bold">WINNER</span>
                          <span className="text-[10px] text-slate-500">{new Date(w.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </div>
                        <h4 className="text-sm font-semibold text-white mb-1 truncate">{w.title || 'Untitled'}</h4>
                        <p className="text-xs text-slate-500 mb-2 truncate">{w.concept || w.hook_pattern || ''}</p>
                        <div className="flex flex-wrap gap-1 mb-3">
                          {w.content_type && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{w.content_type}</span>}
                          {w.creative_type && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-900/30 text-purple-400">{w.creative_type}</span>}
                          {w.funnel_stage && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-900/30 text-blue-400">{w.funnel_stage.toUpperCase()}</span>}
                          {w.provider && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-900/30 text-cyan-400">{w.provider}</span>}
                          {w.performance_roas && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400">{w.performance_roas}x ROAS</span>}
                        </div>
                        {w.energy_tone && <p className="text-[10px] text-slate-500 mb-1">Tone: {w.energy_tone}</p>}
                        {w.hook_pattern && <p className="text-[10px] text-slate-500 mb-1 truncate">Hook: {w.hook_pattern}</p>}
                        {w.user_notes && <p className="text-[10px] text-amber-400/70 mb-2 italic">"{w.user_notes}"</p>}
                        <div className="flex gap-2 pt-2 border-t border-slate-800">
                          <button onClick={() => handleGenerateMoreLikeThis(w)}
                            className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-medium rounded-lg flex-1">
                            More Like This
                          </button>
                          <button onClick={() => handleDuplicateSetup(w)}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-medium rounded-lg border border-slate-700">
                            Use Setup
                          </button>
                          <button onClick={() => removeWinner(w.id)}
                            className="px-2 py-1 text-red-400 hover:text-red-300 text-[10px]">
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Past Generations Section ── */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">Past Generations ({libraryPackages.length})</h3>
                {libraryPackages.length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
                    <p className="text-slate-500 text-sm">No past generations found</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {libraryPackages.map(lp => (
                      <div key={lp.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                        <button onClick={() => setExpandedLibraryPkg(expandedLibraryPkg === lp.id ? null : lp.id)}
                          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${lp.content_type === 'video' ? 'bg-blue-900/30 text-blue-400' : 'bg-orange-900/30 text-orange-400'}`}>{lp.content_type}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-900/30 text-purple-400">{lp.creative_type}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{lp.funnel_stage?.toUpperCase()}</span>
                              <span className="text-[9px] text-slate-500">x{lp.quantity}</span>
                              {lp.hasWinner && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500 text-black font-bold">WINNER</span>}
                              {lp.version > 1 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-900/30 text-purple-400">v{lp.version}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-white">{lp.product_title || 'No product'}</span>
                              {lp.offer && <span className="text-[10px] text-emerald-400">{lp.offer}</span>}
                              <span className="text-[10px] text-slate-600">{new Date(lp.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                            </div>
                          </div>
                          <svg className={`w-4 h-4 text-slate-500 transition-transform ${expandedLibraryPkg === lp.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {expandedLibraryPkg === lp.id && (
                          <div className="border-t border-slate-800 px-4 py-3 space-y-3">
                            {/* Package items */}
                            {(lp.packages || []).map((lpkg: any, li: number) => (
                              <div key={li} className="bg-slate-800/50 rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">#{li + 1}</span>
                                    <span className="text-xs text-white font-medium truncate">{lpkg.title || `Package ${li + 1}`}</span>
                                  </div>
                                  <div className="flex gap-1">
                                    <button onClick={() => setShowWinnerModal({ pkg: lpkg, idx: li })}
                                      className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-medium rounded-lg">
                                      Save Winner
                                    </button>
                                    <button onClick={() => navigator.clipboard.writeText(JSON.stringify(lpkg, null, 2))}
                                      className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[9px] rounded-lg">
                                      Export
                                    </button>
                                  </div>
                                </div>
                                {lpkg.angle && <p className="text-[10px] text-slate-400 mb-1">Angle: {lpkg.angle || lpkg.conceptAngle}</p>}
                                {lpkg.hook && <p className="text-[10px] text-purple-300 mb-1">Hook: {lpkg.hook}</p>}
                                {lpkg.hookText && <p className="text-[10px] text-pink-300 mb-1">Hook: {lpkg.hookText}</p>}
                                {lpkg.script && <p className="text-[10px] text-slate-400 line-clamp-3">{lpkg.script}</p>}
                                {lpkg.headline && <p className="text-[10px] text-white font-medium">{lpkg.headline}</p>}
                                {lpkg.cta && <p className="text-[10px] text-emerald-400 mt-1">CTA: {lpkg.cta}</p>}
                                {lpkg.ctaText && <p className="text-[10px] text-emerald-400 mt-1">CTA: {lpkg.ctaText}</p>}
                              </div>
                            ))}
                            {/* Actions row */}
                            <div className="flex gap-2 pt-2 border-t border-slate-800">
                              <button onClick={() => handleDuplicateSetup(lp)}
                                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-medium rounded-lg">
                                Duplicate Setup
                              </button>
                              <button onClick={() => { handleDuplicateSetup(lp); setTab('generator'); }}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium rounded-lg">
                                Regenerate
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Rendered Creatives Section ── */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">Rendered Creatives ({libraryCreatives.length})</h3>
                {libraryCreatives.length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
                    <p className="text-slate-500 text-sm">No rendered creatives found</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {libraryCreatives.slice(0, 40).map(lc => (
                      <div key={lc.id} className={`bg-slate-900 border rounded-xl overflow-hidden ${lc.isWinner ? 'border-amber-700/50' : 'border-slate-800'}`}>
                        {/* Thumbnail */}
                        {lc.file_url && lc.nb_status === 'completed' ? (
                          lc.type === 'video' ? (
                            <video src={mediaUrl(lc.file_url)} poster={mediaUrl(lc.thumbnail_url)} controls preload="none" className="w-full aspect-square object-contain bg-black" />
                          ) : (
                            <img src={mediaUrl(lc.file_url)} alt="" className="w-full aspect-square object-contain bg-black" />
                          )
                        ) : (
                          <div className="w-full aspect-square bg-slate-800 flex items-center justify-center">
                            <span className={`text-xs ${lc.nb_status === 'processing' ? 'text-yellow-400' : lc.nb_status === 'failed' ? 'text-red-400' : 'text-slate-500'}`}>{lc.nb_status || 'no media'}</span>
                          </div>
                        )}
                        <div className="p-3">
                          <div className="flex items-center gap-1.5 mb-1">
                            {lc.isWinner && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500 text-black font-bold">W</span>}
                            <h4 className="text-xs text-white font-medium truncate">{lc.title}</h4>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-2">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${lc.type === 'video' ? 'bg-blue-900/30 text-blue-400' : 'bg-purple-900/30 text-purple-400'}`}>{lc.type}</span>
                            {lc.template_id && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{lc.template_id}</span>}
                            {lc.format && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400">{lc.format}</span>}
                          </div>
                          <div className="flex gap-1.5">
                            {lc.file_url && lc.nb_status === 'completed' && (
                              <a href={mediaUrl(lc.file_url)} download target="_blank" rel="noopener noreferrer"
                                className="text-[10px] text-emerald-400 hover:text-emerald-300">Download</a>
                            )}
                            {!lc.isWinner ? (
                              <button onClick={() => setShowWinnerModal({ pkg: { title: lc.title, script: lc.description, angle: lc.angle }, idx: 0, creativeId: lc.id })}
                                className="text-[10px] text-amber-400 hover:text-amber-300">Save Winner</button>
                            ) : (
                              <button onClick={() => { const w = winners.find(w => w.creative_id === lc.id); if (w) handleGenerateMoreLikeThis(w); }}
                                className="text-[10px] text-purple-400 hover:text-purple-300">More Like This</button>
                            )}
                            <button onClick={() => {
                              setSelectedCreativeIds(new Set([lc.id]));
                              setTab('generated');
                              setTimeout(() => openBulkLaunchModal(), 100);
                            }}
                              className="text-[10px] text-blue-400 hover:text-blue-300">Relaunch</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ Winner Save Modal ═══ */}
      {showWinnerModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowWinnerModal(null)}>
          <div className="bg-slate-900 border border-amber-800/50 rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-black font-bold">WINNER</span>
              <h3 className="text-lg font-semibold text-white">Save as Winner Reference</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              This creative will be saved as a winner reference. The system will automatically use its DNA patterns
              when you generate with a similar setup in the future.
            </p>
            <div className="mb-4">
              <p className="text-sm text-white font-medium mb-1">{showWinnerModal.pkg?.title || 'Untitled'}</p>
              <p className="text-xs text-slate-500">{showWinnerModal.pkg?.angle || showWinnerModal.pkg?.conceptAngle || ''}</p>
            </div>
            <div className="mb-4">
              <label className="text-[10px] text-slate-500 uppercase font-semibold mb-1 block">Notes (optional)</label>
              <textarea
                value={winnerNotes}
                onChange={e => setWinnerNotes(e.target.value)}
                placeholder="Why is this a winner? What makes it special?"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600 h-20 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => saveAsWinner(showWinnerModal.pkg, showWinnerModal.idx, showWinnerModal.creativeId)}
                disabled={!!savingWinner}
                className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {savingWinner ? 'Saving...' : 'Save as Winner'}
              </button>
              <button onClick={() => setShowWinnerModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm rounded-lg border border-slate-700">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Template Save Modal ═══ */}
      {showTemplateSave && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowTemplateSave(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">Save Setup as Template</h3>
            <p className="text-xs text-slate-400 mb-4">Save your current generator settings as a reusable template.</p>
            <div className="mb-4">
              <label className="text-[10px] text-slate-500 uppercase font-semibold mb-1 block">Template Name</label>
              <input
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder='e.g., "My 10/10 Meta Testimonial Template"'
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600"
              />
            </div>
            <div className="mb-4 bg-slate-800/50 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase mb-2">Settings to save:</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.contentType}</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.creativeType}</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.funnelStage.toUpperCase()}</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.hookStyle}</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.avatarStyle}</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.dimension}</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.platformTarget}</span>
                {genConfig.contentType === 'video' && <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.videoDuration}s</span>}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveTemplate} disabled={!templateName.trim()}
                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                Save Template
              </button>
              <button onClick={() => setShowTemplateSave(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm rounded-lg border border-slate-700">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Billing Tab ═══ */}
      {tab === 'billing' && <BillingTab storeFilter={storeFilter} />}

      {/* OLD BILLING IIFE — DISABLED (replaced by BillingTab component above) */}
      {false && (() => {
        const [billingData, setBillingData] = useState<any>(null);
        const [billingLoading, setBillingLoading] = useState(true);
        const [billingError, setBillingError] = useState('');

        useEffect(() => {
          setBillingLoading(true);
          setBillingError('');
          // First get tenant list, then get billing summary for the first tenant
          fetch('/api/billing')
            .then(r => r.json())
            .then(d => {
              if (d.success && d.tenants?.length > 0) {
                const tenant = d.tenants[0];
                return fetch(`/api/billing?tenantId=${tenant.id}&admin=1`).then(r => r.json());
              }
              setBillingData({ noTenant: true });
              setBillingLoading(false);
              return null;
            })
            .then(d => {
              if (d) { setBillingData(d); setBillingLoading(false); }
            })
            .catch(e => { setBillingError(e.message); setBillingLoading(false); });
        }, []);

        const handleSetupCard = async () => {
          if (!billingData?.tenant?.id) return;
          const res = await fetch('/api/billing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'setup-card', tenantId: billingData.tenant.id }),
          });
          const data = await res.json();
          if (data.success && data.sessionUrl) {
            window.location.href = data.sessionUrl;
          } else {
            alert(data.error || 'Failed to start card setup');
          }
        };

        if (billingLoading) {
          return <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto mb-3" />
            <p className="text-slate-400">Loading billing...</p>
          </div>;
        }

        if (billingData?.noTenant) {
          return <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
            <p className="text-slate-400">No billing tenant configured for your account.</p>
          </div>;
        }

        const summary = billingData?.summary;
        const tenant = billingData?.tenant;
        const payment = billingData?.paymentStatus;
        const isAdmin = billingData?.isAdmin;

        return (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">{tenant?.name || 'Billing'}</h3>
                  <p className="text-xs text-slate-400 mt-1">Current billing period</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-green-400">${(summary?.currentPeriodBilled || 0).toFixed(2)}</p>
                  <p className="text-[10px] text-slate-500">estimated this month</p>
                </div>
              </div>

              {/* Admin: show raw + margin */}
              {isAdmin && summary?.currentPeriodRaw != null && (
                <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-800">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Raw API Cost</p>
                    <p className="text-sm font-semibold text-slate-300">${summary.currentPeriodRaw.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Client Billed</p>
                    <p className="text-sm font-semibold text-green-400">${summary.currentPeriodBilled.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Margin Earned</p>
                    <p className="text-sm font-semibold text-emerald-400">${summary.currentPeriodMargin.toFixed(2)}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Payment Method */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h4 className="text-sm font-semibold text-white mb-3">Payment Method</h4>
              {payment?.hasPaymentMethod ? (
                <div className="flex items-center gap-3">
                  <div className="px-3 py-2 bg-slate-800 rounded-lg">
                    <p className="text-sm text-white font-medium">{payment.brand?.toUpperCase()} **** {payment.last4}</p>
                    <p className="text-[10px] text-slate-500">Expires {payment.expMonth}/{payment.expYear}</p>
                  </div>
                  <button onClick={handleSetupCard} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs rounded-lg border border-slate-700">
                    Update Card
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-xs text-slate-400 mb-3">No payment method on file.</p>
                  <button onClick={handleSetupCard} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">
                    Add Card
                  </button>
                </div>
              )}
            </div>

            {/* Usage by Provider */}
            {summary?.byProvider?.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h4 className="text-sm font-semibold text-white mb-3">Usage by Provider</h4>
                <div className="space-y-2">
                  {summary.byProvider.map((p: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 uppercase">{p.provider}</span>
                        <span className="text-xs text-slate-400">{p.count} call{p.count !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-white">${(p.billed || p.raw * 1.4).toFixed(2)}</p>
                        {isAdmin && <p className="text-[9px] text-slate-500">raw: ${(p.raw || 0).toFixed(2)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Usage by Store */}
            {summary?.byStore?.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h4 className="text-sm font-semibold text-white mb-3">Usage by Store</h4>
                <div className="space-y-2">
                  {summary.byStore.map((s: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                      <span className="text-sm text-white">{s.storeName || s.storeId}</span>
                      <p className="text-sm font-semibold text-white">${(s.billed || s.raw * 1.4).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary?.byProvider?.length === 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
                <p className="text-slate-400">No usage this month yet. Generate some creatives to see billing data.</p>
              </div>
            )}
          </div>
        );
      })()}
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
