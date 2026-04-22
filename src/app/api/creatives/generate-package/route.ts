import { requireStoreAccess, assertBillingReady } from '@/lib/auth-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { chatCompletionWithFailover } from '@/lib/openai-chat';
import { buildCreativeIntent, buildFastContract, buildGenerationContract, validateGeneratorInputs, CREATIVE_TYPES, FUNNEL_STAGES, HOOK_STYLES, AVATAR_STYLES, validateScriptDuration, compressScriptToFit, getDurationBudget, estimateSpokenDuration } from '@/lib/creative-taxonomy';
import { findBestReference, buildWinnerPromptBlock, buildMoreLikeThisPrompt } from '@/lib/winner-matching';
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
  // ═══ TOP-LEVEL SAFETY: Every code path MUST return JSON, never crash ═══
  try {
    return await handleGeneratePackage(req);
  } catch (fatalErr: any) {
    console.error('[GENERATE] FATAL unhandled error:', fatalErr.message, fatalErr.stack?.substring(0, 500));
    return jsonError('INTERNAL_ERROR', `Generation failed: ${(fatalErr.message || 'Unknown error').substring(0, 300)}`, null, 500);
  }
}

async function handleGeneratePackage(req: NextRequest) {
  // ── Parse body safely ──
  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    return jsonError('INVALID_BODY', 'Request body is not valid JSON', e.message, 400);
  }

  const { storeId, productId, offer, baseAdId, parentId, parentPackageIndex, winnerReferenceId, moreLikeThis, conceptAngle } = body;
  // ═══ TENANT ACCESS CHECK ═══
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;
  if (storeId && _auth.authorized) {
    const billing = assertBillingReady(storeId, _auth.role);
    if (!billing.allowed) return jsonError('BILLING_REQUIRED', billing.reason, null, 402);
  }


  const contentType = normalize(body.contentType || 'video');
  const creativeType = normalize(body.creativeType || 'testimonial');
  const funnelStage = normalize(body.funnelStage || 'tof');
  const hookStyle = normalize(body.hookStyle || 'curiosity');
  const avatarStyle = normalize(body.avatarStyle || 'female_ugc');
  const generationGoal = normalize(body.generationGoal || 'new_concept');
  const platformTarget = body.platformTarget || 'meta';
  const quantity = body.quantity || 3;
  // creativesPerConcept is the primary control — always wins over legacy videosPerConcept/imagesPerConcept
  const perConcept = Math.max(1, parseInt(body.creativesPerConcept) || parseInt(body.videosPerConcept) || 3);
  const videosPerConcept = perConcept;
  const imagesPerConcept = perConcept;
  console.log(`[GENERATE] Volume: ${quantity} concepts × ${perConcept} per concept (total expected: ${quantity * perConcept})`);
  const fastMode = body.fast !== false; // fast mode ON by default
  // Video duration (seconds) — drives word budget and CTA reservation
  const videoDuration: number = (() => {
    const raw = parseInt(body.videoDuration || body.duration || '20', 10);
    if ([8, 10, 15, 20].includes(raw)) return raw;
    if (raw <= 8) return 8;
    if (raw <= 10) return 10;
    if (raw <= 15) return 15;
    return 20;
  })();
  // Output dimension preset (4:5, 1:1, 9:16, 16:9, auto)
  const dimension: string = body.dimension || (platformTarget === 'tiktok' ? '9:16' : '4:5');
  const funnelStructure: string = body.funnelStructure || 'tof';
  const contentMix: string = body.contentMix || 'video';
  const isFullFunnel = funnelStructure === 'full';

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

  // ── Duplicate detection DISABLED ──
  // Previously cached by a subset of config fields, which caused stale results
  // when the user changed the cover image, dimension, content mix, or concept angle.
  // Cache is now OFF — every generation is fresh. Re-enable only if ALL config
  // fields (including coverImageUrl) are part of the cache key.
  // if (!parentId) { /* cache disabled */ }

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
    productInfo = `\nProduct: ${productObj.title}\nDescription: ${productObj.description || 'N/A'}\nPrice: $${((productObj.price_cents || 0) / 100).toFixed(2)}\nCategory: ${productObj.category || 'Health & Beauty'}`;
    if (offer) productInfo += `\nOffer: ${offer}`;
  }

  if (baseAdResult.status === 'fulfilled' && baseAdResult.value) {
    const adRow = baseAdResult.value as any;
    baseAdContext = `\n\n═══ BASE AD ═══\nAd: ${adRow.ad_name || 'N/A'}\nHeadline: ${adRow.ad_headline || 'N/A'}\nCTA: ${adRow.ad_cta || 'N/A'}\nCopy:\n${adRow.ad_body || 'N/A'}`;
    if (adRow.video_analysis) baseAdContext += `\n\nDNA:\n${adRow.video_analysis}`;
  }

  if (parentResult.status === 'fulfilled' && parentResult.value) {
    const parentRow = parentResult.value as any;
    isVariation = true;
    parentVersion = parentRow.version || 1;
    const parentPackages = parentRow.packages ? JSON.parse(parentRow.packages) : [];
    const sourcePackage = parentPackages[parentPackageIndex ?? 0];
    if (sourcePackage) {
      // Build variation context — include image-specific fields if present
      const isImagePkg = sourcePackage.imageFormat || sourcePackage.hookText || sourcePackage.proofElement;
      if (isImagePkg) {
        parentPackageContext = `\n\n═══ SOURCE IMAGE PACKAGE TO VARY ═══
Title: ${sourcePackage.title || 'N/A'}
Angle: ${sourcePackage.angle || sourcePackage.conceptAngle || 'N/A'}
Format: ${sourcePackage.imageFormat || 'N/A'}
Hook Text: ${sourcePackage.hookText || sourcePackage.headline || 'N/A'}
Proof Element: ${sourcePackage.proofElement || 'N/A'}
Product Placement: ${sourcePackage.productPlacement || 'N/A'}
CTA: ${sourcePackage.ctaText || sourcePackage.ctaDirection || 'N/A'}
CTA Placement: ${sourcePackage.ctaPlacement || 'N/A'}
Layout: ${sourcePackage.visualComposition || 'N/A'}

VARIATION RULES (STRICT):
- Keep the SAME imageFormat and core layout
- Keep the SAME product placement
- Each variation must change exactly ONE element:
  - Variation 1: Change HOOK TEXT only (different emotional trigger or angle)
  - Variation 2: Change PROOF ELEMENT only (different proof type: review→stat, stat→before/after)
  - Variation 3: Change CTA only (different urgency level or action verb)
  - Variation 4+: Change EMOTIONAL TONE (same layout, different feeling)
- Label what changed in each variant
- Do NOT change the layout structure or product placement`;
      } else {
        parentPackageContext = `\n\n═══ SOURCE TO VARY ═══\nTitle: ${sourcePackage.title || 'N/A'}\nAngle: ${sourcePackage.angle || sourcePackage.conceptAngle || 'N/A'}\nHook: ${sourcePackage.hook || sourcePackage.headline || 'N/A'}\n${sourcePackage.script ? `Script:\n${sourcePackage.script}` : ''}\nCTA: ${sourcePackage.cta || sourcePackage.ctaDirection || 'N/A'}\nVARIATION RULES: Keep core angle. Each variation changes ONE thing: hook, emotion, CTA, or structure. Label what changed.`;
      }
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
  const fatiguedNames = intel?._forPrompt?.fatiguedNames || [];
  const learnedWins = (intel?._forPrompt?.learnedWins || []).slice(0, fastMode ? 2 : 5);
  const learnedLosses = (intel?._forPrompt?.learnedLosses || []).slice(0, fastMode ? 2 : 5);
  const conceptsToScale = intel?._forPrompt?.conceptsToScale || [];
  const conceptsToRefresh = intel?._forPrompt?.conceptsToRefresh || [];

  let winningAdsContext = '';
  const topAdsForPrompt = intel?._forPrompt?.topAds || [];
  const adsLimit = fastMode ? 3 : 10;
  if (topAdsForPrompt.length > 0) {
    winningAdsContext = '\n\nTOP ADS (use these patterns — they convert):\n';
    topAdsForPrompt.slice(0, adsLimit).forEach((ad: any, i: number) => {
      winningAdsContext += `#${i + 1} ${ad.roas}x ROAS, ${ad.purchases}p, ${ad.ctr}% CTR | "${ad.headline || ad.name}"\n`;
      if (!fastMode && ad.body) winningAdsContext += `Copy: ${ad.body}\n`;
    });
  }
  if (conceptsToScale.length > 0) {
    winningAdsContext += `\nCONCEPTS WINNING (scale these angles): ${conceptsToScale.slice(0, 3).join(', ')}\n`;
  }
  if (conceptsToRefresh.length > 0) {
    winningAdsContext += `CONCEPTS FATIGUING (create fresh variations): ${conceptsToRefresh.slice(0, 3).join(', ')}\n`;
  }

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
    const contract = fastMode
      ? buildFastContract(creativeIntent, contentType, quantity, funnelStage, contentType === 'video' ? videoDuration : undefined)
      : buildGenerationContract(creativeIntent, contentType, quantity, contentType === 'video' ? videoDuration : undefined);
    const addendum = [
      strategy.evidence?.length > 0 ? `\nEvidence: ${strategy.evidence.slice(0, 3).map((e: any) => `${e.metric}: ${e.value}`).join(', ')}` : '',
      strategy.overrides?.length > 0 ? `\nOverrides: ${strategy.overrides.map((o: any) => `${o.field}: ${o.current}→${o.suggested}`).join(', ')}` : '',
    ].filter(Boolean).join('');
    systemPrompt = contract + addendum;
  } catch (e: any) {
    return jsonError('CONTRACT_ERROR', 'Failed to build generation contract', e.message, 500);
  }

  // ── Winner Reference DNA Injection ──
  // If "More Like This" is requested with a specific winner, use strict matching.
  // Otherwise, auto-detect a saved winner that matches the current setup.
  let matchedWinner: any = null;
  let winnerSource: 'explicit' | 'auto' | null = null;

  try {
    if (moreLikeThis && winnerReferenceId) {
      // Explicit "Generate More Like This" — strongest DNA injection
      const explicitWinner = db.prepare('SELECT * FROM winner_references WHERE id = ?').get(winnerReferenceId);
      if (explicitWinner) {
        matchedWinner = { ...explicitWinner, _matchScore: 100 };
        winnerSource = 'explicit';
        systemPrompt += buildMoreLikeThisPrompt(explicitWinner);
        console.log(`[GENERATE] Using explicit winner reference: "${explicitWinner.title}" for "More Like This"`);
      }
    } else if (!isVariation) {
      // Auto-detect: find best matching winner for this setup
      const autoMatch = findBestReference(db, storeId, {
        contentType, creativeType, funnelStage, hookStyle, avatarStyle,
        platform: platformTarget,
        duration: contentType === 'video' ? videoDuration : undefined,
        aspectRatio: dimension,
      });
      if (autoMatch) {
        matchedWinner = autoMatch;
        winnerSource = 'auto';
        systemPrompt += buildWinnerPromptBlock(autoMatch);
        console.log(`[GENERATE] Auto-matched winner reference: "${autoMatch.title}" (${autoMatch._matchScore}% match)`);
      }
    }
  } catch (e: any) {
    // Winner matching is best-effort — never block generation
    console.error('[GENERATE] Winner matching error (non-fatal):', e.message);
  }

  // Concept action (from AI Brain scorecards): scale, refresh, add_tof, add_bof, generate_more
  const conceptAction = body.conceptAction || '';

  let conceptDirective = '';
  if (conceptAngle) {
    conceptDirective = `\n\n═══ CONCEPT/ANGLE (USER-SPECIFIED — HIGHEST PRIORITY) ═══\nBuild ALL packages around this specific angle:\n"${conceptAngle}"\nEvery hook, script, proof element, and CTA must serve this angle. Do NOT deviate into unrelated concepts.\n`;
  }

  // Add action-specific instructions
  if (conceptAction === 'scale') {
    conceptDirective += `\n═══ ACTION: SCALE THIS CONCEPT ═══\nThis concept is a PROVEN WINNER. Generate tight variations:\n- Keep the SAME angle and structure\n- Vary hook wording (same pattern, different words)\n- Vary presenter/avatar\n- Slight script changes (same flow, different examples)\n- Do NOT create a new unrelated concept\n`;
  } else if (conceptAction === 'refresh') {
    conceptDirective += `\n═══ ACTION: REFRESH THIS CONCEPT ═══\nThis concept is FATIGUING. Create fresh takes:\n- Keep the same core concept/product angle\n- CHANGE the hook style (new emotional trigger)\n- CHANGE the framing (new perspective)\n- CHANGE the tone (different energy)\n- Do NOT reuse existing scripts — write completely new ones\n- Make it feel like a different ad, same product truth\n`;
  } else if (conceptAction === 'add_tof') {
    conceptDirective += `\n═══ ACTION: ADD TOF CREATIVES ═══\nGenerate ONLY Top-of-Funnel (awareness) content for this concept:\n- Scroll-stopping hooks\n- Curiosity-driven openings\n- Pattern interrupts\n- "Did you know" / "Stop scrolling" style\n- Cold audience — they don\'t know the product yet\n`;
  } else if (conceptAction === 'add_bof') {
    conceptDirective += `\n═══ ACTION: ADD BOF CREATIVES ═══\nGenerate ONLY Bottom-of-Funnel (conversion) content for this concept:\n- Testimonials and social proof\n- Before/after transformations\n- Offer-driven (discount, bundle, limited time)\n- Urgency and scarcity\n- Direct CTA to purchase\n- Warm audience — they already know the product\n`;
  } else if (conceptAction === 'generate_more') {
    conceptDirective += `\n═══ ACTION: GENERATE MORE ═══\nGenerate more content for this existing concept. Be more exploratory:\n- Try different hook styles\n- Try different proof elements\n- Try different emotional angles\n- Keep the core concept but expand creatively\n`;
  }

  // Load product foundation (beliefs, unique mechanism) if available
  let foundationDirective = '';
  if (productId) {
    try {
      const foundRow: any = db.prepare('SELECT * FROM product_foundations WHERE product_id = ?').get(productId);
      if (foundRow) {
        const beliefs: string[] = JSON.parse(foundRow.beliefs || '[]').filter((b: string) => b.trim());
        const parts: string[] = [];
        if (beliefs.length > 0) {
          parts.push(`\n═══ NECESSARY BELIEFS (from product foundation) ═══`);
          parts.push(`The customer must believe these things before purchasing. Each concept should attack at least one belief:`);
          beliefs.forEach((b, i) => parts.push(`${i + 1}. "${b}"`));
          parts.push(`Structure each creative as an ARGUMENT that leads the viewer to one of these beliefs — not just pretty words.`);
        }
        if (foundRow.unique_mechanism) {
          parts.push(`\nUNIQUE MECHANISM: ${foundRow.unique_mechanism}`);
          parts.push(`Every creative must position this as a new, different, and superior solution. All roads lead to this product.`);
        }
        if (foundRow.offer_brief) {
          parts.push(`\nOFFER: ${foundRow.offer_brief}`);
        }
        if (parts.length > 0) foundationDirective = parts.join('\n');
      }
    } catch {}
  }

  // ═══ Quantity math — concepts × per-concept × stages, split by content mix ═══
  const stageCount = isFullFunnel ? 3 : 1;
  const stageList: Array<'tof' | 'mof' | 'bof'> = isFullFunnel
    ? ['tof', 'mof', 'bof']
    : [funnelStage as 'tof' | 'mof' | 'bof'];
  const wantsVideos = contentMix !== 'image';
  const wantsImages = contentMix === 'image' || contentMix === 'mixed';
  const videosTotal = wantsVideos ? quantity * videosPerConcept * stageCount : 0;
  const imagesTotal = wantsImages ? quantity * imagesPerConcept * stageCount : 0;
  const totalPackages = videosTotal + imagesTotal;
  // Per-stage counts (what the AI must produce for EACH stage, EACH concept)
  const videosPerStagePerConcept = wantsVideos ? videosPerConcept : 0;
  const imagesPerStagePerConcept = wantsImages ? imagesPerConcept : 0;

  // Build structure directive — explicit counts per stage/concept + labeling rules
  let structureDirective = '';
  if (isFullFunnel) {
    const perStageParts: string[] = [];
    if (videosPerStagePerConcept > 0) perStageParts.push(`${videosPerStagePerConcept} VIDEO script${videosPerStagePerConcept > 1 ? 's' : ''}`);
    if (imagesPerStagePerConcept > 0) perStageParts.push(`${imagesPerStagePerConcept} IMAGE static${imagesPerStagePerConcept > 1 ? 's' : ''}`);
    const perStageLabel = perStageParts.join(' + ');
    structureDirective = `\n\n═══ FULL FUNNEL PACK ═══
Generate EXACTLY ${totalPackages} packages total.
Structure: ${quantity} concept(s) × 3 stages (TOF, MOF, BOF) × [${perStageLabel}] per stage per concept.

STAGE DEFINITIONS:
- TOF (Top of Funnel): scroll-stopping hooks, awareness, curiosity, pattern interrupts. Cold audience.
- MOF (Middle of Funnel): proof, education, trust-building, social proof, comparisons. Warming up.
- BOF (Bottom of Funnel): urgency, offers, conversion, direct CTA, scarcity. Ready to buy.

LABELING RULES (STRICT):
- Every title MUST begin with the stage code in brackets: "[TOF] ...", "[MOF] ...", or "[BOF] ..."
- Every package MUST include a "stage" field with value "tof", "mof", or "bof" (lowercase)
- Every package MUST include a "contentType" field with value "video" or "image"
- For each concept, group packages so TOF come first, then MOF, then BOF
${contentMix === 'mixed' ? '- For each stage, produce the video script(s) first, then the image static(s)\n' : ''}`;
  } else if (videosPerStagePerConcept > 1 || imagesPerStagePerConcept > 1 || contentMix === 'mixed') {
    const perConceptParts: string[] = [];
    if (videosPerStagePerConcept > 0) perConceptParts.push(`${videosPerStagePerConcept} VIDEO script${videosPerStagePerConcept > 1 ? 's' : ''}`);
    if (imagesPerStagePerConcept > 0) perConceptParts.push(`${imagesPerStagePerConcept} IMAGE static${imagesPerStagePerConcept > 1 ? 's' : ''}`);
    const perConceptLabel = perConceptParts.join(' + ');
    structureDirective = `\n\n═══ STRUCTURE ═══
Generate EXACTLY ${totalPackages} packages total.
${quantity} concept(s) × [${perConceptLabel}] per concept.
All packages target stage: ${funnelStage.toUpperCase()}.

LABELING RULES (STRICT):
- Every package MUST include a "contentType" field with value "video" or "image"
- Every package MUST include a "stage" field with value "${funnelStage}"
- Label video variations "Concept 1 — V1", "Concept 1 — V2"; label image concepts "Concept 1 — I1", "Concept 1 — I2"
${contentMix === 'mixed' ? '- For each concept, produce the video script(s) first, then the image static(s)\n' : ''}`;
  } else {
    // Single stage, single content type, single per-concept — still require labeling
    structureDirective = `\n\nLABELING: Each package MUST include "contentType" field ("${contentMix === 'image' ? 'image' : 'video'}") and "stage" field ("${funnelStage}").\n`;
  }

  // Content type for prompt
  const contentLabel = contentMix === 'mixed' ? 'video and image' : contentMix === 'image' ? 'image' : 'video';

  const userPrompt = isVariation
    ? `Generate ${totalPackages} VARIATIONS.${parentPackageContext}${conceptDirective}${foundationDirective}${productInfo}${winningAdsContext}`
    : `Generate ${totalPackages} ${contentLabel} creative packages.${structureDirective}${conceptDirective}${foundationDirective}${productInfo}${baseAdContext}${winningAdsContext}`;

  let packages: any[] = [];
  let usage: any = null;
  let usedProvider = 'openai';
  let failoverFrom: string | undefined;

  try {
    // Size token budget by actual totals — mixed mode needs both video (~500) + image (~600) tokens per pkg
    const videoTokBudget = videosTotal * 500;
    const imageTokBudget = imagesTotal * 600;
    const maxTokens = Math.min(12000, videoTokBudget + imageTokBudget + 600);
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    // Try up to 2 times — retry once on parse failure (truncated JSON)
    for (let attempt = 1; attempt <= 2; attempt++) {
      const aiPromise = chatCompletionWithFailover(messages, { temperature: 0.9, maxTokens });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('AI generation timed out after 60s'), { code: 'TIMEOUT', isQuota: false })), 60000)
      );
      const result = await Promise.race([aiPromise, timeoutPromise]);

      usage = result.usage;
      usedProvider = result.provider;
      failoverFrom = result.failoverFrom;

      if (failoverFrom) {
        console.log(`[GENERATE] Failover: ${failoverFrom} → ${usedProvider} for store ${storeId}`);
      }

      try {
        let cleaned = result.content
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
        }
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          packages = parsed;
        } else if (Array.isArray(parsed.packages)) {
          packages = parsed.packages;
        } else if (Array.isArray(parsed.creatives)) {
          packages = parsed.creatives;
        } else {
          const arrays = Object.values(parsed).filter(v => Array.isArray(v));
          if (arrays.length > 0) {
            packages = arrays[0] as any[];
          } else {
            packages = [parsed];
          }
        }
        break; // Parse succeeded — exit retry loop
      } catch (parseErr: any) {
        console.error(`[GENERATE] ${usedProvider} parse error (attempt ${attempt}): ${parseErr.message}. Raw (first 300): ${result.content?.substring(0, 300)}`);
        if (attempt === 2) {
          return jsonError('PARSE_ERROR', `AI returned truncated response after 2 attempts. Try again or reduce quantity.`, { parseError: parseErr.message, rawLength: result.content?.length, provider: usedProvider }, 500);
        }
        console.log(`[GENERATE] Retrying generation (attempt 2)...`);
      }
    }

    // ═══ Tag each package with contentType + stage (best-effort inference) ═══
    // Every package should already have these from the prompt contract, but
    // add fallback inference so downstream UI always has something to route on.
    if (packages.length > 0) {
      for (const pkg of packages) {
        // Stage inference
        if (!pkg.stage) {
          const titleStr = String(pkg.title || '').toLowerCase();
          if (/\[tof\]|\btof\b/.test(titleStr)) pkg.stage = 'tof';
          else if (/\[mof\]|\bmof\b/.test(titleStr)) pkg.stage = 'mof';
          else if (/\[bof\]|\bbof\b/.test(titleStr)) pkg.stage = 'bof';
          else pkg.stage = funnelStage;
        }
        pkg.stage = String(pkg.stage).toLowerCase();
        if (!['tof', 'mof', 'bof'].includes(pkg.stage)) pkg.stage = funnelStage;

        // contentType inference — explicit field wins; else infer from shape
        if (!pkg.contentType) {
          if (pkg.script || pkg.sceneStructure || pkg.brollDirection) pkg.contentType = 'video';
          else if (pkg.imageFormat || pkg.hookText || pkg.visualComposition || pkg.textOverlays) pkg.contentType = 'image';
          else pkg.contentType = contentMix === 'image' ? 'image' : 'video';
        }
      }
    }

    // ═══ COUNT ENFORCEMENT — pad if AI returned fewer than requested ═══
    const expectedTotal = totalPackages;
    console.log(`[GENERATE] AI returned ${packages.length} packages, expected ${expectedTotal}`);
    if (packages.length < expectedTotal && packages.length > 0) {
      console.warn(`[GENERATE] AI under-delivered: ${packages.length}/${expectedTotal}. Padding with variations.`);
      const original = [...packages];
      while (packages.length < expectedTotal) {
        // Clone a package from the originals, cycling through them
        const source = original[packages.length % original.length];
        const clone = { ...source };
        const vi = packages.length + 1;
        clone.title = `${(source.title || 'Creative').replace(/\s*[—-]\s*V\d+.*$/i, '')} — V${vi}`;
        if (clone.script) {
          clone._isVariation = true;
        }
        packages.push(clone);
      }
      console.log(`[GENERATE] Padded to ${packages.length} packages (${packages.length - original.length} cloned variations)`);
    }

    // ═══ Duration validation + auto-compression — per-package, only videos ═══
    // Every VIDEO script must fit within the selected runtime budget.
    // Images are skipped. Mixed mode validates only the video packages.
    if (packages.length > 0) {
      const budget = getDurationBudget(videoDuration);
      let compressedCount = 0;
      let stillTooLongCount = 0;
      for (const pkg of packages) {
        if (pkg.contentType !== 'video') continue;
        if (!pkg.script) continue;
        const initial = validateScriptDuration(pkg.script, videoDuration);
        // Always attach metadata so we can debug later
        pkg._duration = videoDuration;
        pkg._wordBudget = budget.targetWords;
        pkg._initialWordCount = initial.wordCount;
        pkg._initialEstimatedSeconds = initial.estimatedSeconds;

        if (!initial.ok && initial.wordCount > budget.maxWords) {
          // Compress
          const compressed = compressScriptToFit(pkg.script, videoDuration);
          pkg.script = compressed.script;
          pkg._compressed = true;
          pkg._compressionIterations = compressed.iterations;
          pkg._finalWordCount = compressed.finalWordCount;
          pkg._finalEstimatedSeconds = estimateSpokenDuration(compressed.script);
          compressedCount++;

          // Re-validate
          const reval = validateScriptDuration(pkg.script, videoDuration);
          pkg._validationPass = reval.ok;
          if (!reval.ok && compressed.finalWordCount > budget.maxWords) {
            stillTooLongCount++;
            console.warn(`[GENERATE] Script for "${pkg.title}" still too long after compression: ${compressed.finalWordCount} words for ${videoDuration}s (max ${budget.maxWords})`);
          }
        } else {
          pkg._compressed = false;
          pkg._finalWordCount = initial.wordCount;
          pkg._finalEstimatedSeconds = initial.estimatedSeconds;
          pkg._validationPass = initial.ok;
        }
      }
      if (compressedCount > 0) {
        console.log(`[GENERATE] Compressed ${compressedCount}/${packages.length} video scripts to fit ${videoDuration}s budget (${stillTooLongCount} still over)`);
      }
    }
  } catch (err: any) {
    // ALL providers failed — use rule-based fallback as last resort
    if (err.code === 'all_providers_failed') {
      console.error(`[FAILOVER] All providers failed for store ${storeId}: ${err.message}`);

      const productTitle = productObj?.title || 'your product';
      const hookExamples = HOOK_STYLES[hookStyle]?.exampleFormats || ['"Did you know..."'];
      const avatarDesc = AVATAR_STYLES[avatarStyle]?.castingNotes || 'Relatable presenter';
      const stageCtaMap: Record<string, string> = {
        tof: 'Soft CTA — "Tap to learn more"',
        mof: 'Medium CTA — "See how it works"',
        bof: 'Hard CTA with urgency — "Shop now"',
      };

      // Build fallback packages respecting the exact totals
      const fallbackPackages: any[] = [];
      for (let c = 0; c < quantity; c++) {
        for (const stage of stageList) {
          const funnelCta = stageCtaMap[stage] || 'Check it out';
          // Videos for this concept/stage
          for (let v = 0; v < videosPerStagePerConcept; v++) {
            const i = fallbackPackages.length;
            const hookExample = hookExamples[i % hookExamples.length] || hookExamples[0];
            fallbackPackages.push({
              title: `[${stage.toUpperCase()}] ${CREATIVE_TYPES[creativeType]?.label || 'Creative'} — ${productTitle} C${c + 1}V${v + 1}`,
              angle: `${CREATIVE_TYPES[creativeType]?.label || 'testimonial'} approach for ${productTitle}`,
              hook: hookExample.replace(/\[.*?\]/g, productTitle),
              script: `[Draft — AI unavailable] ${hookExample}. ${productTitle} ${CREATIVE_TYPES[creativeType]?.definition?.split('.')[0] || 'helps solve a real problem'}. ${funnelCta.split('—')[0]}.`,
              sceneStructure: strategy?.recommendedStructure || 'Hook 0-3s → Context 3-8s → Product 8-15s → CTA 15-20s',
              visualDirection: 'Handheld camera, natural lighting, real environment. Show the actual product.',
              brollDirection: `Close-up of ${productTitle} packaging, product in hand, product in use`,
              presenterBehavior: avatarDesc,
              pacingNotes: 'Natural UGC pacing, not over-edited',
              cta: funnelCta,
              adCopy: `[Draft] ${CREATIVE_TYPES[creativeType]?.useCase || ''} ${offer ? `Offer: ${offer}` : ''}`,
              headline: `${productTitle.substring(0, 35)}`,
              variants: ['Change hook style', 'Change CTA approach', 'Change presenter'],
              stage,
              contentType: 'video',
              _fallback: true,
            });
          }
          // Images for this concept/stage
          for (let im = 0; im < imagesPerStagePerConcept; im++) {
            fallbackPackages.push({
              title: `[${stage.toUpperCase()}] ${CREATIVE_TYPES[creativeType]?.label || 'Creative'} — ${productTitle} C${c + 1}I${im + 1}`,
              angle: `${CREATIVE_TYPES[creativeType]?.label || 'image'} concept for ${productTitle}`,
              headline: productTitle.substring(0, 30),
              subheadline: CREATIVE_TYPES[creativeType]?.useCase?.substring(0, 60) || '',
              conceptAngle: CREATIVE_TYPES[creativeType]?.definition || '',
              visualComposition: 'Product hero shot, clean background, bold headline overlay',
              offerPlacement: offer ? `Offer "${offer}" prominently displayed` : 'No offer specified',
              ctaDirection: funnelCta.split('—')[0],
              adCopy: `[Draft] ${CREATIVE_TYPES[creativeType]?.useCase || ''}`,
              variants: ['Change headline', 'Change layout', 'Change CTA'],
              stage,
              contentType: 'image',
              _fallback: true,
            });
          }
        }
      }

      try {
        db.prepare(`INSERT INTO creative_packages (id, store_id, content_type, creative_type, funnel_stage, hook_style, avatar_style, generation_goal, quantity, product_id, offer, base_ad_id, strategy, account_snapshot, packages, status, parent_id, parent_package_index, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`).run(
          packageId, storeId, contentType, creativeType, funnelStage, hookStyle, avatarStyle,
          isVariation ? 'generate_variations' : generationGoal, quantity,
          productId || null, offer || null, baseAdId || null,
          JSON.stringify(strategy), JSON.stringify(intel?.metrics || {}), JSON.stringify(fallbackPackages),
          parentId || null, parentPackageIndex ?? null, isVariation ? parentVersion + 1 : 1,
        );
      } catch {}

      const providerErrors = err.providerErrors?.map((e: any) => `${e.provider}: ${e.error}`).join('; ') || err.message;
      return jsonSuccess({
        id: packageId, packages: fallbackPackages, strategy,
        snapshot: intel?.metrics || {},
        config: { contentType, contentMix, creativeType, funnelStage, funnelStructure, hookStyle, avatarStyle, generationGoal, quantity, videosPerConcept, imagesPerConcept, videoDuration, dimension, totals: { videos: videosTotal, images: imagesTotal, total: totalPackages, stages: stageList } },
        parentId: parentId || null, version: isVariation ? parentVersion + 1 : 1,
        fallback: true,
        fallbackReason: `All AI providers failed (${providerErrors}). Rule-based draft packages generated instead.`,
      });
    }

    // Single provider error (non-quota) — save failed and return
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
      config: { contentType, contentMix, creativeType, funnelStage, funnelStructure, hookStyle, avatarStyle, generationGoal, quantity, videosPerConcept, imagesPerConcept, videoDuration, dimension, totals: { videos: videosTotal, images: imagesTotal, total: totalPackages, stages: stageList } },
      usage, parentId: parentId || null, version,
      warning: `Packages generated but failed to save: ${dbErr.message}`,
    });
  }

  return jsonSuccess({
    id: packageId, packages, strategy,
    snapshot: intel?.metrics || {},
    config: { contentType, contentMix, creativeType, funnelStage, funnelStructure, hookStyle, avatarStyle, generationGoal, quantity, videosPerConcept, imagesPerConcept, videoDuration, dimension, totals: { videos: videosTotal, images: imagesTotal, total: totalPackages, stages: stageList } },
    usage, parentId: parentId || null, version,
    provider: usedProvider,
    ...(failoverFrom ? { failoverFrom, failoverNote: `OpenAI unavailable — generated with ${usedProvider === 'gemini' ? 'Gemini' : usedProvider}` } : {}),
    ...(matchedWinner ? {
      winnerReference: {
        id: matchedWinner.id,
        title: matchedWinner.title,
        matchScore: matchedWinner._matchScore,
        source: winnerSource,
      },
    } : {}),
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
