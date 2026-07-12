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

function save(db: Database.Database, id: string, fields: { steps?: Step[]; result?: any; status?: string; error?: string | null }) {
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];
  if (fields.steps) { sets.push('steps_json = ?'); params.push(JSON.stringify(fields.steps)); }
  if (fields.result) { sets.push('result_json = ?'); params.push(JSON.stringify(fields.result)); }
  if (fields.status) { sets.push('status = ?'); params.push(fields.status); }
  if (fields.error !== undefined) { sets.push('error = ?'); params.push(fields.error); }
  params.push(id);
  db.prepare(`UPDATE ad_workflows SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

/** Create a workflow (generate mode, or batch mode when config.creativeIds set).
 *  Throws Error with a user-facing message on invalid input. */
export function createLaunchWorkflow(db: Database.Database, storeId: string, productIdIn: string | undefined, config: any): LaunchWorkflow {
  ensureWorkflowTables(db);
  let productId = productIdIn;
  if (!storeId || !config?.profileId || !config?.pageId || !config?.landingUrl) {
    throw new Error('storeId, config.profileId, config.pageId, config.landingUrl required');
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

  if (!productId) throw new Error('productId required');
  const product: any = db.prepare('SELECT title FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');

  const adCount = batchMode ? prefill.creatives.length : Math.min(Math.max(Number(config.adCount) || 10, 1), 20);
  const goLive = config.launchStatus === 'ACTIVE';
  const useExistingCampaign = !!config.existingCampaignId;
  // Everything on Facebook is created PAUSED regardless of config — the
  // launch gate + activate step are the ONLY way anything starts spending.
  const steps: Step[] = [
    ...(batchMode && prefill.audienceId ? [] : [{ key: 'audience', label: 'Generate audience (Fable 5)', status: 'pending' as const }]),
    { key: 'copy', label: 'Write ad copy (Fable 5)', status: 'pending' },
    ...(batchMode ? [] : Array.from({ length: adCount }, (_, i) => ({ key: `image_${i + 1}`, label: `Generate picture ad ${i + 1}/${adCount}`, status: 'pending' as const }))),
    { key: 'campaign', label: useExistingCampaign ? 'Attach to existing FB campaign' : 'Create FB campaign (paused)', status: 'pending' },
    { key: 'adset', label: `Create ad set (paused, $${((Number(config.dailyBudgetCents) || 1000) / 100).toFixed(2)}/day)`, status: 'pending' },
    ...Array.from({ length: adCount }, (_, i) => ({ key: `ad_${i + 1}`, label: `Upload + create ad ${i + 1}/${adCount} (paused)`, status: 'pending' as const })),
    ...(goLive ? [
      { key: 'gate_launch', label: 'LAUNCH GATE — final approval before ads go LIVE and spend begins', status: 'pending' as const },
      { key: 'activate', label: 'Activate campaign + ad set + ads', status: 'pending' as const },
    ] : []),
  ];

  // The URL this run actually uses becomes the product's saved lander —
  // next runs prefill it instantly and consistently
  db.prepare(`INSERT INTO product_landing_pages (store_id, product_id, url, source, updated_at) VALUES (?, ?, ?, 'manual', datetime('now'))
    ON CONFLICT(store_id, product_id) DO UPDATE SET url = excluded.url, source = 'manual', updated_at = datetime('now')`)
    .run(storeId, productId, String(config.landingUrl));

  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO ad_workflows (id, store_id, product_id, name, steps_json, config_json, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, storeId, productId, `${product.title.slice(0, 60)} — ${adCount} ads${batchMode ? ' (batch)' : ''}`, JSON.stringify(steps), JSON.stringify({
      adCount,
      mode: batchMode ? 'batch' : 'generate',
      creativeIds: batchMode ? creativeIds : undefined,
      existingCampaignId: useExistingCampaign ? config.existingCampaignId : null,
      dailyBudgetCents: Math.max(Number(config.dailyBudgetCents) || 1000, 100),
      launchStatus: config.launchStatus === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      profileId: config.profileId,
      pageId: config.pageId,
      landingUrl: config.landingUrl,
      audienceId: config.audienceId || null,
      selectedImageUrl: config.selectedImageUrl || null,
      campaignName: config.campaignName || `${product.title.slice(0, 40)} | Launch ${new Date().toISOString().slice(0, 10)}`,
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
    const a = await generateAudienceFromProduct(product);
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
    const adset = await createAdSet(profile.ad_account_id, profile.access_token, {
      name: `${cfg.campaignName} | AdSet 1`,
      campaignId: result.campaignId,
      dailyBudgetCents: cfg.dailyBudgetCents,
      cbo: isCbo, // CBO campaign owns the budget — ad set carries none
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
    const activate = async (objectId: string) => {
      const res = await fetch(`https://graph.facebook.com/v24.0/${objectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE', access_token: profile.access_token }),
      });
      const d = await res.json();
      if (d.error) throw new Error(`Activate ${objectId} failed: ${d.error.message}`);
    };
    // Ads first, then ad set, then campaign — nothing serves until the campaign flips
    for (const adId of (result.adIds || []).filter(Boolean)) await activate(adId);
    await activate(result.adSetId);
    await activate(result.campaignId);
    return { detail: `LIVE — ${(result.adIds || []).filter(Boolean).length} ads at $${(cfg.dailyBudgetCents / 100).toFixed(2)}/day`, result };
  }

  throw new Error(`Unknown step: ${step.key}`);
}
