import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { chatCompletion } from '@/lib/openai-chat';
import { buildCreativeIntent, buildFastContract, buildGenerationContract, validateGeneratorInputs, CREATIVE_TYPES, FUNNEL_STAGES, HOOK_STYLES, AVATAR_STYLES } from '@/lib/creative-taxonomy';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ═══ Server-side intelligence cache ═══
// Cache intelligence per store for 5 minutes — avoids re-running 6+ SQL queries per generation
const intelCache = new Map<string, { data: any; ts: number }>();
const INTEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedIntel(storeId: string): any | null {
  const cached = intelCache.get(storeId);
  if (cached && Date.now() - cached.ts < INTEL_CACHE_TTL) return cached.data;
  return null;
}
function setCachedIntel(storeId: string, data: any) {
  intelCache.set(storeId, { data, ts: Date.now() });
  // Evict old entries (max 20 stores cached)
  if (intelCache.size > 20) {
    const oldest = [...intelCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) intelCache.delete(oldest[0]);
  }
}

// ═══ Response helpers ═══

function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

function jsonError(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

// ═══ Normalize legacy values ═══

function normalize(val: string): string {
  const legacyMap: Record<string, string> = {
    'aggressive': 'pattern_interrupt', 'broll': 'b_roll',
    'review-social-proof': 'social_proof', 'podcast': 'podcast_style',
    'faceless': 'faceless_product_only',
    'use-winner-base': 'use_winner_as_base', 'refresh-fatigued': 'refresh_fatigued_ad',
    'new-format': 'winner_to_new_format', 'new-concept': 'new_concept',
  };
  if (legacyMap[val]) return legacyMap[val];
  return val.replace(/-/g, '_');
}

// ═══ Comparative Strategy Engine ═══

function buildStrategy(intel: any, config: any, db: any, storeId: string) {
  const m = intel?.metrics || {};
  const w = intel?.winners || {};
  const t = intel?.trends || {};
  const recs = intel?.recommendations || {};

  const bestROAS = w.topCreativesByROAS?.[0];
  const bestCTR = w.topHooksByCTR?.[0];
  const bestCPA = w.mostEfficientByCPA?.[0];
  const bestCVR = w.topConvertersByCVR?.[0];
  const topScaler = w.scalingWinnersBySpend?.[0];
  const hasData = m.totalAds > 0;

  const funnelAnalysis: { verdict: 'strong' | 'weak' | 'neutral'; override?: string; reason: string } = (() => {
    if (!hasData) return { verdict: 'neutral', reason: 'No account data — using best practices' };
    const fatigueCount = t.fatigueSignals?.length || 0;
    const risingCount = t.rising?.length || 0;
    const avgRoas = m.avgRoas || 0;
    if (config.funnelStage === 'tof') {
      if (avgRoas > 2 && fatigueCount === 0) return { verdict: 'weak', override: 'bof', reason: `Account ROAS is ${avgRoas}x with no fatigue — strong enough for BOF` };
      if (risingCount > 2) return { verdict: 'strong', reason: `${risingCount} ads gaining momentum — TOF testing will compound winners` };
      return { verdict: 'neutral', reason: `TOF is reasonable at ${avgRoas}x avg ROAS` };
    }
    if (config.funnelStage === 'mof') {
      if (avgRoas < 0.8) return { verdict: 'weak', override: 'tof', reason: `Avg ROAS ${avgRoas}x — need fresh TOF hooks first` };
      if (m.avgCvr > 3) return { verdict: 'strong', reason: `${m.avgCvr}% avg CVR — MOF trust content will push conversions` };
      return { verdict: 'neutral', reason: `MOF is appropriate at ${avgRoas}x ROAS` };
    }
    if (fatigueCount > 2) return { verdict: 'weak', override: 'tof', reason: `${fatigueCount} fatigued ads — BOF needs fresh TOF pipeline` };
    if (avgRoas > 1.5 && m.adsWithPurchases > 5) return { verdict: 'strong', reason: `${m.adsWithPurchases} converting ads at ${avgRoas}x — BOF will maximize momentum` };
    return { verdict: 'neutral', reason: `BOF viable with ${m.adsWithPurchases} converting ads` };
  })();

  const productAnalysis: { verdict: 'strong' | 'weak' | 'neutral'; suggestion?: string; reason: string } = (() => {
    const pp = intel?.productPerformance || [];
    if (!config.productId || pp.length === 0) return { verdict: 'neutral', reason: 'No product performance data' };
    const selected = pp.find((p: any) => p.productId === config.productId);
    const best = pp[0];
    if (!selected && best) return { verdict: 'weak', suggestion: best.name, reason: `Selected product has no data — "${best.name}" has ${best.purchases} purchases at ${best.roas}x ROAS` };
    if (selected && best && selected.productId !== best.productId && best.roas > selected.roas * 1.5) return { verdict: 'weak', suggestion: best.name, reason: `"${best.name}" outperforms: ${best.roas}x vs ${selected.roas}x` };
    if (selected) return { verdict: 'strong', reason: `Selected product: ${selected.roas}x ROAS, ${selected.purchases} purchases` };
    return { verdict: 'neutral', reason: 'Product comparison inconclusive' };
  })();

  const recommendedAngle = bestROAS ? `Model after "${bestROAS.name}" — ${bestROAS.roas}x ROAS, ${bestROAS.purchases} purchases` : 'UGC testimonial with product demo';
  const recommendedHook = bestCTR ? `"${bestCTR.hook}" — ${bestCTR.ctr}% CTR across ${bestCTR.impressions?.toLocaleString()} impressions` : 'Curiosity-driven question or bold claim';

  const structureMap: Record<string, string> = {
    'tof': 'Hook (0-3s) → Relatable problem (3-8s) → Product tease (8-15s) → Soft CTA (15-20s)',
    'mof': 'Social proof hook (0-3s) → Product education (3-10s) → Results/evidence (10-18s) → CTA (18-20s)',
    'bof': 'Urgency hook (0-2s) → Offer reveal (2-5s) → Proof stack (5-15s) → Hard CTA (15-20s)',
  };
  const recommendedStructure = structureMap[funnelAnalysis.override || config.funnelStage] || structureMap.tof;

  const recommendedCta = (() => {
    if (bestROAS?.name) {
      try {
        const adCta: any = db.prepare('SELECT ad_cta FROM ad_spend WHERE ad_name = ? AND store_id = ? AND ad_cta IS NOT NULL LIMIT 1').get(bestROAS.name, storeId);
        if (adCta?.ad_cta) return `"${adCta.ad_cta.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}" — from #1 ROAS ad`;
      } catch {}
    }
    const d: Record<string, string> = { 'tof': 'Soft CTA', 'mof': 'Medium CTA', 'bof': 'Hard CTA with urgency' };
    return d[config.funnelStage] || d.tof;
  })();

  const recommendedFormat = config.contentType === 'video' ? 'UGC vertical video (9:16), 15-30s' : 'Static image, 1080x1080 or 1080x1350';

  const confidence = (() => {
    if (!hasData) return 15;
    let s = 20;
    s += Math.min(m.totalAds, 30); s += Math.min(m.adsWithPurchases, 15) * 2;
    if (bestROAS) s += 5; if (bestCTR) s += 5; if (bestCPA) s += 5;
    if ((t.rising?.length || 0) > 0) s += 3;
    if (funnelAnalysis.verdict === 'strong') s += 5;
    if (productAnalysis.verdict === 'strong') s += 5;
    return Math.min(95, s);
  })();

  const overrides: any[] = [];
  if (funnelAnalysis.verdict === 'weak' && funnelAnalysis.override) overrides.push({ field: 'Funnel Stage', current: config.funnelStage.toUpperCase(), suggested: funnelAnalysis.override.toUpperCase(), reason: funnelAnalysis.reason });
  if (productAnalysis.verdict === 'weak' && productAnalysis.suggestion) overrides.push({ field: 'Product', current: 'Selected', suggested: productAnalysis.suggestion, reason: productAnalysis.reason });

  const evidence: any[] = [];
  if (bestCTR) evidence.push({ metric: 'CTR Leader', leader: bestCTR.hook || bestCTR.name, value: `${bestCTR.ctr}%`, insight: `${bestCTR.impressions?.toLocaleString()} impressions tested` });
  if (bestROAS) evidence.push({ metric: 'ROAS Leader', leader: bestROAS.name, value: `${bestROAS.roas}x`, insight: `${bestROAS.purchases} purchases on $${(bestROAS.spend / 100).toFixed(0)} spend` });
  if (bestCVR) evidence.push({ metric: 'CVR Leader', leader: bestCVR.name, value: `${bestCVR.cvr}%`, insight: `${bestCVR.purchases} purchases from ${bestCVR.clicks?.toLocaleString()} clicks` });
  if (bestCPA) evidence.push({ metric: 'CPA Leader', leader: bestCPA.name, value: `$${bestCPA.cpa}`, insight: `${bestCPA.purchases} customers at $${bestCPA.cpa} each` });
  if (topScaler) evidence.push({ metric: 'Scale Proof', leader: topScaler.name, value: `$${(topScaler.spend / 100).toFixed(0)}`, insight: `${topScaler.roas}x ROAS at volume` });

  const reasons: string[] = [funnelAnalysis.reason];
  if (productAnalysis.verdict !== 'neutral') reasons.push(productAnalysis.reason);
  if ((t.fatigueSignals?.length || 0) > 0) reasons.push(`${t.fatigueSignals.length} ad(s) fatiguing`);
  if ((t.rising?.length || 0) > 0) reasons.push(`${t.rising.length} ad(s) gaining momentum`);

  return { recommendedAngle, recommendedHook, recommendedStructure, recommendedCta, recommendedFormat, confidence, reasons, overrides, evidence, funnelVerdict: funnelAnalysis.verdict, productVerdict: productAnalysis.verdict };
}

// ═══ POST: Generate Creative Package ═══

export async function POST(req: NextRequest) {
  // ── Parse body safely ──
  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    return jsonError('INVALID_BODY', 'Request body is not valid JSON', e.message, 400);
  }

  const { storeId, productId, offer, baseAdId, parentId, parentPackageIndex } = body;

  const contentType = normalize(body.contentType || 'video');
  const creativeType = normalize(body.creativeType || 'testimonial');
  const funnelStage = normalize(body.funnelStage || 'tof');
  const hookStyle = normalize(body.hookStyle || 'curiosity');
  const avatarStyle = normalize(body.avatarStyle || 'female_ugc');
  const generationGoal = normalize(body.generationGoal || 'new_concept');
  const platformTarget = body.platformTarget || 'meta';
  const quantity = body.quantity || 3;
  const hooksPerConcept = body.hooksPerConcept || 1;
  const variationsPerHook = body.variationsPerHook || 1;
  const conceptAngle = (body.conceptAngle || '').trim();
  const totalPackages = Math.min(quantity * hooksPerConcept * variationsPerHook, 5);
  const fastMode = body.fast !== false; // fast mode ON by default

  if (!storeId) {
    return jsonError('MISSING_STORE', 'storeId is required', null, 400);
  }

  let db: any;
  try {
    db = getDb();
  } catch (e: any) {
    return jsonError('DB_ERROR', 'Database connection failed', e.message, 500);
  }

  const packageId = crypto.randomUUID();

  // ── Validate inputs (instant, no I/O) ──
  const validation = validateGeneratorInputs({ contentType, creativeType, funnelStage, hookStyle, avatarStyle, generationGoal, quantity });
  if (!validation.valid) {
    return jsonError('INVALID_INPUTS', `Input validation failed: ${validation.errors.join(', ')}`, { errors: validation.errors }, 400);
  }

  // ── Duplicate detection: check if identical config was generated in last 10 minutes ──
  if (!parentId) { // Skip for variations — they're intentionally same config
    try {
      const recent: any = db.prepare(`
        SELECT id, packages, strategy FROM creative_packages
        WHERE store_id = ? AND content_type = ? AND creative_type = ? AND funnel_stage = ?
          AND hook_style = ? AND avatar_style = ? AND generation_goal = ? AND quantity = ?
          AND COALESCE(product_id,'') = ? AND status = 'completed'
          AND created_at > datetime('now', '-10 minutes')
        ORDER BY created_at DESC LIMIT 1
      `).get(storeId, contentType, creativeType, funnelStage, hookStyle, avatarStyle, generationGoal, quantity, productId || '');
      if (recent?.packages) {
        return jsonSuccess({
          id: recent.id,
          packages: JSON.parse(recent.packages),
          strategy: recent.strategy ? JSON.parse(recent.strategy) : null,
          config: { contentType, creativeType, funnelStage, hookStyle, avatarStyle, generationGoal, quantity },
          cached: true,
          cacheReason: 'Identical generation found from last 10 minutes. Returning cached result to save API costs.',
        });
      }
    } catch {} // If check fails, proceed with fresh generation
  }

  // ── Stage 1: Parallel data loading (intelligence + product + base ad + parent) ──
  let intel: any = null;
  let productObj: any = null;
  let productInfo = '';
  let baseAdContext = '';
  let parentPackageContext = '';
  let parentVersion = 0;
  let isVariation = false;

  // All DB queries and the intelligence call run in parallel
  const [intelResult, productResult, baseAdResult, parentResult] = await Promise.allSettled([
    // Intelligence fetch (cached for 5 min per store)
    (async () => {
      const cached = getCachedIntel(storeId);
      if (cached) return cached;
      const { GET: getIntelligence } = await import('@/app/api/creatives/intelligence/route');
      const intelReq = new NextRequest(new URL(`/api/creatives/intelligence?storeId=${storeId}`, req.url));
      const intelRes = await getIntelligence(intelReq);
      const data = (await intelRes.json()).intelligence;
      if (data) setCachedIntel(storeId, data);
      return data;
    })(),
    // Product lookup
    productId ? Promise.resolve(db.prepare('SELECT * FROM products WHERE id = ?').get(productId)) : Promise.resolve(null),
    // Base ad lookup
    baseAdId && ['use_winner_as_base', 'generate_variations', 'refresh_fatigued_ad'].includes(generationGoal)
      ? Promise.resolve(db.prepare('SELECT ad_name, ad_headline, ad_body, ad_cta, video_analysis FROM ad_spend WHERE ad_id = ? AND store_id = ? LIMIT 1').get(baseAdId, storeId))
      : Promise.resolve(null),
    // Parent package lookup
    parentId ? Promise.resolve(db.prepare('SELECT * FROM creative_packages WHERE id = ?').get(parentId)) : Promise.resolve(null),
  ]);

  // Process results
  if (intelResult.status === 'fulfilled' && intelResult.value) intel = intelResult.value;

  if (productResult.status === 'fulfilled' && productResult.value) {
    productObj = productResult.value;
    productInfo = `\nProduct: ${productObj.title}\nDescription: ${productObj.description || 'N/A'}\nPrice: $${(productObj.price_cents / 100).toFixed(2)}\nCategory: ${productObj.category || 'Health & Beauty'}`;
    if (offer) productInfo += `\nOffer: ${offer}`;
  }

  if (baseAdResult.status === 'fulfilled' && baseAdResult.value) {
    const adRow = baseAdResult.value as any;
    baseAdContext = `\n\n=== WINNING AD DNA (PRESERVE THIS STRATEGY) ===\nAd: ${adRow.ad_name || "N/A"}\nHeadline: ${adRow.ad_headline || "N/A"}\nCTA: ${adRow.ad_cta || "N/A"}\nCopy:\n${adRow.ad_body || "N/A"}\n\nWINNER DNA RULES (MANDATORY when goal is use_winner_as_base):\n1. PRESERVE the exact marketing angle of this winning ad\n2. PRESERVE the hook pattern — use the same type of opener\n3. PRESERVE the ad structure — same flow (hook > context > proof > CTA)\n4. PRESERVE the CTA style — same urgency level and phrasing approach\n5. PRESERVE the proof/trust strategy — same type of evidence used\n6. PRESERVE the emotional arc — same feelings triggered in same order\n7. CHANGE only: specific wording, visual setting, presenter, minor phrasing\n8. The output MUST feel like a close strategic descendant of this winner\n9. Do NOT create a completely different concept\n10. If the winner uses urgency, your output uses urgency. If it uses social proof, yours uses social proof.`;
    if (adRow.video_analysis) baseAdContext += `\n\nDNA:\n${adRow.video_analysis}`;
  }

  if (parentResult.status === 'fulfilled' && parentResult.value) {
    const parentRow = parentResult.value as any;
    isVariation = true;
    parentVersion = parentRow.version || 1;
    const parentPackages = parentRow.packages ? JSON.parse(parentRow.packages) : [];
    const sourcePackage = parentPackages[parentPackageIndex ?? 0];
    if (sourcePackage) {
      parentPackageContext = `\n\n═══ SOURCE TO VARY ═══\nTitle: ${sourcePackage.title || 'N/A'}\nAngle: ${sourcePackage.angle || sourcePackage.conceptAngle || 'N/A'}\nHook: ${sourcePackage.hook || sourcePackage.headline || 'N/A'}\n${sourcePackage.script ? `Script:\n${sourcePackage.script}` : ''}\nCTA: ${sourcePackage.cta || sourcePackage.ctaDirection || 'N/A'}\nVARIATION: Keep core angle, change hook/emotion/structure/CTA. Label what changed.`;
    }
  }

  // ── Stage 2: Strategy (uses intel, instant computation) ──
  let strategy: any;
  try {
    strategy = buildStrategy(intel, { contentType, creativeType, funnelStage, hookStyle, avatarStyle, productId }, db, storeId);
  } catch (e: any) {
    return jsonError('STRATEGY_ERROR', 'Strategy engine failed', e.message, 500);
  }

  // ── Build prompt context from intelligence ──
  let winningAdsContext = '';
  // ── Build context (compact in fast mode) ──
  const topAdsForPrompt = intel?._forPrompt?.topAds || [];
  const adsLimit = fastMode ? 3 : 10; // Fewer ads context in fast mode
  if (topAdsForPrompt.length > 0) {
    winningAdsContext = '\n\nTOP ADS:\n';
    topAdsForPrompt.slice(0, adsLimit).forEach((ad: any, i: number) => {
      winningAdsContext += `#${i + 1} ${ad.roas}x ROAS, ${ad.purchases}p, ${ad.ctr}% CTR | "${ad.headline || ad.name}"\n`;
      if (!fastMode && ad.body) winningAdsContext += `Copy: ${ad.body}\n`;
    });
  }
  const fatiguedNames = intel?._forPrompt?.fatiguedNames || [];
  const learnedWins = (intel?._forPrompt?.learnedWins || []).slice(0, fastMode ? 2 : 5);
  const learnedLosses = (intel?._forPrompt?.learnedLosses || []).slice(0, fastMode ? 2 : 5);

  // ── Stage 3: Build contract (fast or full) + generate via ChatGPT ──
  let systemPrompt: string;
  try {
    const creativeIntent = buildCreativeIntent({
      contentType, creativeType, funnelStage, hookStyle, avatarStyle, generationGoal, platformTarget,
      product: productObj ? { title: productObj.title, description: productObj.description, category: productObj.category, priceCents: productObj.price_cents } : null,
      offer: offer || undefined,
      accountInsights: intel ? { avgRoas: intel.metrics?.avgRoas, avgCtr: intel.metrics?.avgCtr, avgCpa: intel.metrics?.avgCpa, learnedWins, learnedLosses, fatiguedNames } : null,
    });
    // Fast mode: compact contract (~1200 tokens). Full mode: complete contract (~2800 tokens).
    const contract = fastMode ? buildFastContract(creativeIntent, contentType, totalPackages, funnelStage) : buildGenerationContract(creativeIntent, contentType, totalPackages);
    const addendum = [
      strategy.evidence?.length > 0 ? `\nEvidence: ${strategy.evidence.slice(0, 3).map((e: any) => `${e.metric}: ${e.value}`).join(', ')}` : '',
      strategy.overrides?.length > 0 ? `\nOverrides: ${strategy.overrides.map((o: any) => `${o.field}: ${o.current}→${o.suggested}`).join(', ')}` : '',
    ].filter(Boolean).join('');
    systemPrompt = contract + addendum;
  } catch (e: any) {
    return jsonError('CONTRACT_ERROR', 'Failed to build generation contract', e.message, 500);
  }

  const angleContext = conceptAngle ? `\n\nCUSTOM ANGLE (use this as the primary creative direction — all packages must revolve around this angle): ${conceptAngle}` : '';
  const userPrompt = isVariation
    ? `Generate ${totalPackages} VARIATIONS.${parentPackageContext}${productInfo}${winningAdsContext}`
    : `Generate ${totalPackages} ${contentType} creative packages.${angleContext}${productInfo}${baseAdContext}${winningAdsContext}`;

  let packages: any[] = [];
  let usage: any = null;

  try {
    const result = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.9, maxTokens: Math.min(4096, 800 * totalPackages + 200) });

    usage = result.usage;

    try {
      const cleaned = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      packages = JSON.parse(cleaned).packages || [];
    } catch (parseErr: any) {
      return jsonError('PARSE_ERROR', 'ChatGPT returned unparseable response', { parseError: parseErr.message, rawLength: result.content?.length }, 500);
    }
  } catch (err: any) {
    // ── Quota / rate-limit detection ──
    if (err.isQuota || err.code === 'insufficient_quota' || err.status === 429) {
      console.error(`[QUOTA] OpenAI quota exceeded for store ${storeId} at ${new Date().toISOString()}`);

      // Fallback: generate rule-based packages from strategy + taxonomy (no AI needed)
      const fallbackPackages = Array.from({ length: totalPackages }, (_, i) => {
        const productTitle = productObj?.title || 'your product';
        const hookExamples = HOOK_STYLES[hookStyle]?.exampleFormats || ['"Did you know..."'];
        const hookExample = hookExamples[i % hookExamples.length] || hookExamples[0];
        const funnelCta = FUNNEL_STAGES[funnelStage]?.ctaStyle || 'Check it out';
        const avatarDesc = AVATAR_STYLES[avatarStyle]?.castingNotes || 'Relatable presenter';

        if (contentType === 'video') {
          return {
            title: `${CREATIVE_TYPES[creativeType]?.label || 'Creative'} — ${productTitle} v${i + 1}`,
            angle: `${CREATIVE_TYPES[creativeType]?.label || 'testimonial'} approach for ${productTitle}`,
            hook: hookExample.replace(/\[.*?\]/g, productTitle),
            script: `[Draft — AI unavailable] ${hookExample}. ${productTitle} ${CREATIVE_TYPES[creativeType]?.definition?.split('.')[0] || 'helps solve a real problem'}. ${funnelCta.split(':')[0]}.`,
            sceneStructure: strategy?.recommendedStructure || 'Hook 0-3s → Context 3-8s → Product 8-15s → CTA 15-20s',
            visualDirection: 'Handheld camera, natural lighting, real environment. Show the actual product.',
            brollDirection: `Close-up of ${productTitle} packaging, product in hand, product in use`,
            presenterBehavior: avatarDesc,
            pacingNotes: 'Natural UGC pacing, not over-edited',
            cta: funnelCta.split(':')[0],
            adCopy: `[Draft] ${CREATIVE_TYPES[creativeType]?.useCase || ''} ${offer ? `Offer: ${offer}` : ''}`,
            headline: `${productTitle.substring(0, 35)}`,
            variants: ['Change hook style', 'Change CTA approach', 'Change presenter'],
            _fallback: true,
          };
        }
        return {
          title: `${CREATIVE_TYPES[creativeType]?.label || 'Creative'} — ${productTitle} v${i + 1}`,
          angle: `${CREATIVE_TYPES[creativeType]?.label || 'image'} concept for ${productTitle}`,
          headline: productTitle.substring(0, 30),
          subheadline: CREATIVE_TYPES[creativeType]?.useCase?.substring(0, 60) || '',
          conceptAngle: conceptAngle || CREATIVE_TYPES[creativeType]?.definition || '',
          visualComposition: 'Product hero shot, clean background, bold headline overlay',
          offerPlacement: offer ? `Offer "${offer}" prominently displayed` : 'No offer specified',
          ctaDirection: funnelCta.split(':')[0],
          adCopy: `[Draft] ${CREATIVE_TYPES[creativeType]?.useCase || ''}`,
          variants: ['Change headline', 'Change layout', 'Change CTA'],
          _fallback: true,
        };
      });

      // Save fallback as completed (it's still useful as a starting point)
      try {
        db.prepare(`INSERT INTO creative_packages (id, store_id, content_type, creative_type, funnel_stage, hook_style, avatar_style, generation_goal, quantity, product_id, offer, base_ad_id, strategy, account_snapshot, packages, status, parent_id, parent_package_index, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`).run(
          packageId, storeId, contentType, creativeType, funnelStage, hookStyle, avatarStyle,
          isVariation ? 'generate_variations' : generationGoal, quantity,
          productId || null, offer || null, baseAdId || null,
          JSON.stringify(strategy), JSON.stringify(intel?.metrics || {}), JSON.stringify(fallbackPackages),
          parentId || null, parentPackageIndex ?? null, isVariation ? parentVersion + 1 : 1,
        );
      } catch {}

      return jsonSuccess({
        id: packageId, packages: fallbackPackages, strategy,
        snapshot: intel?.metrics || {},
        config: { contentType, creativeType, funnelStage, hookStyle, avatarStyle, generationGoal, quantity },
        parentId: parentId || null, version: isVariation ? parentVersion + 1 : 1,
        fallback: true,
        fallbackReason: 'AI generation temporarily unavailable due to billing limits. Rule-based draft packages generated instead.',
      });
    }

    // Other errors — save failed and return
    try {
      db.prepare(`INSERT INTO creative_packages (id, store_id, content_type, creative_type, funnel_stage, hook_style, avatar_style, generation_goal, quantity, product_id, offer, base_ad_id, strategy, account_snapshot, status, parent_id, parent_package_index, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?)`).run(
        packageId, storeId, contentType, creativeType, funnelStage, hookStyle, avatarStyle, generationGoal, quantity,
        productId || null, offer || null, baseAdId || null, JSON.stringify(strategy), JSON.stringify(intel?.metrics || {}),
        parentId || null, parentPackageIndex ?? null, isVariation ? parentVersion + 1 : 1,
      );
    } catch {}
    return jsonError('GENERATION_FAILED', err.message, { code: err.code, status: err.status }, 500);
  }

  // ── Stage 4: Save to database ──
  const version = isVariation ? parentVersion + 1 : 1;
  try {
    db.prepare(`INSERT INTO creative_packages (id, store_id, content_type, creative_type, funnel_stage, hook_style, avatar_style, generation_goal, quantity, product_id, offer, base_ad_id, strategy, account_snapshot, packages, status, parent_id, parent_package_index, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`).run(
      packageId, storeId, contentType, creativeType, funnelStage, hookStyle, avatarStyle,
      isVariation ? 'generate_variations' : generationGoal, quantity,
      productId || null, offer || null, baseAdId || null,
      JSON.stringify(strategy), JSON.stringify(intel?.metrics || {}), JSON.stringify(packages),
      parentId || null, parentPackageIndex ?? null, version,
    );
  } catch (dbErr: any) {
    // DB save failed but we have packages — return them with a warning
    return jsonSuccess({
      id: packageId, packages, strategy,
      snapshot: intel?.metrics || {},
      config: { contentType, creativeType, funnelStage, hookStyle, avatarStyle, generationGoal, quantity },
      usage, parentId: parentId || null, version,
      warning: `Packages generated but failed to save: ${dbErr.message}`,
    });
  }

  return jsonSuccess({
    id: packageId, packages, strategy,
    snapshot: intel?.metrics || {},
    config: { contentType, creativeType, funnelStage, hookStyle, avatarStyle, generationGoal, quantity },
    usage, parentId: parentId || null, version,
  });
}

// ═══ GET: List past generations ═══

export async function GET(req: NextRequest) {
  let db: any;
  try {
    db = getDb();
  } catch (e: any) {
    return jsonError('DB_ERROR', 'Database connection failed', e.message, 500);
  }

  const storeId = req.nextUrl.searchParams.get('storeId');
  const id = req.nextUrl.searchParams.get('id');

  try {
    if (id) {
      const row: any = db.prepare('SELECT * FROM creative_packages WHERE id = ?').get(id);
      if (!row) return jsonError('NOT_FOUND', 'Generation not found', null, 404);

      const children: any[] = db.prepare(
        'SELECT id, version, parent_package_index, generation_goal, quantity, status, created_at FROM creative_packages WHERE parent_id = ? ORDER BY version'
      ).all(id);

      return jsonSuccess({
        ...row,
        strategy: row.strategy ? JSON.parse(row.strategy) : null,
        account_snapshot: row.account_snapshot ? JSON.parse(row.account_snapshot) : null,
        packages: row.packages ? JSON.parse(row.packages) : [],
        children,
      });
    }

    if (!storeId) return jsonError('MISSING_STORE', 'storeId is required', null, 400);

    const rows: any[] = db.prepare(`
      SELECT id, content_type, creative_type, funnel_stage, generation_goal, quantity,
        status, created_at, strategy, product_id, parent_id, version
      FROM creative_packages WHERE store_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(storeId);

    return jsonSuccess({
      generations: rows.map(r => ({ ...r, strategy: r.strategy ? JSON.parse(r.strategy) : null })),
    });
  } catch (e: any) {
    return jsonError('QUERY_ERROR', 'Failed to query generations', e.message, 500);
  }
}
