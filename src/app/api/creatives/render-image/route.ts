import { requireStoreAccess, assertBillingReady } from '@/lib/auth-tenant';
import { logUsage } from '@/lib/usage-tracking';
/**
 * POST /api/creatives/render-image — Submit render job (returns immediately)
 * GET  /api/creatives/render-image?jobId=xxx — Poll job status
 *
 * Async job-based image rendering. POST returns a jobId instantly,
 * the actual rendering happens in the background. Frontend polls GET
 * until status is 'completed' or 'failed'.
 *
 * This eliminates "Failed to fetch" timeouts caused by long-running
 * provider calls with failover chains.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { generateImage as dalleGenerateImage } from '@/lib/dalle';
import { generateImage as geminiGenerateImage } from '@/lib/gemini-image';
import { generateImage as mmGenerateImage } from '@/lib/minimax';
import { generateImage as ideogramGenerateImage } from '@/lib/ideogram';
import { generateImage as nanoBananaGenerateImage, editImage as nanoBananaEditImage } from '@/lib/nano-banana-image';
import { compositeProductOntoBackground } from '@/lib/image-composite';
import { classifyProductImage } from '@/lib/vision';
import { selectProvider } from '@/lib/provider-router';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}
function jsonError(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

const ENGINE_LABELS: Record<string, string> = {
  ideogram: 'Ideogram', dalle: 'GPT Image', 'gemini-image': 'Gemini',
  stability: 'Stability AI', 'nano-banana': 'Nano Banana',
};
// Default fallback chain — overridden by provider router when creativeType is known
const FAILOVER_CHAIN = ['nano-banana', 'ideogram', 'stability', 'dalle', 'gemini-image'];

// ═══ In-memory job tracker (survives across requests within the same process) ═══
const activeJobs = new Map<string, {
  status: 'rendering' | 'completed' | 'failed';
  engine?: string;
  imageUrl?: string;
  model?: string;
  error?: string;
  failoverLog?: string[];
  composited?: boolean;
}>();

// Clean up old jobs after 10 minutes
setInterval(() => {
  if (activeJobs.size > 200) {
    const keys = Array.from(activeJobs.keys());
    for (let i = 0; i < keys.length - 100; i++) {
      activeJobs.delete(keys[i]);
    }
  }
}, 60000);

/**
 * GET /api/creatives/render-image?jobId=xxx
 * Poll the status of a render job.
 */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return jsonError('MISSING_JOB_ID', 'jobId query param required');

  // Check in-memory tracker first
  const memJob = activeJobs.get(jobId);
  if (memJob) {
    return jsonSuccess({
      jobId,
      status: memJob.status,
      engine: memJob.engine,
      imageUrl: memJob.imageUrl,
      model: memJob.model,
      error: memJob.error,
      failoverLog: memJob.failoverLog,
      composited: memJob.composited,
    });
  }

  // Fall back to DB check (in case PM2 restarted)
  let db: any;
  try { db = getDb(); } catch { return jsonError('DB_ERROR', 'Database failed', null, 500); }

  const creative: any = db.prepare('SELECT id, file_url, nb_status, template_id FROM creatives WHERE id = ?').get(jobId);
  if (!creative) return jsonError('NOT_FOUND', 'Job not found', null, 404);

  if (creative.nb_status === 'completed' && creative.file_url) {
    return jsonSuccess({ jobId, status: 'completed', engine: creative.template_id, imageUrl: creative.file_url });
  } else if (creative.nb_status === 'failed') {
    return jsonSuccess({ jobId, status: 'failed', engine: creative.template_id, error: 'Render failed' });
  } else {
    return jsonSuccess({ jobId, status: 'rendering', engine: creative.template_id });
  }
}

/**
 * Try a single image provider. Returns { imageUrl, model } or throws.
 */
async function tryProvider(
  engine: string, prompt: string, refImage: string | undefined, size: string, resolution: string,
): Promise<{ imageUrl: string; model: string }> {
  if (engine === 'dalle') {
    const r = await dalleGenerateImage(prompt, { size: size as any, quality: refImage ? 'auto' : 'standard', style: 'natural', referenceImageUrl: refImage });
    return { imageUrl: r.imageUrl, model: r.model };
  } else if (engine === 'gemini-image') {
    const r = await geminiGenerateImage(prompt, { model: 'gemini-2.5-flash-image', referenceImageUrl: refImage });
    return { imageUrl: r.imageUrl, model: r.model };
  } else if (engine === 'stability') {
    const { generateImage: sg } = await import('@/lib/stability');
    const am: Record<string, '1:1' | '16:9' | '9:16' | '4:5'> = { '1:1': '1:1', 'square': '1:1', '9:16': '9:16', 'portrait': '9:16', '16:9': '16:9', 'landscape': '16:9', '4:5': '4:5' };
    const r = await sg(prompt, { aspectRatio: am[resolution] || '1:1', referenceImageUrl: refImage, strength: 0.45, negativePrompt: 'blurry, low quality, distorted text, watermark' });
    return { imageUrl: r.imageUrl, model: r.model };
  } else if (engine === 'minimax-image') {
    const am: Record<string, '1:1' | '16:9' | '9:16' | '4:3' | '3:4'> = { 'square': '1:1', '1:1': '1:1', 'landscape': '16:9', '16:9': '16:9', 'portrait': '9:16', '9:16': '9:16', '4:3': '4:3', '3:4': '3:4' };
    const r = await mmGenerateImage(prompt, { aspectRatio: am[resolution] || '1:1' });
    return { imageUrl: r.imageUrl, model: r.model };
  } else if (engine === 'ideogram') {
    const am: Record<string, '1:1' | '4:5' | '9:16' | '16:9'> = { 'square': '1:1', '1:1': '1:1', '4:5': '4:5', 'portrait': '4:5', '9:16': '9:16', '16:9': '16:9', 'landscape': '16:9' };
    const r = await ideogramGenerateImage(prompt, { aspectRatio: am[resolution] || '4:5' });
    return { imageUrl: r.imageUrl, model: r.model };
  } else if (engine === 'nano-banana') {
    if (refImage) {
      // ═══ FORCED EDIT MODE — product image must be preserved exactly ═══
      // Convert local /api/ file paths to base64 data URIs (fal.ai accepts these directly)
      let resolvedImageUrl = refImage;
      if (refImage.startsWith('/api/products/uploads?file=') || refImage.startsWith('/api/')) {
        const { readFile: rf } = await import('fs/promises');
        const pathMod = await import('path');
        const filename = new URL(refImage, 'http://localhost').searchParams.get('file');
        if (!filename) throw new Error('Invalid local product image URL');
        const filePath = pathMod.join(process.cwd(), 'public', 'uploads', filename);
        const buf = await rf(filePath);
        const ext = filename.split('.').pop()?.toLowerCase() || 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
        resolvedImageUrl = `data:${mime};base64,${buf.toString('base64')}`;
        console.log(`[RENDER] Converted local file to data URI: ${filename} (${buf.length} bytes, ${mime})`);
      }

      // ═══ STRICT EDIT PROMPT — product must remain EXACT ═══
      const editPrompt = `Create a high-converting Facebook ad using THIS EXACT product image.

DO NOT change the product. DO NOT redesign the packaging. DO NOT generate a new bottle. DO NOT alter the label.

Build the ad AROUND this product. The product in the provided image must remain EXACTLY as-is — same shape, same label, same colors, same branding.

Integrate it naturally into the design with proper lighting, natural shadows, and realistic perspective. Make it look like a real product photoshoot, not AI-generated.

${prompt}

CRITICAL: Use the provided product image EXACTLY. Do not generate a new product. The product must be recognizable as the SAME product from the reference image.`;

      console.log(`[RENDER] NanoBanana EDIT mode: imageType=${resolvedImageUrl.startsWith('data:') ? 'data-uri' : 'url'}`);
      const r = await nanoBananaEditImage(editPrompt, [resolvedImageUrl], { aspectRatio: resolution || '4:5', resolution: '2K' });
      return { imageUrl: r.imageUrl, model: r.model };
    }
    // No product image — text-to-image only
    const r = await nanoBananaGenerateImage(prompt, { aspectRatio: resolution || '4:5', resolution: '2K' });
    return { imageUrl: r.imageUrl, model: r.model };
  }
  throw new Error(`Unknown engine: ${engine}`);
}

/**
 * POST /api/creatives/render-image
 * Creates a render job and returns immediately. Processing happens in background.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('INVALID_BODY', 'Invalid JSON', null, 400); }

  const { storeId, prompt, title, angle, resolution, engine, imageUrls, coverImageUrl, packageId, packageIndex, composite, productPlacement, autoFailover, creativeType, layoutType, funnelStage: bodyFunnelStage } = body;
  // ═══ TENANT ACCESS CHECK ═══
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;
  // ═══ BILLING ENFORCEMENT ═══
  if (storeId && _auth.authorized) {
    const billing = assertBillingReady(storeId, _auth.role);
    if (!billing.allowed) return NextResponse.json({ success: false, error: { code: 'BILLING_REQUIRED', message: billing.reason } }, { status: 402 });
  }

  if (!storeId || !prompt || !title) return jsonError('MISSING_FIELDS', 'storeId, prompt, and title required');

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

  const id = crypto.randomUUID();
  // ═══ AUTHORITATIVE COVER IMAGE ═══
  // Priority: explicit coverImageUrl > first imageUrls entry (legacy).
  // Accepts both https:// URLs and local /api/ paths (uploaded product images).
  const isValidImageUrl = (u: any): boolean =>
    typeof u === 'string' && (u.startsWith('https://') || u.startsWith('/api/') || u.startsWith('http://'));
  const refImage: string | undefined =
    isValidImageUrl(coverImageUrl) ? coverImageUrl :
    imageUrls?.find((u: any) => isValidImageUrl(u)) || undefined;
  console.log(`[RENDER-IMAGE] coverImageUrl=${coverImageUrl ? String(coverImageUrl).substring(0, 120) : '(absent)'}`);
  console.log(`[RENDER-IMAGE] resolved refImage=${refImage ? refImage.substring(0, 120) : '(none)'}`);
  if (coverImageUrl && refImage !== coverImageUrl) {
    console.error(`[RENDER-IMAGE] MISMATCH: coverImageUrl was "${String(coverImageUrl).substring(0, 80)}" but refImage resolved to "${refImage ? refImage.substring(0, 80) : 'null'}"`);
  }
  // Use provider router when no explicit engine is passed
  let requestedEngine = engine;
  let routerResult: any = null;
  if (!requestedEngine) {
    routerResult = selectProvider({ contentType: 'image', creativeType: creativeType || 'testimonial', aspectRatio: resolution, hasProductImages: !!refImage });
    requestedEngine = routerResult.provider;
    console.log(`[RENDER] Router selected: ${requestedEngine} | ${routerResult.reason}`);
  }
  // Map aspect ratio → DALL-E supported size (1024x1024, 1024x1792, 1792x1024 only).
  // 4:5 is not natively supported — we use 1024x1792 (closest portrait) and let
  // platform-side cropping or compositing handle the 4:5 framing.
  const sizeMap: Record<string, string> = {
    '1:1': '1024x1024', 'square': '1024x1024',
    '4:5': '1024x1792',   // closest portrait — Meta crops to 4:5 on display
    '9:16': '1024x1792', 'portrait': '1024x1792',
    '16:9': '1792x1024', 'landscape': '1792x1024',
  };
  const size = sizeMap[resolution] || '1024x1024';
  const safePrompt = (prompt || '').substring(0, 4000);
  const shouldFailover = autoFailover !== false;

  // ── Save creative with 'processing' status immediately ──
  // Persist the chosen aspect ratio in the `format` column for display + launch use.
  try {
    db.prepare(`
      INSERT INTO creatives (id, store_id, type, title, description, angle, format, nb_status, status, template_id, package_id, package_index)
      VALUES (?, ?, 'image', ?, ?, ?, ?, 'processing', 'draft', ?, ?, ?)
    `).run(id, storeId, title, safePrompt, angle || null, resolution || '1:1', requestedEngine, packageId || null, packageIndex ?? null);
  } catch (e: any) {
    return jsonError('DB_ERROR', 'Failed to create job', e.message, 500);
  }

  // ── Mark job as rendering in memory ──
  activeJobs.set(id, { status: 'rendering', engine: requestedEngine });

  // ── Return immediately — process in background ──
  // The rendering happens in a fire-and-forget async block.
  // Frontend will poll GET /render-image?jobId=xxx for the result.
  processRenderJob(id, {
    storeId, safePrompt, requestedEngine, shouldFailover, refImage, size, resolution,
    composite, productPlacement, title, angle, layoutType, creativeType, funnelStage: bodyFunnelStage,
    variationIndex: typeof packageIndex === 'number' ? packageIndex : undefined,
  });

  return jsonSuccess({ id, jobId: id, status: 'rendering', engine: requestedEngine });
}

/**
 * Background render processing. Not awaited by the POST handler.
 */
async function processRenderJob(jobId: string, opts: {
  storeId: string; safePrompt: string; requestedEngine: string; shouldFailover: boolean;
  refImage?: string; size: string; resolution: string; composite?: boolean;
  productPlacement?: string; title: string; angle?: string;
  layoutType?: string; creativeType?: string; funnelStage?: string;
  variationIndex?: number;
}) {
  const { safePrompt, requestedEngine, shouldFailover, refImage, size, resolution, composite, productPlacement, layoutType, creativeType, funnelStage, variationIndex } = opts;

  console.log(`[RENDER-JOB ${jobId.slice(0,8)}] Starting: engine=${requestedEngine} refImage=${refImage ? refImage.substring(0, 100) : '(none)'} composite=${composite}`);

  // ═══ IMAGE CLASSIFICATION — block back_label images from being used as primary ═══
  if (refImage) {
    try {
      const classification = await classifyProductImage(refImage);
      console.log(`[RENDER-JOB ${jobId.slice(0,8)}] Image classified as: ${classification}`);
      if (classification === 'back_label') {
        console.error(`[RENDER-JOB ${jobId.slice(0,8)}] BLOCKED: selected image is a back label (supplement facts / barcode)`);
        markJobFailed(jobId, 'Selected product image is a back label (supplement facts panel). Please select a front-facing product image instead.', requestedEngine);
        return;
      }
      if (classification === 'low_quality') {
        console.warn(`[RENDER-JOB ${jobId.slice(0,8)}] WARNING: selected image classified as low_quality — proceeding but result may be poor`);
      }
    } catch (e: any) {
      // Classification failure is non-blocking — log and continue
      console.error(`[RENDER-JOB ${jobId.slice(0,8)}] Classification failed (non-fatal): ${e.message}`);
    }
  }

  let imageUrl = '';
  let model = '';
  let usedEngine = requestedEngine;
  let failoverLog: string[] = [];

  // ═══ ENGINE-SPECIFIC PIPELINE SELECTION ═══
  //
  // NANO BANANA: MODEL-DRIVEN composition. Pass product image AS reference
  //   directly to the model's edit endpoint. The model handles layout,
  //   placement, hierarchy, spacing. NO manual compositing. NO grid anchors.
  //
  // IDEOGRAM: Concept-only statics. No product image at all.
  //
  // STABILITY / DALLE / OTHERS: Composite pipeline (generate bg → overlay product).
  //
  const isNanoBanana = requestedEngine === 'nano-banana';
  const isIdeogramEngine = requestedEngine === 'ideogram';
  const useModelDriven = isNanoBanana; // model handles all composition
  const useComposite = !!refImage && !isNanoBanana && !isIdeogramEngine;

  // For model-driven (NB): pass the product image directly as reference,
  // prompt tells the model to integrate it naturally.
  // For composite engines: generate background only, composite afterward.
  // For Ideogram: concept-only, no product.
  const renderPrompt = useComposite
    ? safePrompt
        .replace(/product placed .+?\./gi, '')
        .replace(/Match the product.+?\./gi, '')
        + '\n\nIMPORTANT: Do NOT draw or render any product bottle, jar, tube, or packaging in this image. Leave space for the product — a real product photo will be composited afterward. Generate only the ad background, text overlays, and layout elements.'
    : safePrompt;

  try {
    if (shouldFailover) {
      // ═══ AUTO FAILOVER ═══
      const chain = [requestedEngine, ...FAILOVER_CHAIN.filter(e => e !== requestedEngine)];
      const errors: { engine: string; error: string }[] = [];

      for (const eng of chain) {
        const label = ENGINE_LABELS[eng] || eng;
        const isEngNB = eng === 'nano-banana';
        // NanoBanana gets the product image as reference (model integrates it).
        // Composite engines get NO ref image (we composite afterward).
        // Ideogram gets no ref image (concept-only).
        const providerRef = isEngNB ? refImage : (useComposite ? undefined : refImage);
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            console.log(`[RENDER-JOB ${jobId.slice(0,8)}] Trying ${label}${attempt > 1 ? ' (retry)' : ''}${isEngNB ? ' (model-driven)' : useComposite ? ' (bg-only)' : ''}...`);
            const result = await tryProvider(eng, isEngNB ? safePrompt : renderPrompt, providerRef, size, resolution);
            if (result.imageUrl) {
              imageUrl = result.imageUrl;
              model = result.model;
              usedEngine = eng;
              if (errors.length > 0) {
                failoverLog = errors.map(e => `${ENGINE_LABELS[e.engine] || e.engine}: ${e.error}`);
                console.log(`[RENDER-JOB ${jobId.slice(0,8)}] Failover: ${errors.map(e => e.engine).join('→')} → ${eng}`);
              }
              break;
            }
          } catch (err: any) {
            const errMsg = (err.message || 'Unknown').substring(0, 200);
            const isTransient = err.retryable || (err.status >= 500) || err.code === 'NETWORK';
            if (attempt === 1 && isTransient) {
              console.log(`[RENDER-JOB ${jobId.slice(0,8)}] ${label} transient error, retrying...`);
              continue;
            }
            console.error(`[RENDER-JOB ${jobId.slice(0,8)}] ${label} failed: ${errMsg}`);
            errors.push({ engine: eng, error: errMsg });
            break;
          }
        }
        if (imageUrl) break;
      }

      if (!imageUrl) {
        const allErrors = errors.map(e => `${ENGINE_LABELS[e.engine] || e.engine}: ${e.error}`).join(' | ');
        markJobFailed(jobId, `All providers failed: ${allErrors}`, requestedEngine);
        return;
      }
    } else {
      // ═══ SINGLE PROVIDER ═══
      const providerRef = isNanoBanana ? refImage : (useComposite ? undefined : refImage);
      console.log(`[RENDER-JOB ${jobId.slice(0,8)}] Manual: ${ENGINE_LABELS[requestedEngine]}${isNanoBanana ? ' (model-driven, product as reference)' : useComposite ? ' (bg-only, will composite)' : ''}`);
      const result = await tryProvider(requestedEngine, isNanoBanana ? safePrompt : renderPrompt, providerRef, size, resolution);
      imageUrl = result.imageUrl;
      model = result.model;
    }

    // ── Composite step — ONLY for non-NanoBanana, non-Ideogram engines ──
    if (useComposite && imageUrl && refImage) {
      console.log(`[RENDER-JOB ${jobId.slice(0,8)}] Compositing real product onto generated background...`);
      try {
        const outputDims = resolution === '9:16' ? { width: 1080, height: 1920 }
          : resolution === '16:9' ? { width: 1920, height: 1080 }
          : resolution === '4:5' ? { width: 1080, height: 1350 }
          : { width: 1080, height: 1080 };
        const { detectLayoutType } = await import('@/lib/image-composite');
        const resolvedLayout = (layoutType as any) || detectLayoutType({ imageFormat: creativeType });
        const cr = await compositeProductOntoBackground(imageUrl, refImage, {
          outputSize: outputDims,
          layoutType: resolvedLayout,
          funnelStage: funnelStage || 'tof',
          variationIndex,
        });
        imageUrl = cr.imageUrl;
        model = `${model}+composite`;
      } catch (e: any) {
        console.error(`[RENDER-JOB ${jobId.slice(0,8)}] Compositing failed, using raw AI output: ${e.message}`);
      }
    }

    if (!imageUrl) {
      markJobFailed(jobId, 'Provider returned no image', usedEngine);
      return;
    }

    // ── Save completed result to DB ──
    try {
      const db = getDb();
      db.prepare(`UPDATE creatives SET file_url = ?, nb_status = 'completed', template_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(imageUrl, usedEngine, jobId);
    } catch (e: any) {
      console.error(`[RENDER-JOB ${jobId.slice(0,8)}] DB save failed:`, e.message);
    }

    // ── Update in-memory tracker ──
    const failoverNote = failoverLog.length > 0 ? `${ENGINE_LABELS[requestedEngine]} unavailable, used ${ENGINE_LABELS[usedEngine] || usedEngine}` : undefined;
    activeJobs.set(jobId, {
      status: 'completed', engine: usedEngine, imageUrl, model,
      failoverLog: failoverLog.length > 0 ? failoverLog : undefined,
      composited: composite && refImage ? true : false,
      error: failoverNote,
    });

    console.log(`[RENDER-JOB ${jobId.slice(0,8)}] Completed via ${ENGINE_LABELS[usedEngine] || usedEngine}`);
    logUsage({ storeId: opts.storeId, provider: usedEngine, operationType: 'image', units: 1, jobId, metadata: { resolution, composited: model.includes('composite') } });

  } catch (err: any) {
    const errMsg = (err.message || 'Render failed').substring(0, 300);
    console.error(`[RENDER-JOB ${jobId.slice(0,8)}] Fatal:`, errMsg);
    markJobFailed(jobId, `${ENGINE_LABELS[requestedEngine] || requestedEngine}: ${errMsg}`, requestedEngine);
  }
}

function markJobFailed(jobId: string, error: string, engine: string) {
  activeJobs.set(jobId, { status: 'failed', engine, error });
  try {
    const db = getDb();
    db.prepare(`UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?`).run(jobId);
  } catch {}
}
