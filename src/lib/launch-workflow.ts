// Launch-workflow engine — product in, live FB campaign out.
//
// Extracted from the API route so BOTH the browser-driven flow and the
// background scheduler (lib/launch-scheduler) can run workflows. One step per
// advanceWorkflow() call, state persisted after every step: crashes/restarts
// lose nothing, failed steps retry in place.

import type Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { reserveVideos } from '@/lib/video-pool';

export interface Step { key: string; label: string; status: 'pending' | 'done' | 'error'; detail?: string }
export interface LaunchWorkflow {
  id: string; storeId: string; productId: string; name: string;
  status: string; steps: Step[]; config: any; result: any;
  error: string | null; createdAt: string; updatedAt: string;
}

export function ensureWorkflowTables(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS ad_workflows (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    steps_json TEXT NOT NULL,
    config_json TEXT NOT NULL,
    result_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS product_landing_pages (
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    url TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, product_id)
  )`);
}

export function rowToWorkflow(r: any): LaunchWorkflow {
  return {
    id: r.id, storeId: r.store_id, productId: r.product_id, name: r.name,
    status: r.status, steps: JSON.parse(r.steps_json || '[]'),
    config: JSON.parse(r.config_json || '{}'), result: JSON.parse(r.result_json || '{}'),
    error: r.error, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function getWorkflow(db: Database.Database, id: string): LaunchWorkflow | null {
  const r: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(id);
  return r ? rowToWorkflow(r) : null;
}

function save(db: Database.Database, id: string, fields: { steps?: Step[]; result?: any; status?: string; error?: string | null; config?: any; productId?: string }) {
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];
  if (fields.steps) { sets.push('steps_json = ?'); params.push(JSON.stringify(fields.steps)); }
  if (fields.result) { sets.push('result_json = ?'); params.push(JSON.stringify(fields.result)); }
  if (fields.status) { sets.push('status = ?'); params.push(fields.status); }
  if (fields.error !== undefined) { sets.push('error = ?'); params.push(fields.error); }
  if (fields.config) { sets.push('config_json = ?'); params.push(JSON.stringify(fields.config)); }
  if (fields.productId) { sets.push('product_id = ?'); params.push(fields.productId); }
  params.push(id);
  db.prepare(`UPDATE ad_workflows SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

/** Create a workflow (generate mode, or batch mode when config.creativeIds set).
 *  Throws Error with a user-facing message on invalid input. */
export function createLaunchWorkflow(db: Database.Database, storeId: string, productIdIn: string | undefined, config: any): LaunchWorkflow {
  ensureWorkflowTables(db);
  let productId = productIdIn;
  const newProduct = config?.newProduct && typeof config.newProduct === 'object' ? config.newProduct : null;
  const videoCount = Math.min(Math.max(Number(config?.videoCount) || 0, 0), 20);
  if (!storeId || !config?.profileId || !config?.pageId) {
    throw new Error('storeId, config.profileId, config.pageId required');
  }
  // New-product runs create the product + lander themselves; everything else
  // must arrive with a landing URL.
  if (!newProduct && !config?.landingUrl) throw new Error('config.landingUrl required');
  if (newProduct && (!newProduct.brandName || !newProduct.productName || !Number(newProduct.priceCents) || !Array.isArray(newProduct.referenceImageUrls) || !newProduct.referenceImageUrls.length)) {
    throw new Error('newProduct needs brandName, productName, priceCents and at least one reference image URL');
  }

  // ── Batch mode: launch EXISTING generated ads instead of generating new ones ──
  const creativeIds: string[] = Array.isArray(config.creativeIds) ? config.creativeIds.slice(0, 50) : [];
  const batchMode = creativeIds.length > 0;
  const prefill: any = {};
  if (batchMode) {
    const rows = creativeIds.map(cid =>
      db.prepare("SELECT id, file_url, template_data, product_id, audience_id FROM creatives WHERE id = ? AND store_id = ?").get(cid, storeId)
    ).filter(Boolean) as any[];
    if (rows.length === 0) throw new Error('No valid creatives found for this store');
    prefill.creatives = rows.map(r => {
      let templateName = '';
      try { templateName = JSON.parse(r.template_data || '{}').templateName || ''; } catch {}
      return { id: r.id, imageUrl: r.file_url, template: templateName || 'ad' };
    });
    prefill.audienceId = rows.find(r => r.audience_id)?.audience_id || null;
    if (!productId) productId = rows.find(r => r.product_id)?.product_id;
  }

  let productTitle = '';
  if (newProduct) {
    // Product doesn't exist yet — the np_product step creates it (Shopify +
    // local row) and rewrites the workflow's product id.
    productId = `new:${crypto.randomUUID()}`;
    productTitle = `${newProduct.brandName} ${newProduct.productName}`;
  } else {
    if (!productId) throw new Error('productId required');
    const product: any = db.prepare('SELECT title FROM products WHERE id = ?').get(productId);
    if (!product) throw new Error('Product not found');
    productTitle = product.title;
  }

  // Videos come from the Kalodata pool — reserve the best pending ones now
  const wfId = crypto.randomUUID();
  let reservedVideos: any[] = [];
  if (videoCount > 0) {
    reservedVideos = reserveVideos(db, storeId, videoCount, wfId);
    if (reservedVideos.length === 0) throw new Error('No pending videos in the pool — import a Kalodata file first');
    prefill.videos = reservedVideos.map((v: any) => ({ id: v.id, url: v.tiktok_url, caption: (v.caption || '').slice(0, 120), revenue: v.revenue }));
  }
  const vidN = reservedVideos.length;

  const adCount = batchMode ? prefill.creatives.length
    : Math.min(Math.max(Number(config.adCount) ?? 10, 0), 20);
  if (adCount === 0 && vidN === 0) throw new Error('Nothing to launch: adCount and videoCount are both 0');
  const goLive = config.launchStatus === 'ACTIVE';
  const useExistingCampaign = !!config.existingCampaignId;
  // Everything on Facebook is created PAUSED regardless of config — the
  // launch gate + activate step are the ONLY way anything starts spending.
  const steps: Step[] = [
    ...(newProduct ? [
      ...Array.from({ length: 7 }, (_, i) => ({ key: `np_image_${i + 1}`, label: `Listing image ${i + 1}/7 (Amazon-style)`, status: 'pending' as const })),
      { key: 'np_product', label: `Create "${productTitle}" on Shopify (7 images, active)`, status: 'pending' as const },
      { key: 'np_lander', label: 'Build the product lander (Fable 5, Shrine-style)', status: 'pending' as const },
    ] : []),
    ...(batchMode && prefill.audienceId ? [] : [{ key: 'audience', label: 'Generate audience (Fable 5)', status: 'pending' as const }]),
    { key: 'copy', label: 'Write ad copy (Fable 5)', status: 'pending' },
    ...(batchMode ? [] : Array.from({ length: adCount }, (_, i) => ({ key: `image_${i + 1}`, label: `Generate picture ad ${i + 1}/${adCount}`, status: 'pending' as const }))),
    ...Array.from({ length: vidN }, (_, i) => ({ key: `vdl_${i + 1}`, label: `Download TikTok video ${i + 1}/${vidN}`, status: 'pending' as const })),
    { key: 'campaign', label: useExistingCampaign ? 'Attach to existing FB campaign (its budget untouched)' : `Create CBO campaign (paused, $${((Number(config.dailyBudgetCents) || 1000) / 100).toFixed(2)}/day)`, status: 'pending' },
    { key: 'adset', label: useExistingCampaign
      ? `Create ad set in campaign${Number(config.minSpendTargetCents) > 0 ? ` (min $${(Number(config.minSpendTargetCents) / 100).toFixed(2)}/day)` : ''}`
      : 'Create ad set (paused, budget lives on the campaign)', status: 'pending' },
    ...Array.from({ length: adCount }, (_, i) => ({ key: `ad_${i + 1}`, label: `Upload + create picture ad ${i + 1}/${adCount} (paused)`, status: 'pending' as const })),
    ...Array.from({ length: vidN }, (_, i) => ({ key: `vad_${i + 1}`, label: `Upload + create video ad ${i + 1}/${vidN} (paused)`, status: 'pending' as const })),
    ...(goLive ? [
      { key: 'gate_launch', label: 'LAUNCH GATE — final approval before ads go LIVE and spend begins', status: 'pending' as const },
      { key: 'activate', label: 'Activate campaign + ad set + ads', status: 'pending' as const },
    ] : []),
  ];

  // The URL this run actually uses becomes the product's saved lander —
  // next runs prefill it instantly and consistently (new-product runs save
  // theirs when the lander step builds it)
  if (config.landingUrl) {
    db.prepare(`INSERT INTO product_landing_pages (store_id, product_id, url, source, updated_at) VALUES (?, ?, ?, 'manual', datetime('now'))
      ON CONFLICT(store_id, product_id) DO UPDATE SET url = excluded.url, source = 'manual', updated_at = datetime('now')`)
      .run(storeId, productId, String(config.landingUrl));
  }

  const id = wfId;
  const nameBits = [`${productTitle.slice(0, 50)}`, adCount ? `${adCount} pics` : '', vidN ? `${vidN} videos` : '', batchMode ? '(batch)' : '', newProduct ? '(new product)' : ''].filter(Boolean).join(' — ');
  db.prepare(`INSERT INTO ad_workflows (id, store_id, product_id, name, steps_json, config_json, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, storeId, productId, nameBits, JSON.stringify(steps), JSON.stringify({
      adCount,
      videoCount: vidN,
      newProduct: newProduct ? {
        brandName: String(newProduct.brandName).slice(0, 80),
        productName: String(newProduct.productName).slice(0, 120),
        priceCents: Math.round(Number(newProduct.priceCents)),
        brief: String(newProduct.brief || '').slice(0, 2000),
        referenceImageUrls: newProduct.referenceImageUrls.slice(0, 3),
      } : null,
      mode: newProduct ? 'new_product' : batchMode ? 'batch' : 'generate',
      creativeIds: batchMode ? creativeIds : undefined,
      existingCampaignId: useExistingCampaign ? config.existingCampaignId : null,
      dailyBudgetCents: Math.max(Number(config.dailyBudgetCents) || 1000, 100),
      minSpendTargetCents: Number(config.minSpendTargetCents) > 0 ? Math.round(Number(config.minSpendTargetCents)) : null,
      launchStatus: config.launchStatus === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      profileId: config.profileId,
      pageId: config.pageId,
      landingUrl: config.landingUrl,
      audienceId: config.audienceId || null,
      selectedImageUrl: config.selectedImageUrl || null,
      customInstructions: typeof config.customInstructions === 'string' && config.customInstructions.trim() ? config.customInstructions.trim().slice(0, 500) : null,
      campaignName: config.campaignName || `${productTitle.slice(0, 40)} | Launch ${new Date().toISOString().slice(0, 10)}`,
      targeting: {
        countries: Array.isArray(config.targeting?.countries) && config.targeting.countries.length
          ? config.targeting.countries.map((c: string) => String(c).trim().toUpperCase()).filter(Boolean)
          : ['US'],
      },
      schedule: {
        startAt: null,
        // days to run; 0/null = no end (runs until manually stopped)
        durationDays: Math.min(Math.max(Number(config.schedule?.durationDays) || 0, 0), 90),
      },
    }), JSON.stringify(prefill));

  return getWorkflow(db, id)!;
}

export function approveGate(db: Database.Database, id: string, stepKey: string): LaunchWorkflow {
  const wf = getWorkflow(db, id);
  if (!wf) throw new Error('Not found');
  const gate = wf.steps.find(s => s.key === stepKey && s.key.startsWith('gate_'));
  if (!gate) throw new Error('Gate not found');
  gate.status = 'done';
  gate.detail = `Approved ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const allDone = wf.steps.every(s => s.status === 'done');
  save(db, wf.id, { steps: wf.steps, status: allDone ? 'done' : 'running', error: null });
  return getWorkflow(db, id)!;
}

export function retryWorkflow(db: Database.Database, id: string): LaunchWorkflow {
  const wf = getWorkflow(db, id);
  if (!wf) throw new Error('Not found');
  const steps: Step[] = wf.steps.map((s: Step) => s.status === 'error' ? { ...s, status: 'pending' as const, detail: undefined } : s);
  save(db, wf.id, { steps, status: 'running', error: null });
  return getWorkflow(db, id)!;
}

export function cancelWorkflow(db: Database.Database, id: string): LaunchWorkflow {
  save(db, id, { status: 'cancelled', error: null });
  return getWorkflow(db, id)!;
}

/** Execute exactly one unit of work. Gates hold the run unless
 *  opts.autoApproveLaunchGate (used by scheduled runs). */
export async function advanceWorkflow(db: Database.Database, id: string, opts?: { autoApproveLaunchGate?: boolean }): Promise<LaunchWorkflow> {
  const wf = getWorkflow(db, id);
  if (!wf) throw new Error('Not found');
  if (wf.status === 'done' || wf.status === 'cancelled') return wf;

  const steps: Step[] = wf.steps;
  const step = steps.find(s => s.status !== 'done');
  if (!step) {
    save(db, wf.id, { status: 'done', error: null });
    return getWorkflow(db, id)!;
  }

  // Listing images (new product) — parallel batch of 7 Amazon-style shots
  if (step.key.startsWith('np_image_')) {
    const { generateListingImage } = await import('@/lib/listing-images');
    const result = { ...wf.result };
    result.listingImages = result.listingImages || [];
    const np = wf.config.newProduct;
    const pending = steps.filter(s => s.key.startsWith('np_image_') && s.status !== 'done');
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const mine = pending[cursor++];
        const idx = Number(mine.key.split('_')[2]) - 1;
        try {
          const img = await generateListingImage(db, {
            storeId: wf.storeId, brandName: np.brandName, productName: np.productName,
            brief: np.brief, referenceImageUrls: np.referenceImageUrls, idx,
          });
          result.listingImages[idx] = { id: img.id, filePath: img.filePath, label: img.label };
          mine.status = 'done'; mine.detail = img.label;
        } catch (e: any) {
          mine.status = 'error'; mine.detail = String(e?.message || e).slice(0, 300);
        }
        save(db, wf.id, { steps, result });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
    const failed = pending.filter(s => s.status === 'error');
    save(db, wf.id, { steps, result, status: failed.length ? 'error' : 'running', error: failed.length ? `${failed.length}/7 listing images failed — retry re-runs only those` : null });
    return getWorkflow(db, id)!;
  }

  // TikTok video downloads — parallel batch (3 at a time)
  if (step.key.startsWith('vdl_')) {
    const { downloadPoolVideo } = await import('@/lib/video-pool');
    const result = { ...wf.result };
    result.videoFiles = result.videoFiles || [];
    const videos = result.videos || [];
    const pending = steps.filter(s => s.key.startsWith('vdl_') && s.status !== 'done');
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const mine = pending[cursor++];
        const idx = Number(mine.key.split('_')[1]) - 1;
        const v = videos[idx];
        if (!v) { mine.status = 'error'; mine.detail = 'No reserved video for this slot'; save(db, wf.id, { steps, result }); continue; }
        try {
          const filePath = await downloadPoolVideo(db, { id: v.id, store_id: wf.storeId, tiktok_url: v.url });
          result.videoFiles[idx] = filePath;
          mine.status = 'done'; mine.detail = `${v.id} (${v.caption?.slice(0, 40) || 'video'})`;
        } catch (e: any) {
          mine.status = 'error'; mine.detail = String(e?.message || e).slice(0, 300);
        }
        save(db, wf.id, { steps, result });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    const failed = pending.filter(s => s.status === 'error');
    save(db, wf.id, { steps, result, status: failed.length ? 'error' : 'running', error: failed.length ? `${failed.length} video downloads failed — retry re-runs them` : null });
    return getWorkflow(db, id)!;
  }

  // Image steps run as a PARALLEL batch — 10 sequential generations took
  // ~10 minutes; 5 workers cut that to ~2. Each completion persists
  // immediately (better-sqlite3 is synchronous, so no write races).
  if (step.key.startsWith('image_')) {
    const { generateStaticAd, pickTemplates } = await import('@/lib/static-ad-generate');
    const result = { ...wf.result };
    if (!result.templateIds) result.templateIds = pickTemplates(db, wf.storeId, wf.config.adCount);
    if (!result.templateIds.length) {
      step.status = 'error'; step.detail = 'No active image templates available';
      save(db, wf.id, { steps, status: 'error', error: step.detail });
      return getWorkflow(db, id)!;
    }
    result.creatives = result.creatives || [];

    const pending = steps.filter(s => s.key.startsWith('image_') && s.status !== 'done');
    const CONCURRENCY = 5;
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const mine = pending[cursor++];
        const idx = Number(mine.key.split('_')[1]) - 1;
        try {
          const creative = await generateStaticAd(db, {
            storeId: wf.storeId, productId: wf.productId, audienceId: result.audienceId,
            templateId: result.templateIds[idx % result.templateIds.length],
            selectedImageUrl: wf.config.selectedImageUrl || undefined,
            customInstructions: wf.config.customInstructions || undefined,
          });
          result.creatives[idx] = { id: creative.id, imageUrl: creative.imageUrl, template: creative.template };
          mine.status = 'done'; mine.detail = creative.template;
        } catch (e: any) {
          mine.status = 'error'; mine.detail = String(e?.message || e).slice(0, 300);
        }
        save(db, wf.id, { steps, result }); // live progress for pollers
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

    const failed = pending.filter(s => s.status === 'error');
    save(db, wf.id, {
      steps, result,
      status: failed.length ? 'error' : 'running',
      error: failed.length ? `${failed.length}/${pending.length} images failed — retry re-runs only those` : null,
    });
    return getWorkflow(db, id)!;
  }

  // Review gates are retired — auto-complete them (covers older runs)
  if (step.key === 'gate_review') {
    step.status = 'done';
    step.detail = 'auto-approved (review gate removed — flow runs hands-off)';
    save(db, wf.id, { steps, status: 'running', error: null });
    return getWorkflow(db, id)!;
  }

  // The launch gate holds — unless a scheduled run was configured to go live
  if (step.key.startsWith('gate_')) {
    if (opts?.autoApproveLaunchGate) {
      step.status = 'done';
      step.detail = `Auto-approved by schedule ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      save(db, wf.id, { steps, status: 'running', error: null });
      return getWorkflow(db, id)!;
    }
    if (wf.status !== 'awaiting_approval') save(db, wf.id, { status: 'awaiting_approval', error: null });
    return getWorkflow(db, id)!;
  }

  try {
    const result = await runStep(db, wf, step);
    step.status = 'done';
    step.detail = result.detail;
    const allDone = steps.every(s => s.status === 'done');
    save(db, wf.id, { steps, result: result.result, status: allDone ? 'done' : 'running', error: null });
  } catch (e: any) {
    step.status = 'error';
    step.detail = String(e?.message || e).slice(0, 400);
    save(db, wf.id, { steps, status: 'error', error: step.detail });
  }
  return getWorkflow(db, id)!;
}

/** Drive a workflow to a terminal state (done/error/awaiting_approval). */
export async function runWorkflowToCompletion(db: Database.Database, id: string, opts?: { autoApproveLaunchGate?: boolean; maxSteps?: number }): Promise<LaunchWorkflow> {
  const max = opts?.maxSteps ?? 150;
  let wf = getWorkflow(db, id);
  if (!wf) throw new Error('Not found');
  for (let i = 0; i < max; i++) {
    wf = await advanceWorkflow(db, id, opts);
    if (wf.status !== 'running') break;
  }
  return wf!;
}

async function runStep(db: any, wf: any, step: Step): Promise<{ detail: string; result: any }> {
  const result = { ...wf.result };
  const cfg = wf.config;

  const profile: any = db.prepare('SELECT * FROM fb_profiles WHERE id = ? AND is_active = 1').get(cfg.profileId);

  if (step.key === 'audience') {
    if (cfg.audienceId) {
      result.audienceId = cfg.audienceId;
      const a: any = db.prepare('SELECT * FROM ad_audiences WHERE id = ?').get(cfg.audienceId);
      if (a) {
        result.audience = {
          name: a.name, description: a.description, mindset: a.mindset, demographics: a.demographics,
          painPoints: JSON.parse(a.pain_points || '[]'), desires: JSON.parse(a.desires || '[]'),
          objections: JSON.parse(a.objections || '[]'), creativeAngles: JSON.parse(a.creative_angles || '[]'),
        };
      }
      return { detail: `Using existing: ${a?.name || cfg.audienceId}`, result };
    }
    const { generateAudienceFromProduct } = await import('@/lib/claude-audience');
    const product: any = db.prepare('SELECT title, description, price_cents FROM products WHERE id = ?').get(wf.productId);
    // Every run gets a DIFFERENT audience — feed recent ones in as anti-repeats
    const recent: any[] = db.prepare(
      'SELECT name FROM ad_audiences WHERE store_id = ? ORDER BY rowid DESC LIMIT 10'
    ).all(wf.storeId);
    const a = await generateAudienceFromProduct(product, { avoidNames: recent.map(r => r.name) });
    const audienceId = crypto.randomUUID();
    const angles = [...a.usageMoments.map((m: string) => `Moment: ${m}`), ...a.creativeAngles];
    db.prepare(`INSERT INTO ad_audiences (id, store_id, name, description, pain_points, desires, objections, mindset, failed_solutions, demographics, creative_angles, bof_reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(audienceId, wf.storeId, a.name, a.description, JSON.stringify(a.painPoints), JSON.stringify(a.desires),
        JSON.stringify(a.objections), a.mindset, JSON.stringify(a.failedSolutions), a.demographics, JSON.stringify(angles), a.bofReasoning);
    result.audienceId = audienceId;
    result.audience = {
      name: a.name, description: a.description, mindset: a.mindset, demographics: a.demographics,
      painPoints: a.painPoints, desires: a.desires, objections: a.objections,
      creativeAngles: [...a.usageMoments.map((m: string) => `Moment: ${m}`), ...a.creativeAngles],
    };
    return { detail: a.name, result };
  }

  if (step.key === 'copy') {
    const { generateAdCopy } = await import('@/lib/ad-copy');
    const { loadAudience } = await import('@/lib/static-ad-generate');
    const product: any = db.prepare('SELECT title, description, price_cents FROM products WHERE id = ?').get(wf.productId);
    const audience = loadAudience(db, result.audienceId);
    if (!audience) throw new Error('Audience missing — rerun the audience step');
    result.copy = await generateAdCopy(product, audience);
    return { detail: result.copy.headline, result };
  }

  if (step.key.startsWith('image_')) {
    const idx = Number(step.key.split('_')[1]) - 1;
    const { generateStaticAd, pickTemplates } = await import('@/lib/static-ad-generate');
    if (!result.templateIds) result.templateIds = pickTemplates(db, wf.storeId, cfg.adCount);
    const templateId = result.templateIds[idx % result.templateIds.length];
    if (!templateId) throw new Error('No active image templates available');
    const creative = await generateStaticAd(db, {
      storeId: wf.storeId, productId: wf.productId, audienceId: result.audienceId, templateId,
      selectedImageUrl: cfg.selectedImageUrl || undefined,
    });
    result.creatives = result.creatives || [];
    result.creatives[idx] = { id: creative.id, imageUrl: creative.imageUrl, template: creative.template };
    return { detail: creative.template, result };
  }

  if (step.key === 'campaign') {
    if (!profile?.access_token || !profile?.ad_account_id) throw new Error('FB profile missing token or ad account');
    if (cfg.existingCampaignId) {
      result.campaignId = cfg.existingCampaignId;
      // Is the existing campaign CBO? Its ad sets must not carry budgets then.
      try {
        const res = await fetch(`https://graph.facebook.com/v24.0/${cfg.existingCampaignId}?fields=daily_budget,lifetime_budget&access_token=${profile.access_token}`);
        const d = await res.json();
        result.campaignIsCbo = !!(d.daily_budget || d.lifetime_budget);
      } catch { result.campaignIsCbo = false; }
      return { detail: `Using existing campaign ${cfg.existingCampaignId}${result.campaignIsCbo ? ' (CBO — campaign owns the budget)' : ''}`, result };
    }
    const { createCampaign } = await import('@/lib/facebook');
    // CBO: minimum spend lives on the CAMPAIGN; Meta distributes across ad
    // sets. Always PAUSED — the launch gate + activate step control going live.
    const campaign = await createCampaign(profile.ad_account_id, profile.access_token, {
      name: cfg.campaignName, status: 'PAUSED',
      cboDailyBudgetCents: cfg.dailyBudgetCents,
    });
    result.campaignId = campaign.id;
    result.campaignIsCbo = true;
    return { detail: `CBO campaign ${campaign.id} (paused, $${(cfg.dailyBudgetCents / 100).toFixed(2)}/day at campaign level)`, result };
  }

  if (step.key === 'adset') {
    if (!profile?.access_token || !profile?.ad_account_id) throw new Error('FB profile missing token or ad account');
    if (!result.campaignId) throw new Error('Campaign missing — rerun the campaign step');
    const { createAdSet } = await import('@/lib/facebook');

    // When attaching to an existing campaign, the new ad set is BASED ON the
    // campaign's existing ad sets: same pixel, same optimization/billing.
    let pixelId: string | undefined = profile.pixel_id || undefined;
    let optimizationGoal: string | undefined;
    let billingEvent: string | undefined;
    let countries: string[] = cfg.targeting?.countries?.length ? cfg.targeting.countries : ['US'];
    let basedOn = '';
    if (cfg.existingCampaignId) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v24.0/${cfg.existingCampaignId}/adsets?fields=name,status,promoted_object,optimization_goal,billing_event,targeting&limit=25&access_token=${profile.access_token}`
        );
        const d = await res.json();
        const tpl = (d.data || []).find((a: any) => a.status !== 'DELETED' && a.status !== 'ARCHIVED');
        if (tpl) {
          if (tpl.promoted_object?.pixel_id) pixelId = tpl.promoted_object.pixel_id;
          if (tpl.optimization_goal) optimizationGoal = tpl.optimization_goal;
          if (tpl.billing_event) billingEvent = tpl.billing_event;
          if (tpl.targeting?.geo_locations?.countries?.length) countries = tpl.targeting.geo_locations.countries;
          basedOn = ` — settings based on "${tpl.name}"`;
        }
      } catch { /* fall back to profile defaults */ }
    }
    const hasPixel = !!pixelId;

    const isCbo = !!result.campaignIsCbo;
    // Naming convention: 07/12/2026 - M.O - Auto Launch (LA date at execution)
    const laDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', year: 'numeric' });
    const adset = await createAdSet(profile.ad_account_id, profile.access_token, {
      name: `${laDate} - M.O - Auto Launch`,
      campaignId: result.campaignId,
      dailyBudgetCents: cfg.dailyBudgetCents,
      cbo: isCbo, // CBO campaign owns the budget — ad set carries none
      // Min spend target keeps this ad set from being starved inside a CBO
      // campaign that already has established ad sets
      minSpendTargetCents: cfg.minSpendTargetCents || undefined,
      status: 'PAUSED',
      // No pixel → conversions optimization is invalid; optimize for link clicks
      optimizationGoal: optimizationGoal || (hasPixel ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS'),
      ...(billingEvent ? { billingEvent } : {}),
      pixelId,
      // BROAD: countries only, full 18-65, all genders, and Facebook's
      // Advantage+ audience expansion explicitly OFF
      targeting: {
        geo_locations: { countries },
        age_min: 18,
        age_max: 65,
        targeting_automation: { advantage_audience: 0 },
      },
      // Optional expiry when configured; default = runs until turned off
      ...(() => {
        const sched = cfg.schedule || {};
        return sched.durationDays > 0 ? { endTime: new Date(Date.now() + sched.durationDays * 86_400_000).toISOString() } : {};
      })(),
    });
    result.adSetId = adset.id;
    return { detail: `Ad set ${adset.id}${basedOn}${isCbo ? ' (CBO — budget on campaign)' : ''}${hasPixel ? '' : ' (no pixel — link clicks)'}, broad targeting, Advantage+ off, runs until turned off`, result };
  }

  if (step.key.startsWith('ad_')) {
    if (!profile?.access_token || !profile?.ad_account_id) throw new Error('FB profile missing token or ad account');
    if (!result.adSetId) throw new Error('Ad set missing — rerun the adset step');
    const idx = Number(step.key.split('_')[1]) - 1;
    const creative = result.creatives?.[idx];
    if (!creative) throw new Error(`Image ${idx + 1} missing — rerun its image step`);

    const { uploadAdImage, createAdCreative, createAd } = await import('@/lib/facebook');

    // Read the PNG from disk (the serving URL is session-gated) → base64 upload
    const filePath = path.join(process.cwd(), 'static-ads', wf.storeId, `${creative.id}.png`);
    if (!fs.existsSync(filePath)) throw new Error(`Image file missing for creative ${creative.id}`);
    const b64 = fs.readFileSync(filePath).toString('base64');

    const img = await uploadAdImage(profile.ad_account_id, profile.access_token, b64);
    const adCreative = await createAdCreative(profile.ad_account_id, profile.access_token, {
      name: `${cfg.campaignName} | ${creative.template} | ${idx + 1}`,
      pageId: cfg.pageId,
      imageHash: img.hash,
      headline: result.copy?.headline || '',
      primaryText: result.copy?.primaryText || '',
      description: result.copy?.description || '',
      linkUrl: cfg.landingUrl,
      callToAction: 'SHOP_NOW',
    });
    const ad = await createAd(profile.ad_account_id, profile.access_token, {
      name: `${creative.template} ${idx + 1}`,
      adSetId: result.adSetId,
      creativeId: adCreative.id,
      status: 'PAUSED',
    });
    result.adIds = result.adIds || [];
    result.adIds[idx] = ad.id;
    return { detail: `Ad ${ad.id}`, result };
  }

  if (step.key === 'activate') {
    if (!profile?.access_token) throw new Error('FB profile missing token');
    if (!result.campaignId || !result.adSetId) throw new Error('Campaign/ad set missing');
    const token = profile.access_token;
    // Idempotent + tolerant of manual edits in Ads Manager (renames, already-
    // activated objects): check state first, skip if not paused, surface
    // Facebook's human-readable error when a flip is genuinely rejected.
    const activate = async (objectId: string): Promise<string | null> => {
      try {
        const cur = await (await fetch(`https://graph.facebook.com/v24.0/${objectId}?fields=status&access_token=${token}`)).json();
        if (cur.error) return `${objectId}: ${cur.error.error_user_msg || cur.error.message}`;
        if (cur.status && cur.status !== 'PAUSED') return null; // already active/archived — nothing to flip
        const res = await fetch(`https://graph.facebook.com/v24.0/${objectId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ACTIVE', access_token: token }),
        });
        const d = await res.json();
        if (d.error) return `${objectId}: ${d.error.error_user_msg || d.error.message}`;
        return null;
      } catch (e: any) { return `${objectId}: ${String(e?.message || e).slice(0, 150)}`; }
    };
    // Ads first, then ad set, then campaign — nothing serves until the campaign flips
    const adFailures: string[] = [];
    const adIds = (result.adIds || []).filter(Boolean);
    for (const adId of adIds) {
      const err = await activate(adId);
      if (err) adFailures.push(err);
    }
    if (adFailures.length === adIds.length && adIds.length > 0) {
      throw new Error(`No ad could be activated — first error: ${adFailures[0]}`);
    }
    let adsetErr = await activate(result.adSetId);
    // Known CBO trap: combined ad-set minimum spends exceed the campaign
    // budget — drop OUR min spend target and retry rather than dying
    if (adsetErr && /minimum spend/i.test(adsetErr)) {
      await fetch(`https://graph.facebook.com/v24.0/${result.adSetId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_min_spend_target: 0, access_token: token }),
      }).catch(() => {});
      adsetErr = await activate(result.adSetId);
      if (!adsetErr) result.minSpendDropped = true;
    }
    if (adsetErr) throw new Error(`Ad set activation failed: ${adsetErr}`);
    const campErr = await activate(result.campaignId);
    if (campErr) throw new Error(`Campaign activation failed: ${campErr}`);
    const liveCount = adIds.length - adFailures.length;
    return { detail: `LIVE — ${liveCount}/${adIds.length} ads${adFailures.length ? ` (${adFailures.length} failed: ${adFailures[0].slice(0, 120)})` : ''}`, result };
  }

  if (step.key === 'np_product') {
    const np = cfg.newProduct;
    const files = (result.listingImages || []).filter(Boolean);
    if (!files.length) throw new Error('Listing images missing — rerun the image steps');
    const { shopifyMutate } = await import('@/lib/shopify-sync');
    const now = Date.now();
    const title = `${np.brandName} ${np.productName}`;

    // Create with the hero image; add the rest one-by-one (keeps payloads small)
    const firstB64 = fs.readFileSync(files[0].filePath).toString('base64');
    const created = (await shopifyMutate(db, wf.storeId, 'POST', 'products.json', {
      product: {
        title,
        vendor: np.brandName,
        status: 'active',
        published: true,
        body_html: `<p>${np.brief.slice(0, 400)}</p>`,
        variants: [{ price: (np.priceCents / 100).toFixed(2), inventory_management: null }],
        images: [{ attachment: firstB64 }],
      },
    }, now))?.product;
    if (!created?.id) throw new Error('Shopify product creation returned no id');

    for (let i = 1; i < files.length; i++) {
      try {
        await shopifyMutate(db, wf.storeId, 'POST', `products/${created.id}/images.json`, {
          image: { attachment: fs.readFileSync(files[i].filePath).toString('base64'), position: i + 1 },
        }, now);
      } catch (e: any) { /* one bad image shouldn't sink the product */ }
    }

    // Local product row so the rest of the pipeline (audience/copy/ads) works
    const localId = crypto.randomUUID();
    const heroSrc = created.images?.[0]?.src || created.image?.src || null;
    db.prepare(`INSERT INTO products (id, store_id, shopify_product_id, title, image_url, price_cents, status, images, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'))`)
      .run(localId, wf.storeId, String(created.id), title, heroSrc, np.priceCents, JSON.stringify((created.images || []).map((im: any) => im.src)));

    result.shopifyProductId = String(created.id);
    result.productHandle = created.handle;
    // Rewrite the workflow's product id — later steps read wf.productId
    save(db, wf.id, { productId: localId });
    wf.productId = localId;
    return { detail: `${title} → Shopify #${created.id} (${files.length} images)`, result };
  }

  if (step.key === 'np_lander') {
    const np = cfg.newProduct;
    if (!result.shopifyProductId) throw new Error('Product missing — rerun np_product');
    const { generateLanderHtml } = await import('@/lib/ad-copy');
    const { shopifyMutate, shopifyGet } = await import('@/lib/shopify-sync');
    const now = Date.now();

    const html = await generateLanderHtml({
      brandName: np.brandName, productName: np.productName, priceCents: np.priceCents, brief: np.brief,
    });
    await shopifyMutate(db, wf.storeId, 'PUT', `products/${result.shopifyProductId}.json`, {
      product: { id: Number(result.shopifyProductId), body_html: html },
    }, now);

    const shop = (await shopifyGet(db, wf.storeId, 'shop.json', now))?.shop;
    const domain = shop?.domain || shop?.myshopify_domain;
    const landingUrl = `https://${domain}/products/${result.productHandle}`;
    db.prepare(`INSERT INTO product_landing_pages (store_id, product_id, url, source, updated_at) VALUES (?, ?, ?, 'resolved', datetime('now'))
      ON CONFLICT(store_id, product_id) DO UPDATE SET url = excluded.url, source = 'resolved', updated_at = datetime('now')`)
      .run(wf.storeId, wf.productId, landingUrl);
    // Later ad steps read cfg.landingUrl — persist it into the config
    const newCfg = { ...cfg, landingUrl };
    save(db, wf.id, { config: newCfg });
    wf.config = newCfg;
    result.landingUrl = landingUrl;
    return { detail: landingUrl, result };
  }

  if (step.key.startsWith('vad_')) {
    if (!profile?.access_token || !profile?.ad_account_id) throw new Error('FB profile missing token or ad account');
    if (!result.adSetId) throw new Error('Ad set missing — rerun the adset step');
    const idx = Number(step.key.split('_')[1]) - 1;
    const filePath = result.videoFiles?.[idx];
    const meta = result.videos?.[idx];
    if (!filePath || !fs.existsSync(filePath)) throw new Error(`Video file ${idx + 1} missing — rerun its download step`);

    const { uploadVideoFromBuffer, checkVideoProcessingStatus, createAdCreative, createAd } = await import('@/lib/facebook');
    result.fbVideoIds = result.fbVideoIds || [];

    // Upload once; re-poll on retries
    let fbVideoId = result.fbVideoIds[idx];
    if (!fbVideoId) {
      const up = await uploadVideoFromBuffer(profile.ad_account_id, profile.access_token,
        fs.readFileSync(filePath), `${cfg.campaignName} | video ${idx + 1}`);
      fbVideoId = up.id;
      result.fbVideoIds[idx] = fbVideoId;
      save(db, wf.id, { result });
    }

    // Wait for processing + a thumbnail (required for video creatives)
    let thumbnailUrl = '';
    for (let i = 0; i < 24; i++) {
      const st = await checkVideoProcessingStatus(fbVideoId, profile.access_token);
      if (st.thumbnailUrl) thumbnailUrl = st.thumbnailUrl;
      if (st.status === 'ready' && thumbnailUrl) break;
      if (st.status === 'error') throw new Error(`FB video processing failed for ${fbVideoId}`);
      await new Promise(r => setTimeout(r, 5000));
    }
    if (!thumbnailUrl) throw new Error(`Video ${fbVideoId} has no thumbnail yet — retry in a minute`);

    const adCreative = await createAdCreative(profile.ad_account_id, profile.access_token, {
      name: `${cfg.campaignName} | video ${idx + 1}`,
      pageId: cfg.pageId,
      videoId: fbVideoId,
      thumbnailUrl,
      title: result.copy?.headline || '',
      message: result.copy?.primaryText || '',
      ctaType: 'SHOP_NOW',
      ctaLink: cfg.landingUrl,
    });
    const ad = await createAd(profile.ad_account_id, profile.access_token, {
      name: `video ${idx + 1}${meta?.caption ? ` — ${meta.caption.slice(0, 40)}` : ''}`,
      adSetId: result.adSetId,
      creativeId: adCreative.id,
      status: 'PAUSED',
    });
    result.adIds = result.adIds || [];
    result.adIds[(cfg.adCount || 0) + idx] = ad.id;
    if (meta?.id) db.prepare("UPDATE video_ads_pool SET status = 'used', used_at = datetime('now') WHERE id = ?").run(meta.id);
    return { detail: `Video ad ${ad.id}`, result };
  }

  throw new Error(`Unknown step: ${step.key}`);
}
