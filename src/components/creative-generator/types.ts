// Type definitions for the creative-generator subsystem.
// Originally declared in src/app/dashboard/creatives/page.tsx; relocated here
// because they're consumed by 50+ components/hooks in this directory.
// Pure type module — no runtime exports.

import type { EngineKey } from '@/lib/engine-metadata';

export interface Store { id: string; name: string; }

export type CreativesTab = 'performance' | 'generated' | 'batches' | 'generator' | 'library' | 'billing';

export interface Ad {
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

export interface AdSet {
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

export interface Creative {
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
  template_data?: string | null;  // JSON-encoded; parse via parseAnimatedTemplateData for animated rows
  created_at: string;
  batch_id?: string | null;
  batch_index?: number | null;
  package_id?: string | null;
  format?: string | null;  // Aspect ratio: '4:5', '1:1', '9:16', '16:9'
}

export interface PromptItem {
  prompt: string;
  angle: string;
  headline: string;
  adCopy: string;
}

export interface Batch {
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

export interface Product {
  id: string;
  title: string;
  image_url: string | null;
  images: string | null;
  description: string | null;
  price_cents: number;
}

// ═══ Creative Generator Types ═══

// Concept source — where concepts come from
export type ConceptSource = 'generate_new' | 'use_existing' | 'recently_tested';

// Animation style — only meaningful when engine='animated'.
// Style is encoded in the storyboard frame (Nano Banana 2), not in the video engine.
export type AnimationStyle =
  | 'claymation'
  | '3d_motion_graphics'
  | 'pixar_3d'
  | 'scientific_explainer';

export interface GeneratorConfig {
  // Simple controls
  conceptSource: ConceptSource;
  quantity: number;            // number of concepts
  creativesPerConcept: number; // creatives per concept
  // Engine + content
  engine: EngineKey;
  genMode: 'new' | 'existing' | 'full_funnel' | 'clone_ad';
  contentMix: 'video' | 'image' | 'mixed' | 'full_funnel';
  animationStyle?: AnimationStyle;       // only meaningful when engine='animated'
  storyboardSceneCount?: number;          // 3-15, default 4
  contentMode: 'product' | 'service';     // default 'product'; flips concept-gen prompts to service-business framing (Path A)
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

export interface VideoPackage {
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

export interface ImagePackage {
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

export type CreativePackage = VideoPackage | ImagePackage;

export interface FailedScene {
  sceneIndex: number;
  reason: 'timeout' | 'content_policy_violation' | 'file_download_error' | 'submission_failed' | 'unknown';
  message: string;
}

/**
 * Per-scene record persisted on completed animated renders.
 * Stage A of the unified-scene-system project (scene-aware package metadata).
 *
 * One entry per rendered scene; arrays are aligned by sceneIndex, populated
 * defensively at the success-path UPDATE in api/creatives/generate (zip cuts
 * to Math.min of the source-array lengths so a length mismatch writes a
 * shorter scenes array instead of failing persistence).
 *
 * Text fields (visualDescription, voSegment, cameraDirection, motionPrompt)
 * are durable — they're the load-bearing inputs for the future Recreate-flow
 * integration (Stage C). URL fields (frameUrl, videoUrl) point at fal.media
 * and are best-effort — fal.ai's CDN has weeks-to-months durability with no
 * published SLA, so readers should treat them as optional and degrade
 * gracefully when they 404.
 */
export interface AnimatedSceneRecord {
  sceneIndex: number;
  duration: number;
  visualDescription: string;
  cameraDirection: string;
  voSegment: string;
  motionPrompt: string;
  frameUrl: string;
  videoUrl: string;
}

/**
 * Persisted shape of creatives.template_data for completed animated renders.
 * Pre-Stage-A rows have only the original 7 top-level fields; the new
 * `concept` and `scenes` fields are optional so reads of pre-Stage-A rows
 * still type-check. Writes on the success path always populate them.
 */
export interface AnimatedTemplateData {
  // Existing top-level fields preserved verbatim for backwards compatibility
  // with the ~27 completed animated rows that pre-date Stage A.
  animationStyle: string;
  conceptTitle: string;
  sceneVideoUrls: string[];
  totalDurationSeconds: number;
  sceneCount: number;
  errors: string[];
  stage: 'completed' | 'failed';

  // Stage A additions — populated only on the success path.
  concept?: {
    title: string;
    angle: string;
    hook: string;
    script: string;
  };
  scenes?: AnimatedSceneRecord[];
}

export interface RenderJob {
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  engine: string;
  imageUrl?: string;
  creativeId?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface AccountIntelligence {
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
