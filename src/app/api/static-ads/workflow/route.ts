import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Product Launch Workflow — product in, live FB campaign out.
 *
 * Steps: audience → copy → image_1..N → campaign → adset → ad_1..N → done.
 * The client drives execution by calling {action:'advance'} repeatedly; each
 * call performs exactly ONE step and persists state, so a crash/restart never
 * loses progress and any error is retryable by advancing again.
 */

interface Step { key: string; label: string; status: 'pending' | 'done' | 'error'; detail?: string }

function ensureTable(db: any) {
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
}

function rowToWorkflow(r: any) {
  return {
    id: r.id, storeId: r.store_id, productId: r.product_id, name: r.name,
    status: r.status, steps: JSON.parse(r.steps_json || '[]'),
    config: JSON.parse(r.config_json || '{}'), result: JSON.parse(r.result_json || '{}'),
    error: r.error, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function save(db: any, id: string, fields: { steps?: Step[]; result?: any; status?: string; error?: string | null }) {
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];
  if (fields.steps) { sets.push('steps_json = ?'); params.push(JSON.stringify(fields.steps)); }
  if (fields.result) { sets.push('result_json = ?'); params.push(JSON.stringify(fields.result)); }
  if (fields.status) { sets.push('status = ?'); params.push(fields.status); }
  if (fields.error !== undefined) { sets.push('error = ?'); params.push(fields.error); }
  params.push(id);
  db.prepare(`UPDATE ad_workflows SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// GET ?storeId= → list | ?id= → one | ?profileId=&pages=1 → FB pages for profile
export async function GET(req: NextRequest) {
  const db = getDb();
  ensureTable(db);
  const id = req.nextUrl.searchParams.get('id');
  const storeId = req.nextUrl.searchParams.get('storeId');
  const profileId = req.nextUrl.searchParams.get('profileId');

  // Landing-page URLs via the centralized product-link resolver (lib/product-link)
  if (req.nextUrl.searchParams.get('landing') && storeId) {
    const prodId = req.nextUrl.searchParams.get('productId');
    if (!prodId) return NextResponse.json({ error: 'productId required' }, { status: 400 });
    try {
      const { resolveProductLink } = await import('@/lib/product-link');
      const link = await resolveProductLink(db, storeId, prodId);

      // Recommended destination first; homepage last and clearly labeled a manual choice
      const urls: { label: string; url: string }[] = [];
      if (link.customLandingPageUrl) urls.push({ label: `Custom landing page — ${link.productTitle}`, url: link.customLandingPageUrl });
      if (link.standardProductUrl) {
        urls.push({ label: `${link.validated || link.customLandingPageUrl ? '✓' : '⚠'} Product page — ${link.productTitle}${link.productStatus && link.productStatus !== 'active' ? ` (${link.productStatus})` : ''}`, url: link.standardProductUrl });
      }
      if (link.homepageUrl) urls.push({ label: 'Store homepage (manual choice — not recommended for product ads)', url: link.homepageUrl });

      return NextResponse.json({ urls, resolved: link });
    } catch (e: any) {
      return NextResponse.json({ error: `Product link resolution failed: ${String(e?.message || e).slice(0, 200)}` }, { status: 502 });
    }
  }

  if (profileId && req.nextUrl.searchParams.get('campaigns')) {
    const profile: any = db.prepare('SELECT access_token, ad_account_id FROM fb_profiles WHERE id = ? AND is_active = 1').get(profileId);
    if (!profile?.access_token || !profile?.ad_account_id) return NextResponse.json({ error: 'Profile missing token or ad account' }, { status: 400 });
    try {
      const { getCampaigns } = await import('@/lib/facebook');
      const campaigns = (await getCampaigns(profile.ad_account_id, profile.access_token))
        .filter(c => c.status !== 'DELETED' && c.status !== 'ARCHIVED');
      return NextResponse.json({ campaigns });
    } catch (e: any) {
      return NextResponse.json({ error: `Failed to fetch campaigns: ${e.message}` }, { status: 502 });
    }
  }

  if (profileId && req.nextUrl.searchParams.get('pages')) {
    const profile: any = db.prepare('SELECT access_token, fb_page_id, fb_page_name FROM fb_profiles WHERE id = ? AND is_active = 1').get(profileId);
    if (!profile?.access_token) return NextResponse.json({ error: 'Profile has no access token' }, { status: 400 });
    try {
      const { getPages } = await import('@/lib/facebook');
      const pages = await getPages(profile.access_token);
      return NextResponse.json({ pages, savedPageId: profile.fb_page_id || null });
    } catch (e: any) {
      return NextResponse.json({ error: `Failed to fetch pages: ${e.message}` }, { status: 502 });
    }
  }

  if (id) {
    const r: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(id);
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ workflow: rowToWorkflow(r) });
  }

  if (storeId) {
    const rows: any[] = db.prepare('SELECT * FROM ad_workflows WHERE store_id = ? ORDER BY created_at DESC LIMIT 20').all(storeId);
    // FB profiles for the launch config UI
    const profiles: any[] = db.prepare(
      'SELECT id, profile_name, ad_account_id, ad_account_name, fb_page_id, fb_page_name, pixel_id FROM fb_profiles WHERE store_id = ? AND is_active = 1'
    ).all(storeId);
    const store: any = db.prepare('SELECT shopify_domain FROM stores WHERE id = ?').get(storeId);
    return NextResponse.json({ workflows: rows.map(rowToWorkflow), profiles, shopifyDomain: store?.shopify_domain || null });
  }

  return NextResponse.json({ error: 'id or storeId required' }, { status: 400 });
}

// POST {action:'create'|'advance'|'cancel', ...}
export async function POST(req: NextRequest) {
  const db = getDb();
  ensureTable(db);
  const body = await req.json().catch(() => ({}));

  if (body.action === 'create') {
    const { storeId, config } = body;
    let { productId } = body;
    if (!storeId || !config?.profileId || !config?.pageId || !config?.landingUrl) {
      return NextResponse.json({ error: 'storeId, config.profileId, config.pageId, config.landingUrl required' }, { status: 400 });
    }

    // ── Batch mode: launch EXISTING generated ads instead of generating new ones ──
    const creativeIds: string[] = Array.isArray(config.creativeIds) ? config.creativeIds.slice(0, 50) : [];
    const batchMode = creativeIds.length > 0;
    const prefill: any = {};
    if (batchMode) {
      const rows = creativeIds.map(cid =>
        db.prepare("SELECT id, file_url, template_data, product_id, audience_id FROM creatives WHERE id = ? AND store_id = ?").get(cid, storeId)
      ).filter(Boolean) as any[];
      if (rows.length === 0) return NextResponse.json({ error: 'No valid creatives found for this store' }, { status: 400 });
      prefill.creatives = rows.map(r => {
        let templateName = '';
        try { templateName = JSON.parse(r.template_data || '{}').templateName || ''; } catch {}
        return { id: r.id, imageUrl: r.file_url, template: templateName || 'ad' };
      });
      prefill.audienceId = rows.find(r => r.audience_id)?.audience_id || null;
      if (!productId) productId = rows.find(r => r.product_id)?.product_id;
    }

    if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });
    const product: any = db.prepare('SELECT title FROM products WHERE id = ?').get(productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const adCount = batchMode ? prefill.creatives.length : Math.min(Math.max(Number(config.adCount) || 10, 1), 20);
    const goLive = config.launchStatus === 'ACTIVE';
    const useExistingCampaign = !!config.existingCampaignId;
    // Everything on Facebook is created PAUSED regardless of config — the
    // launch gate + activate step are the ONLY way anything starts spending.
    const steps: Step[] = [
      ...(batchMode && prefill.audienceId ? [] : [{ key: 'audience', label: 'Generate audience (Fable 5)', status: 'pending' as const }]),
      { key: 'copy', label: 'Write ad copy (Fable 5)', status: 'pending' },
      ...(batchMode ? [] : Array.from({ length: adCount }, (_, i) => ({ key: `image_${i + 1}`, label: `Generate picture ad ${i + 1}/${adCount}`, status: 'pending' as const }))),
      { key: 'gate_review', label: `REVIEW GATE — approve ${batchMode ? `the ${adCount} selected ads` : 'audience, copy & ads'} before anything touches Facebook`, status: 'pending' },
      { key: 'campaign', label: useExistingCampaign ? 'Attach to existing FB campaign' : 'Create FB campaign (paused)', status: 'pending' },
      { key: 'adset', label: `Create ad set (paused, $${((Number(config.dailyBudgetCents) || 1000) / 100).toFixed(2)}/day)`, status: 'pending' },
      ...Array.from({ length: adCount }, (_, i) => ({ key: `ad_${i + 1}`, label: `Upload + create ad ${i + 1}/${adCount} (paused)`, status: 'pending' as const })),
      ...(goLive ? [
        { key: 'gate_launch', label: 'LAUNCH GATE — final approval before ads go LIVE and spend begins', status: 'pending' as const },
        { key: 'activate', label: 'Activate campaign + ad set + ads', status: 'pending' as const },
      ] : []),
    ];

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
          ageMin: Math.min(Math.max(Number(config.targeting?.ageMin) || 25, 18), 65),
          ageMax: Math.min(Math.max(Number(config.targeting?.ageMax) || 65, 18), 65),
          gender: ['all', 'women', 'men'].includes(config.targeting?.gender) ? config.targeting.gender : 'all',
        },
        schedule: {
          // ISO datetime for a future start, or null = deliver as soon as live
          startAt: config.schedule?.startAt && !isNaN(Date.parse(config.schedule.startAt)) ? config.schedule.startAt : null,
          // days to run; 0/null = no end (runs until manually stopped)
          durationDays: Math.min(Math.max(Number(config.schedule?.durationDays) || 0, 0), 90),
        },
      }), JSON.stringify(prefill));

    const r: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(id);
    return NextResponse.json({ workflow: rowToWorkflow(r) });
  }

  if (body.action === 'cancel') {
    save(db, body.id, { status: 'cancelled', error: null });
    const r: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(body.id);
    return NextResponse.json({ workflow: rowToWorkflow(r) });
  }

  if (body.action === 'approve') {
    const r: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(body.id);
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const wf = rowToWorkflow(r);
    const steps: Step[] = wf.steps;
    const gate = steps.find(s => s.key === body.stepKey && s.key.startsWith('gate_'));
    if (!gate) return NextResponse.json({ error: 'Gate not found' }, { status: 400 });
    gate.status = 'done';
    gate.detail = `Approved ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const allDone = steps.every(s => s.status === 'done');
    save(db, wf.id, { steps, status: allDone ? 'done' : 'running', error: null });
    const updated: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(wf.id);
    return NextResponse.json({ workflow: rowToWorkflow(updated) });
  }

  if (body.action === 'advance') {
    const r: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(body.id);
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const wf = rowToWorkflow(r);
    if (wf.status === 'done' || wf.status === 'cancelled') return NextResponse.json({ workflow: wf });

    const steps: Step[] = wf.steps;
    const step = steps.find(s => s.status !== 'done');
    if (!step) {
      save(db, wf.id, { status: 'done', error: null });
      return NextResponse.json({ workflow: { ...wf, status: 'done' } });
    }

    // Gates never execute — they hold the workflow until explicitly approved
    if (step.key.startsWith('gate_')) {
      if (wf.status !== 'awaiting_approval') save(db, wf.id, { status: 'awaiting_approval', error: null });
      const held: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(wf.id);
      return NextResponse.json({ workflow: rowToWorkflow(held) });
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

    const updated: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(wf.id);
    return NextResponse.json({ workflow: rowToWorkflow(updated) });
  }

  if (body.action === 'retry') {
    const r: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(body.id);
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const wf = rowToWorkflow(r);
    const steps: Step[] = wf.steps.map((s: Step) => s.status === 'error' ? { ...s, status: 'pending' as const, detail: undefined } : s);
    save(db, wf.id, { steps, status: 'running', error: null });
    const updated: any = db.prepare('SELECT * FROM ad_workflows WHERE id = ?').get(wf.id);
    return NextResponse.json({ workflow: rowToWorkflow(updated) });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
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
      return { detail: `Using existing campaign ${cfg.existingCampaignId}`, result };
    }
    const { createCampaign } = await import('@/lib/facebook');
    // Always PAUSED — the launch gate + activate step control going live
    const campaign = await createCampaign(profile.ad_account_id, profile.access_token, {
      name: cfg.campaignName, status: 'PAUSED',
    });
    result.campaignId = campaign.id;
    return { detail: `Campaign ${campaign.id} (paused)`, result };
  }

  if (step.key === 'adset') {
    if (!profile?.access_token || !profile?.ad_account_id) throw new Error('FB profile missing token or ad account');
    if (!result.campaignId) throw new Error('Campaign missing — rerun the campaign step');
    const { createAdSet } = await import('@/lib/facebook');
    const hasPixel = !!profile.pixel_id;
    const t = cfg.targeting || { countries: ['US'], ageMin: 25, ageMax: 65, gender: 'all' };
    const adset = await createAdSet(profile.ad_account_id, profile.access_token, {
      name: `${cfg.campaignName} | AdSet 1`,
      campaignId: result.campaignId,
      dailyBudgetCents: cfg.dailyBudgetCents,
      status: 'PAUSED',
      // No pixel → conversions optimization is invalid; optimize for link clicks
      optimizationGoal: hasPixel ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
      pixelId: hasPixel ? profile.pixel_id : undefined,
      targeting: {
        geo_locations: { countries: t.countries },
        age_min: t.ageMin,
        age_max: t.ageMax,
        ...(t.gender === 'women' ? { genders: [2] } : t.gender === 'men' ? { genders: [1] } : {}),
      },
      // Schedule: future start if configured; end_time makes Meta stop
      // delivery automatically — total spend is bounded at daily × days
      ...(() => {
        const sched = cfg.schedule || {};
        const startMs = sched.startAt && Date.parse(sched.startAt) > Date.now() ? Date.parse(sched.startAt) : Date.now();
        const out: any = {};
        if (sched.startAt && startMs > Date.now()) out.startTime = new Date(startMs).toISOString();
        if (sched.durationDays > 0) out.endTime = new Date(startMs + sched.durationDays * 86_400_000).toISOString();
        return out;
      })(),
    });
    result.adSetId = adset.id;
    const sched = cfg.schedule || {};
    const schedNote = sched.durationDays > 0
      ? `, auto-stops after ${sched.durationDays}d (max $${((cfg.dailyBudgetCents * sched.durationDays) / 100).toFixed(2)} total)`
      : ', no end date';
    return { detail: `Ad set ${adset.id}${hasPixel ? '' : ' (no pixel — link clicks)'}${schedNote}`, result };
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
