/**
 * Deterministic Provider Router
 *
 * Maps every creative type to an exact provider + fallback chain.
 * Optimized for direct-response Meta ads going straight to landing page.
 *
 * ═══ STATIC IMAGE STRATEGY (3-layer) ═══
 *   Tier 1 — Nano Banana 2   = DEFAULT / rapid concept generation + variations.
 *                              Also the best choice for lifestyle, educational,
 *                              UGC-style, and any fast-iteration work. Supports
 *                              reference images via the edit endpoint so it can
 *                              preserve product fidelity when needed.
 *   Tier 2 — Stability       = product-fidelity and compositing when the
 *                              packaging/bottle/label must be exact.
 *   Tier 3 — Ideogram        = text-heavy direct-response statics:
 *                              testimonial quotes, review stacks, offer stacks,
 *                              comparisons, before/after labels, authority
 *                              claims, myth-busting — anything where readable
 *                              text on the image is the primary signal.
 *
 * ═══ VIDEO STRATEGY ═══
 *   All videos → Sora first (best script-led control), then Runway/Higgsfield.
 *
 * Rules:
 * - Never random. Every selection is logged with a reason.
 * - Ideogram has NO reference-image support — if product images exist, the
 *   router swaps Ideogram out for Nano Banana (edit) or Stability.
 */

export interface ProviderSelection {
  provider: string;
  reason: string;
  fallbackChain: string[];
  category: 'text-heavy' | 'product-fidelity' | 'clean-static' | 'lifestyle' | 'video-scripted';
}

// ═══ IMAGE CREATIVE TYPE → PROVIDER MAP ═══

const IMAGE_ROUTING: Record<string, ProviderSelection> = {
  // ═══ Tier 3 — Text-heavy / direct-response → Ideogram primary ═══
  // Readable text on the image is the #1 signal. Fallback to Nano Banana which
  // renders text well via Gemini 3.1 Flash Image, then Stability / DALL·E.
  testimonial: {
    provider: 'ideogram', reason: 'Text-heavy testimonial static — Ideogram has best text rendering for headline + quote + proof layouts',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  review_stack: {
    provider: 'ideogram', reason: 'Review stack needs readable proof text — Ideogram renders text best',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  social_proof: {
    provider: 'ideogram', reason: 'Social proof stats (4.8 stars, 15K buyers) need readable layout — Ideogram',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  offer_stack: {
    provider: 'ideogram', reason: 'Offer-driven static needs visible price/discount text — Ideogram',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  problem_solution: {
    provider: 'ideogram', reason: 'Problem/solution needs strong hook text framing — Ideogram',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  before_after: {
    provider: 'ideogram', reason: 'Before/after comparison layout needs readable labels — Ideogram',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  comparison: {
    provider: 'ideogram', reason: 'Side-by-side comparison needs clear text hierarchy — Ideogram',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  authority_claim: {
    provider: 'ideogram', reason: 'Authority/trust static needs readable badges and proof callouts — Ideogram',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  myth_busting: {
    provider: 'ideogram', reason: 'Myth-busting static needs bold claim text — Ideogram',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  hook_viral: {
    provider: 'ideogram', reason: 'Viral hook static needs attention-grabbing headline text — Ideogram',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },
  pattern_interrupt: {
    provider: 'ideogram', reason: 'Pattern interrupt needs bold, scroll-stopping text — Ideogram',
    fallbackChain: ['nano-banana', 'stability', 'dalle'], category: 'text-heavy',
  },

  // ═══ Tier 2 — Product-fidelity / packaging-critical → Stability primary ═══
  // When exact bottle shape, cap, label layout matters. Nano Banana's edit
  // endpoint is our fallback — it also supports reference images.
  product_demo: {
    provider: 'stability', reason: 'Product demo needs real packaging fidelity — Stability best for image-guided',
    fallbackChain: ['nano-banana', 'dalle', 'ideogram'], category: 'product-fidelity',
  },
  product_highlight: {
    provider: 'stability', reason: 'Product highlight needs exact packaging preservation — Stability',
    fallbackChain: ['nano-banana', 'dalle', 'ideogram'], category: 'product-fidelity',
  },
  faceless_product_only: {
    provider: 'stability', reason: 'Faceless product shots need packaging fidelity — Stability',
    fallbackChain: ['nano-banana', 'dalle', 'ideogram'], category: 'product-fidelity',
  },
  routine: {
    provider: 'stability', reason: 'Routine/sequence static — product-led, Stability for fidelity',
    fallbackChain: ['nano-banana', 'dalle', 'ideogram'], category: 'product-fidelity',
  },

  // ═══ Tier 1 — Rapid concept / variation / lifestyle → Nano Banana 2 primary ═══
  // Fast, high-quality generation with good text rendering and reference-image
  // support (edit endpoint). This is the default for anything that isn't
  // strictly text-heavy or strictly packaging-critical.
  lifestyle: {
    provider: 'nano-banana', reason: 'Lifestyle static — Nano Banana 2 for fast, high-quality variation generation with natural product integration',
    fallbackChain: ['stability', 'ideogram', 'dalle'], category: 'lifestyle',
  },
  educational: {
    provider: 'nano-banana', reason: 'Educational static — Nano Banana 2 for clean layout with readable text',
    fallbackChain: ['ideogram', 'stability', 'dalle'], category: 'clean-static',
  },
  ugc_style: {
    provider: 'nano-banana', reason: 'UGC-style static — Nano Banana 2 for fast, authentic lifestyle feel with product reference',
    fallbackChain: ['stability', 'ideogram', 'dalle'], category: 'lifestyle',
  },
};

// ═══ VIDEO CREATIVE TYPE → PROVIDER MAP ═══

const VIDEO_ROUTING: Record<string, ProviderSelection> = {
  testimonial:      { provider: 'sora', reason: 'Script-led testimonial — Sora best for structured speaking ads', fallbackChain: ['runway', 'higgsfield'], category: 'video-scripted' },
  b_roll:           { provider: 'sora', reason: 'B-roll needs controlled visual storytelling — Sora', fallbackChain: ['runway', 'higgsfield'], category: 'video-scripted' },
  product_demo:     { provider: 'sora', reason: 'Product demo needs structured usage explanation — Sora', fallbackChain: ['runway', 'higgsfield'], category: 'video-scripted' },
  before_after:     { provider: 'sora', reason: 'Before/after needs controlled proof pacing — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  problem_solution: { provider: 'sora', reason: 'Problem/solution needs script-led structure — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  founder_story:    { provider: 'sora', reason: 'Founder story is structured talking format — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  social_proof:     { provider: 'sora', reason: 'Social proof needs scripted proof pacing — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  educational:      { provider: 'sora', reason: 'Educational needs controlled explanation — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  podcast_style:    { provider: 'sora', reason: 'Podcast-style is script/pacing dependent — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  routine:          { provider: 'sora', reason: 'Routine is sequence-based, pacing matters — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  comparison:       { provider: 'sora', reason: 'Comparison needs contrast framing + voiceover — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  myth_busting:     { provider: 'sora', reason: 'Myth-busting is hook + script-led — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  pov_relatable:    { provider: 'sora', reason: 'POV relatable needs natural voice/pacing — Sora', fallbackChain: ['runway', 'higgsfield'], category: 'video-scripted' },
  hook_viral:       { provider: 'sora', reason: 'Viral hook timing is everything — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  ugc_style:        { provider: 'sora', reason: 'UGC-style video needs raw feel + structure — Sora', fallbackChain: ['runway', 'higgsfield'], category: 'video-scripted' },
  pattern_interrupt: { provider: 'sora', reason: 'Pattern interrupt needs precise timing — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  authority_claim:  { provider: 'sora', reason: 'Authority claim needs structured trust building — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  offer_stack:      { provider: 'sora', reason: 'Offer stack video needs clear CTA pacing — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  review_stack:     { provider: 'sora', reason: 'Review stack video needs proof pacing — Sora', fallbackChain: ['runway'], category: 'video-scripted' },
  faceless_product_only: { provider: 'sora', reason: 'Faceless product video — Sora for b-roll control', fallbackChain: ['runway', 'higgsfield'], category: 'video-scripted' },
  lifestyle:        { provider: 'sora', reason: 'Lifestyle video — Sora for visual storytelling', fallbackChain: ['runway'], category: 'video-scripted' },
};

// Default fallbacks for unknown creative types — rapid concept generation
const DEFAULT_IMAGE: ProviderSelection = {
  provider: 'nano-banana', reason: 'Default image routing — Nano Banana 2 for rapid concept generation and variations',
  fallbackChain: ['ideogram', 'stability', 'dalle'], category: 'clean-static',
};

const DEFAULT_VIDEO: ProviderSelection = {
  provider: 'sora', reason: 'Default video routing — Sora for script-led direct-response',
  fallbackChain: ['runway', 'higgsfield'], category: 'video-scripted',
};

// ═══ Provider availability check ═══

function isProviderAvailable(provider: string): boolean {
  const keyMap: Record<string, string> = {
    ideogram: 'IDEOGRAM_API_KEY',
    stability: 'STABILITY_API_KEY',
    dalle: 'OPENAI_API_KEY',
    sora: 'OPENAI_API_KEY',
    runway: 'RUNWAY_API_KEY',
    higgsfield: 'HIGGSFIELD_API_KEY',
    'gemini-image': 'GEMINI_API_KEY',
    veo: 'GEMINI_API_KEY',
    'nano-banana': 'FAL_KEY',
    seedance: 'FAL_KEY',
    // minimax removed from active routing
  };
  const envKey = keyMap[provider];
  return envKey ? !!process.env[envKey] : false;
}

// ═══ Main Router ═══

export interface RouteRequest {
  contentType: 'image' | 'video';
  creativeType: string;
  platform?: string;
  aspectRatio?: string;
  winnerProvider?: string; // provider used by winner reference
  duration?: number;       // video duration in seconds
  hasProductImages?: boolean; // true if real product photos are available
}

export interface RouteResult {
  provider: string;
  reason: string;
  fallbackChain: string[];
  category: string;
  skippedProviders?: { provider: string; reason: string }[];
}

/**
 * Deterministic provider selection. Never random.
 * Checks API key availability and skips unavailable providers.
 */
export function selectProvider(req: RouteRequest): RouteResult {
  const { contentType, creativeType, winnerProvider, duration, hasProductImages } = req;
  const normalizedType = (creativeType || '').replace(/-/g, '_');
  const skipped: { provider: string; reason: string }[] = [];

  // If winner reference used a specific provider, prefer it
  if (winnerProvider && isProviderAvailable(winnerProvider)) {
    const routing = contentType === 'video' ? VIDEO_ROUTING : IMAGE_ROUTING;
    const base = routing[normalizedType] || (contentType === 'video' ? DEFAULT_VIDEO : DEFAULT_IMAGE);
    return {
      provider: winnerProvider,
      reason: `Winner reference used ${winnerProvider} — maintaining provider consistency`,
      fallbackChain: base.fallbackChain.filter(p => p !== winnerProvider),
      category: base.category,
    };
  }

  // Look up the routing table
  let selection: ProviderSelection;
  if (contentType === 'video') {
    selection = { ...(VIDEO_ROUTING[normalizedType] || DEFAULT_VIDEO) };

    // For videos, check duration compatibility
    // Sora: 8-20s, Runway: 5-10s, Higgsfield: ~5s, MiniMax: 5-6s, Veo: 4-8s
    if (duration && duration > 10 && selection.provider !== 'sora') {
      // Only Sora handles >10s
      selection.provider = 'sora';
      selection.reason += ` (overridden: ${duration}s requires Sora)`;
    }
  } else {
    selection = { ...(IMAGE_ROUTING[normalizedType] || DEFAULT_IMAGE) };

    // CRITICAL: If product images exist, the provider MUST support reference images.
    // CAN use reference images: Nano Banana (editImage), Stability, GPT Image (dalle), Gemini Image
    // CANNOT use reference images: Ideogram (text-only), MiniMax Image
    // When Ideogram is selected for a text-heavy type but product images exist,
    // swap to Nano Banana — it still renders text well AND supports image references.
    if (hasProductImages) {
      const textOnlyProviders = ['ideogram'];
      if (textOnlyProviders.includes(selection.provider)) {
        selection = {
          provider: 'nano-banana',
          reason: `Product images provided — Nano Banana 2 for reference-image support + text rendering (${selection.provider} is text-only)`,
          fallbackChain: ['stability', 'dalle', 'gemini-image'],
          category: 'product-fidelity',
        };
      } else {
        // Even if primary supports images, remove text-only providers from fallback
        selection.fallbackChain = selection.fallbackChain.filter(p => !textOnlyProviders.includes(p));
        // Ensure Nano Banana is in the chain — best reference-image fallback
        if (!selection.fallbackChain.includes('nano-banana') && selection.provider !== 'nano-banana') {
          selection.fallbackChain.unshift('nano-banana');
        }
      }
    }
  }

  // Check if primary provider is available
  if (!isProviderAvailable(selection.provider)) {
    skipped.push({ provider: selection.provider, reason: 'API key not configured' });

    // Walk the fallback chain
    let found = false;
    for (const fb of selection.fallbackChain) {
      if (isProviderAvailable(fb)) {
        selection = {
          ...selection,
          provider: fb,
          reason: `${selection.provider} unavailable — using ${fb} (fallback)`,
        };
        found = true;
        break;
      } else {
        skipped.push({ provider: fb, reason: 'API key not configured' });
      }
    }

    if (!found) {
      // Last resort — try any available provider (Nano Banana first for images)
      const anyImage = ['nano-banana', 'ideogram', 'stability', 'dalle', 'gemini-image'];
      const anyVideo = ['sora', 'runway', 'higgsfield', 'veo'];
      const candidates = contentType === 'video' ? anyVideo : anyImage;
      for (const p of candidates) {
        if (isProviderAvailable(p)) {
          selection = {
            ...selection,
            provider: p,
            reason: `All preferred providers unavailable — using ${p} as last resort`,
          };
          found = true;
          break;
        }
      }
    }
  }

  const result: RouteResult = {
    provider: selection.provider,
    reason: selection.reason,
    fallbackChain: selection.fallbackChain.filter(p => p !== selection.provider),
    category: selection.category,
  };

  if (skipped.length > 0) result.skippedProviders = skipped;

  console.log(`[ROUTER] ${contentType}/${normalizedType} → ${result.provider} | ${result.reason}`);

  return result;
}

/**
 * Get the full fallback chain for a given creative type, filtered by availability.
 * Used by render-image for auto-failover.
 */
export function getImageFailoverChain(creativeType: string): string[] {
  const normalizedType = (creativeType || '').replace(/-/g, '_');
  const selection = IMAGE_ROUTING[normalizedType] || DEFAULT_IMAGE;
  const fullChain = [selection.provider, ...selection.fallbackChain];
  return fullChain.filter(p => isProviderAvailable(p));
}

/**
 * Client-side helper: get default engine for a creative type + content type.
 * Returns just the provider name string. Doesn't check API key availability.
 */
export function getDefaultProvider(contentType: 'image' | 'video', creativeType: string): string {
  const normalizedType = (creativeType || '').replace(/-/g, '_');
  if (contentType === 'video') {
    return (VIDEO_ROUTING[normalizedType] || DEFAULT_VIDEO).provider;
  }
  return (IMAGE_ROUTING[normalizedType] || DEFAULT_IMAGE).provider;
}
