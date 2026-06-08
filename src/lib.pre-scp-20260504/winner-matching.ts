/**
 * Winner-Driven Generation Engine
 *
 * Core principle: when a winner exists for a setup, the AI must REPRODUCE
 * the winner's structure with only small controlled variations — not create
 * something new.
 *
 * Provides:
 * - extractDNA(pkg)                — deep structural extraction from a package
 * - findBestReference(db, storeId, config) — find matching winner (≥60% match)
 * - buildWinnerPromptBlock(winner) — auto-match: strong structural constraint
 * - buildMoreLikeThisPrompt(winner) — explicit "more like this": strictest mode
 * - calculateSimilarity(config, winner) — score 0-100
 */

// ═══ Deep DNA Extraction ═══

export interface WinnerDNA {
  hookPattern: string;
  hookType: string;
  scriptRhythm: string;
  pacingNotes: string;
  sentenceStructure: string;
  sceneTiming: string;
  ctaStructure: string;
  ctaStyle: string;
  proofStyle: string;
  visualComposition: string;
  visualDirection: string;
  brollDirection: string;
  productFraming: string;
  avatarType: string;
  energyTone: string;
  editingFeel: string;
  format: string;
}

/**
 * Extract deep structural DNA from a creative package.
 * Captures everything needed to reproduce the winner's feel.
 */
export function extractDNA(pkg: any): WinnerDNA {
  const script = pkg.script || '';
  const sentences = script.split(/[.!?]+/).filter((s: string) => s.trim().length > 0);
  const wordCounts = sentences.map((s: string) => s.trim().split(/\s+/).length);
  const avgWords = wordCounts.length > 0 ? Math.round(wordCounts.reduce((a: number, b: number) => a + b, 0) / wordCounts.length) : 0;
  const totalWords = wordCounts.reduce((a: number, b: number) => a + b, 0);

  // Hook analysis
  const hookLine = pkg.hook || pkg.hookText || sentences[0]?.trim() || '';
  const hookType = (() => {
    const h = hookLine.toLowerCase();
    if (h.match(/did you know|have you ever|what if|do you/)) return 'question';
    if (h.match(/stop|wait|hold on|okay wait|listen/)) return 'pattern_interrupt';
    if (h.match(/I was|my friend|someone told me|I never/)) return 'personal_story';
    if (h.match(/\d+%|studies show|proven|research/)) return 'statistic';
    if (h.match(/this is|here's|the secret|the truth/)) return 'direct_statement';
    return 'conversational';
  })();

  // Scene timing from structure field or script analysis
  const sceneTiming = pkg.sceneStructure || (() => {
    if (totalWords <= 18) return 'Hook 0-3s → Product 3-6s → CTA 6-8s';
    if (totalWords <= 28) return 'Hook 0-3s → Problem 3-6s → Product 6-12s → CTA 12-15s';
    return 'Hook 0-3s → Story 3-8s → Product 8-15s → Proof 15-18s → CTA 18-20s';
  })();

  // CTA analysis
  const cta = pkg.cta || pkg.ctaText || pkg.ctaDirection || '';
  const ctaStyle = (() => {
    const c = cta.toLowerCase();
    if (c.match(/link|tap|click|visit|check/)) return 'link-click';
    if (c.match(/try|get|grab|order|buy/)) return 'direct-purchase';
    if (c.match(/limited|hurry|last|ending|today only/)) return 'urgency';
    if (c.match(/learn|discover|see|find out/)) return 'soft-curiosity';
    return 'standard';
  })();

  // Proof style
  const proofStyle = pkg.proofElement || (() => {
    const full = (script + ' ' + (pkg.hook || '') + ' ' + (pkg.hookText || '')).toLowerCase();
    if (full.match(/\d+%|\d+ out of \d+|clinically|studies/)) return 'statistical';
    if (full.match(/before.*(and|&).*after|transformation|results in/)) return 'before-after';
    if (full.match(/review|customer|testimonial|said|told me/)) return 'social-proof';
    if (full.match(/doctor|expert|dermatolog|scientist/)) return 'authority';
    if (full.match(/I tried|my experience|personally/)) return 'personal-experience';
    return 'product-demo';
  })();

  // Energy/tone
  const energyTone = (() => {
    const full = (script + ' ' + hookLine).toLowerCase();
    if (full.match(/urgent|limited|hurry|last chance|don't miss/)) return 'urgent-high-energy';
    if (full.match(/calm|gentle|soothing|relax|peaceful/)) return 'calm-educational';
    if (full.match(/excited|amazing|incredible|wow|game.changer|obsessed/)) return 'enthusiastic-hype';
    if (full.match(/honest|real talk|truth|no bs|actually|real/)) return 'authentic-real-talk';
    if (full.match(/weird|strange|unexpected|surprising/)) return 'curiosity-driven';
    return 'conversational-casual';
  })();

  // Editing feel
  const editingFeel = pkg.pacingNotes || (() => {
    const full = (script + ' ' + (pkg.visualDirection || '')).toLowerCase();
    if (full.match(/quick cut|fast|snap|montage|rapid/)) return 'fast-cut-montage';
    if (full.match(/slow|linger|hold|breathe|gentle/)) return 'slow-deliberate';
    if (full.match(/handheld|ugc|raw|iphone|selfie/)) return 'raw-ugc-handheld';
    return 'natural-ugc-pacing';
  })();

  // Product framing
  const productFraming = pkg.productPlacement || pkg.product_placement || (() => {
    const full = (script + ' ' + (pkg.visualDirection || '') + ' ' + (pkg.brollDirection || '')).toLowerCase();
    if (full.match(/close-?up|detail|packaging|label/)) return 'close-up-detail';
    if (full.match(/lifestyle|in use|everyday|routine/)) return 'lifestyle-integration';
    if (full.match(/hero|center|focal|spotlight/)) return 'hero-center-shot';
    if (full.match(/hand|holding|palm|grip/)) return 'in-hand-demo';
    return 'natural-product-placement';
  })();

  return {
    hookPattern: hookLine,
    hookType,
    scriptRhythm: `${sentences.length} sentences, avg ${avgWords} words each, ${totalWords} total words`,
    pacingNotes: editingFeel,
    sentenceStructure: `Sentence lengths: [${wordCounts.join(', ')}]`,
    sceneTiming,
    ctaStructure: cta,
    ctaStyle,
    proofStyle,
    visualComposition: pkg.visualComposition || pkg.visualDirection || '',
    visualDirection: pkg.visualDirection || '',
    brollDirection: pkg.brollDirection || '',
    productFraming,
    avatarType: pkg.presenterBehavior || pkg.avatarSuggestion || '',
    energyTone,
    editingFeel,
    format: pkg.imageFormat || 'ugc-video',
  };
}

// ═══ Setup Similarity ═══

interface SetupConfig {
  contentType?: string;
  creativeType?: string;
  funnelStage?: string;
  hookStyle?: string;
  avatarStyle?: string;
  platform?: string;
  duration?: number;
  aspectRatio?: string;
}

/**
 * Score how similar a generation config is to a saved winner (0-100).
 */
export function calculateSimilarity(config: SetupConfig, winner: any): number {
  let score = 0;
  let maxScore = 0;

  const checks: [string, string, number][] = [
    ['contentType', 'content_type', 25],
    ['creativeType', 'creative_type', 20],
    ['funnelStage', 'funnel_stage', 15],
    ['hookStyle', 'hook_style', 12],
    ['avatarStyle', 'avatar_style', 8],
    ['platform', 'platform', 5],
  ];

  for (const [configKey, winnerKey, weight] of checks) {
    maxScore += weight;
    const cVal = (config as any)[configKey];
    const wVal = winner[winnerKey];
    if (cVal && wVal && cVal === wVal) score += weight;
  }

  if (config.duration && winner.duration) {
    maxScore += 10;
    if (config.duration === winner.duration) score += 10;
    else if (Math.abs(config.duration - winner.duration) <= 5) score += 5;
  }

  if (config.aspectRatio && winner.aspect_ratio) {
    maxScore += 5;
    if (config.aspectRatio === winner.aspect_ratio) score += 5;
  }

  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

/**
 * Find the best matching winner reference for a given generation config.
 * Returns null if no good match (similarity < 60).
 */
export function findBestReference(db: any, storeId: string, config: SetupConfig): any | null {
  const winners: any[] = db.prepare(
    'SELECT * FROM winner_references WHERE store_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(storeId);

  if (winners.length === 0) return null;

  let best: any = null;
  let bestScore = 0;

  for (const w of winners) {
    const score = calculateSimilarity(config, w);
    if (score > bestScore) {
      bestScore = score;
      best = w;
    }
  }

  if (bestScore < 60) return null;

  return { ...best, _matchScore: bestScore };
}

// ═══ Winner Prompt Injection — Auto-Match ═══

/**
 * Build a STRICT structural constraint block for auto-matched winners.
 * The AI must follow the winner's structure, not just "be inspired by" it.
 */
export function buildWinnerPromptBlock(winner: any): string {
  return `

═══ WINNER REFERENCE — STRICT STRUCTURAL TEMPLATE (${winner._matchScore || '?'}% match) ═══

A proven winner has been saved for this exact setup. You MUST reproduce its structure.

MANDATORY RULES:
1. Use the SAME hook type: ${winner.hook_pattern ? `"${winner.hook_pattern.substring(0, 100)}"` : 'N/A'}
2. Use the SAME script rhythm: ${winner.script_rhythm || 'N/A'}
3. Use the SAME scene timing: ${winner.structure_notes || winner.sentence_structure || 'N/A'}
4. Use the SAME proof approach: ${winner.proof_style || 'N/A'}
5. Use the SAME CTA style: ${winner.cta_structure || winner.cta || 'N/A'}
6. Use the SAME energy/tone: ${winner.energy_tone || 'N/A'}
7. Use the SAME visual direction: ${winner.visual_composition || 'N/A'}
8. Use the SAME product framing: ${winner.product_framing || 'N/A'}
9. Use the SAME editing feel: ${winner.editing_feel || winner.pacing_notes || 'N/A'}

WHAT YOU CAN CHANGE (controlled variations):
- Hook WORDING (keep the same pattern/type, change specific words)
- Proof DETAILS (keep same proof type, change the specific claim/stat)
- CTA WORDING (keep same urgency level, change specific phrasing)

WHAT YOU MUST NOT CHANGE:
- Overall structure and scene order
- Pacing and rhythm
- Tone and energy level
- Visual approach
- Format and editing style

${winner.script ? `REFERENCE SCRIPT (use as structural blueprint — match rhythm and flow, change words):
---
${winner.script.substring(0, 1000)}
---` : ''}
${winner.headline ? `REFERENCE HEADLINE: "${winner.headline}"` : ''}
${winner.primary_text ? `REFERENCE AD COPY: "${winner.primary_text.substring(0, 300)}"` : ''}

Each package you generate MUST read like a sibling of this winner — same DNA, slightly different words.
`;
}

// ═══ "Generate More Like This" — Strictest Mode ═══

/**
 * Build the strictest possible prompt for "Generate More Like This".
 * Each output should be nearly identical in structure to the source.
 */
export function buildMoreLikeThisPrompt(winner: any): string {
  return `

═══ GENERATE MORE LIKE THIS — MAXIMUM STRUCTURAL FIDELITY ═══

The user explicitly wants MORE creatives that are nearly identical to their proven winner.
This is NOT about "inspiration" — this is about REPRODUCTION with minor word changes.

SOURCE WINNER: "${winner.title || 'Untitled'}"
Concept: ${winner.concept || 'N/A'}

STRUCTURE TO COPY EXACTLY:
- Hook type: ${winner.hook_pattern ? `"${winner.hook_pattern.substring(0, 150)}"` : 'N/A'}
- Hook pattern: Open with the SAME type of hook (${winner.energy_tone || 'conversational'})
- Scene timing: ${winner.structure_notes || winner.sentence_structure || 'Same as reference'}
- Proof approach: ${winner.proof_style || 'Same as reference'}
- CTA: ${winner.cta_structure || winner.cta || 'Same style'}
- Energy: ${winner.energy_tone || 'Same as reference'}
- Visual: ${winner.visual_composition || 'Same as reference'}
- Editing: ${winner.editing_feel || winner.pacing_notes || 'Same as reference'}
- Product: ${winner.product_framing || 'Same placement'}
- Rhythm: ${winner.script_rhythm || 'Same pacing'}

${winner.script ? `FULL REFERENCE SCRIPT — MATCH THIS STRUCTURE LINE BY LINE:
---
${winner.script.substring(0, 1500)}
---

VARIATION INSTRUCTIONS:
Your output scripts must have:
- The SAME number of sentences (±1)
- The SAME sentence lengths (±3 words each)
- The SAME scene transitions
- The SAME emotional arc
- DIFFERENT specific words/claims/examples

Variation 1: Change HOOK wording only (same type: ${winner.energy_tone || 'same'})
Variation 2: Change PROOF element only (same type: ${winner.proof_style || 'same'})
Variation 3: Change CTA wording only (same urgency level)
Additional: Change emotional angle slightly (same energy level)` : ''}

${winner.headline ? `REFERENCE HEADLINE: "${winner.headline}" — match this length and style` : ''}
${winner.primary_text ? `REFERENCE AD COPY: "${winner.primary_text.substring(0, 500)}" — match this tone and structure` : ''}

QUALITY CHECK: If your output has a different structure, different pacing, or different energy than the reference — you have FAILED. Regenerate.
`;
}
