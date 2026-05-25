/**
 * Unified scene prompt builder. Single entry point for the scene-based pipeline.
 *
 * Called once per render from scene-pipeline.ts. Switches on AdType to pick a
 * system prompt template, calls the underlying LLM, and returns a normalized
 * Scene[] regardless of ad type. The pipeline below this layer is ad-type
 * agnostic — it just renders Scene[] through Seedance R2V.
 *
 * Replaces the dual prompt-construction sites that existed before unification:
 *   - seedance-pipeline.ts::breakIntoScenes (UGC-coded)
 *   - animated-concept.ts::buildSystemPrompt (animated-coded)
 *
 * The UGC and animated branches in this file are direct ports of those system
 * prompts (with minor adjustments to produce a unified Scene[] shape). B-roll
 * and Scene branches are new.
 */

import { generateText } from '@/lib/openai-chat';
import { STYLE_DEFINITIONS, getDefaultSceneCount } from '@/lib/animation-styles';
import type { AnimationStyle } from '@/components/creative-generator/types';
import type { AdType, Scene } from '@/lib/scene-types';

export interface BuildScenePromptsOptions {
  adType: AdType;
  /** Required when adType === 'animated'; ignored otherwise (passed through). */
  animationStyle?: AnimationStyle;
  product: { title: string; description?: string | null; image_url?: string | null };
  /** Optional pre-existing script from generate-package. UGC always passes it;
   *  animated may pass to anchor narration; b_roll/scene may pass for context. */
  script?: string;
  /** Optional angle/hook context for the LLM. */
  angle?: string;
  totalDuration: number;
  sceneCount: number;
  hasProductImage: boolean;
  contentMode?: 'product' | 'service';
}

/**
 * Build the scene array for one render. The output Scene shape is unified:
 *   - visualPrompt, duration, productVisible: always populated
 *   - spokenScript: populated for ugc + animated + (scene with script)
 *   - productInHand / productNearFace: populated for ugc only
 *   - cameraDirection: populated for animated only
 */
export async function buildScenePrompts(opts: BuildScenePromptsOptions): Promise<Scene[]> {
  const systemPrompt = buildSystemPrompt(opts);
  const userPrompt = buildUserPrompt(opts);

  const rawText = await generateText(systemPrompt, userPrompt, {
    maxTokens: 2000,
    temperature: 0.7,
  });

  return parseSceneArray(rawText, opts);
}

// ════════════════════════════════════════════════════════════════════
// System prompt templates — one per AdType.
// ════════════════════════════════════════════════════════════════════

const SERVICE_BUSINESS_FRAMING_PREFIX = `CONTEXT: You are creating an ad for a 3PL fulfillment service (ShipSourced), NOT a physical product. The "product" you are given describes a SERVICE: warehousing, pick/pack, shipping, fulfillment software. There is no physical good for the customer to receive — the value delivered is operational relief and growth enablement. Visual scenes should depict warehouses, branded boxes, conveyor belts, scanners, label printers in motion, mobile/laptop dashboards, founder/operator faces. AVOID: product beauty shots, lifestyle-consumer scenes, generic stock-photo "business handshake" cliches.

`;

function buildSystemPrompt(opts: BuildScenePromptsOptions): string {
  const base = opts.contentMode === 'service' ? SERVICE_BUSINESS_FRAMING_PREFIX : '';
  switch (opts.adType) {
    case 'ugc': return base + buildUgcPrompt(opts);
    case 'animated': return base + buildAnimatedPrompt(opts);
    case 'b_roll': return base + buildBRollPrompt(opts);
    case 'scene': return base + buildScenePrompt(opts);
  }
}

// ─── UGC ─────────────────────────────────────────────────────────────
// Ported from seedance-pipeline.ts::breakIntoScenes (the UGC-coded system
// prompt that drives Pattern 1 today). Output shape extended to match the
// unified Scene[] schema (visualPrompt + spokenScript + product flags).
function buildUgcPrompt(opts: BuildScenePromptsOptions): string {
  const sceneIndexHint = `0..${opts.sceneCount - 1}`;
  return `You are a UGC video director. Break a spoken script into exactly ${opts.sceneCount} sequential scenes for a ${opts.totalDuration}-second video.

For each scene, output a JSON array. Each scene object must have:
- sceneIndex: number (${sceneIndexHint})
- spokenScript: string — ONLY the exact words the person says in this scene. No directions, no labels. Just natural speech.
- visualPrompt: string — ONLY what the camera sees. Environment, lighting, camera angle, motion, framing. No spoken words.
- duration: number — seconds for this scene (sum to ~${opts.totalDuration})
- productVisible: boolean — is the product on screen?
- productInHand: boolean — is the person holding the product?
- productNearFace: boolean — is the product near their face/being applied?

DIALOGUE DENSITY (CRITICAL — UGC is talking-head; silence = dead air):
- Every scene's spokenScript MUST have 2.5-3.0 words per second of scene duration.
  Targets: a 4s scene = ~10-12 words. A 5s scene = ~12-15 words. A 7s scene = ~17-21 words.
- NO empty / blank spokenScript on ANY scene. UGC presenters never stop talking.
  If a scene feels visually-driven (e.g., before/after split-screen), still write
  one full sentence of voiceover that lands on that visual.
- Scene 0 (the hook): aim for the upper end (~3 wps). Hardest punch — pack the words in.
- Write at conversational pace — like a real TikTok UGC creator, not a slow narrator.
  Contractions, run-on energy, no long pauses inside the dialogue.

RULES:
- spokenScript must contain ZERO visual directions
- visualPrompt must contain ZERO dialogue
- visualPrompt must NOT depict any on-screen text, captions, subtitles, words, or text overlays anywhere in the frame. Visuals only — no rendered text of any kind. The voiceover (spokenScript) carries the message; no burned-in text in the rendered video.
- First scene: hook/problem. Middle: story/product. Last: result/CTA.
- Product name: "${opts.product.title}"
${opts.hasProductImage ? '- A product image will be provided as a reference frame' : ''}

Return ONLY valid JSON array. No markdown.`;
}

// ─── Animated ────────────────────────────────────────────────────────
// Ported from animated-concept.ts::buildSystemPrompt (the animated-coded
// system prompt). Style guide from STYLE_DEFINITIONS[animationStyle] is
// inlined; cameraDirection is animated-specific (carries the camera-move hint).
function buildAnimatedPrompt(opts: BuildScenePromptsOptions): string {
  const style = opts.animationStyle;
  if (!style) {
    throw new Error('buildAnimatedPrompt: animationStyle is required when adType === "animated"');
  }
  const styleDef = STYLE_DEFINITIONS[style];
  const perScene = Math.max(3, Math.floor(opts.totalDuration / Math.max(1, opts.sceneCount)));

  return `You are an expert performance ad creative director specializing in animated video ads for DTC brands on Meta and TikTok.

Your job is to produce a structured scene breakdown for a short ${styleDef.label} animated ad (~${opts.totalDuration} seconds). The output must be valid JSON.

ANIMATION STYLE: ${styleDef.label}
${styleDef.description}

Style guidance: ${styleDef.visualStyleGuide}

${styleDef.requiresCharacterConsistency
  ? 'A consistent character will appear across scenes — describe the character once in scene 0 and refer back to "the same character" in subsequent scenes.'
  : 'No character is needed; focus visualPrompt on product, environment, and effects.'}

CRITICAL RULES:
1. The first 2 seconds must hook the viewer. Cold open with a problem, surprising claim, or visual pattern interrupt.
2. Each scene's visualPrompt is 1-2 sentences describing a single concrete visual moment.
3. spokenScript (voiceover for the scene) is 6-12 words per scene, filling its duration at natural conversational pace.
4. Each scene's duration ≈ ${perScene} seconds (sum to ~${opts.totalDuration}).
5. Do NOT mention the brand name in visualPrompt repeatedly — the product is shown via reference image, the spokenScript handles brand naming.
6. The CTA goes in the last scene's spokenScript.
7. Avoid generic "AI ad" phrases like "transform your skin", "say goodbye to", "introducing the future of".
8. Do NOT depict any on-screen text, captions, subtitles, words, label callouts, or text overlays anywhere in the frame. Visuals only — no rendered text of any kind in the ${styleDef.label} composition. The voiceover handles all wording.
9. SHARED ENVIRONMENT (continuity rule): Scene 0's visualPrompt must establish ONE specific environment as a brief concrete phrase that INCLUDES a lighting clause. Examples: "a warm kitchen counter with morning light", "a clay-textured tabletop studio with soft pastel backlight", "a sunlit bedroom shelf with a window in soft focus". The lighting clause is REQUIRED — environments without one are incomplete. EVERY subsequent scene's visualPrompt must repeat that same environment phrase verbatim (the way "the same character" is repeated) before describing per-scene action. No new settings invented per scene — the environment is established once and held.
10. CAMERA ARC (continuity rule): cameraDirection across scenes must follow an intentional arc, NOT bounce randomly. Default arc: scene 0 establishes wide-to-medium (shows environment + character), middle scenes stay medium (action/explanation), the final scene returns to a hero medium or medium-close (CTA / character + product). You may pick a different arc (e.g. a gradual push-in from wide to close across the whole video), but the choice must be monotonic-ish and read as deliberate staging. FORBIDDEN: random per-scene alternation like close-up → wide → close-up → medium → wide.
11. NO NOVEL PROPS (continuity rule): Do NOT introduce per-scene visual props that weren't established in scene 0's environment. No confetti, no falling petals, no glowing graphics, no decorative additions specific to one scene. Props must either appear in scene 0's environment or be a direct result of character action (e.g., character squeezes tube → product on character's lips; character points at product → product on the shared counter).

Output JSON ARRAY (not an object), exactly ${opts.sceneCount} scenes. Each scene must have:
- sceneIndex: number (0..${opts.sceneCount - 1})
- visualPrompt: string — 1-2 sentences of what is on screen, in the ${styleDef.label} aesthetic
- spokenScript: string — voiceover for this scene
- duration: number — seconds (≈${perScene})
- productVisible: boolean — does the product appear in this scene?
- cameraDirection: string — optional camera move (e.g., "slow zoom in", "static medium shot")

Product name: "${opts.product.title}"
${opts.hasProductImage ? '- A product image will be provided as a reference frame for product-visible scenes' : ''}

Return ONLY valid JSON array. No markdown.`;
}

// ─── B-roll ──────────────────────────────────────────────────────────
// New for unification. Product-focused B-roll, no avatar, no dialogue.
function buildBRollPrompt(opts: BuildScenePromptsOptions): string {
  return `You are a product video director. Produce exactly ${opts.sceneCount} sequential B-roll scenes for a ${opts.totalDuration}-second product video. NO avatar, NO dialogue — these are pure visual product scenes.

Each scene should be one concrete product-focused visual moment:
- Close-up of the product (texture, finish, label detail)
- Hands using/applying/holding the product (no face shown)
- Environmental context (product in its use environment — bathroom shelf, kitchen counter, gym bag)
- Texture/material/ingredient detail
- Before/after states the product enables
- Lifestyle integration with product as focus

For each scene, output a JSON array. Each scene object must have:
- sceneIndex: number (0..${opts.sceneCount - 1})
- visualPrompt: string — 1-2 sentences of the product-focused visual. Camera angle, lighting, framing.
- duration: number — seconds (sum to ~${opts.totalDuration}, prefer 4-6s per scene)
- productVisible: boolean — almost always TRUE for b_roll (this is product-focused content)
- cameraDirection: string — optional camera move

RULES:
- NO spokenScript field — b_roll has no dialogue
- NO people speaking — hands and product only, faces blurred or off-screen
- NO on-screen text, captions, subtitles, words, or text overlays anywhere in the frame. Pure visual product content — no rendered text of any kind.
- visualPrompt focuses on the product, its texture, its use, its results
- Product name: "${opts.product.title}"
${opts.hasProductImage ? '- A product image will be provided as a reference frame' : ''}

Return ONLY valid JSON array. No markdown.`;
}

// ─── Scene (free-form) ───────────────────────────────────────────────
// New for unification. Generic scene-based — caller-defined intent.
function buildScenePrompt(opts: BuildScenePromptsOptions): string {
  return `You are a video director. Break the given script (or product brief) into exactly ${opts.sceneCount} sequential scenes for a ${opts.totalDuration}-second video. No forced format — render whatever the script describes naturally.

For each scene, output a JSON array. Each scene object must have:
- sceneIndex: number (0..${opts.sceneCount - 1})
- visualPrompt: string — 1-2 sentences of what is on screen. Be concrete and visual.
- duration: number — seconds (sum to ~${opts.totalDuration})
- productVisible: boolean — does the product appear in this scene?
- spokenScript: string — optional. Include dialogue/narration if the script implies it; omit if the scene is silent.
- cameraDirection: string — optional camera move

RULES:
- visualPrompt must be concrete (a camera could shoot it)
- visualPrompt must NOT depict any on-screen text, captions, subtitles, words, or text overlays anywhere in the frame. Visuals only — no rendered text of any kind.
- If you include spokenScript, keep it concise and natural — no labels, no directions
- Product name: "${opts.product.title}"
${opts.hasProductImage ? '- A product image will be provided as a reference frame for product-visible scenes' : ''}

Return ONLY valid JSON array. No markdown.`;
}

// ════════════════════════════════════════════════════════════════════
// User prompt — same shape for every adType. Carries product context +
// optional script.
// ════════════════════════════════════════════════════════════════════
function buildUserPrompt(opts: BuildScenePromptsOptions): string {
  const parts: string[] = [];
  parts.push(`PRODUCT: ${opts.product.title}`);
  if (opts.product.description) {
    parts.push(`PRODUCT DESCRIPTION: ${opts.product.description.slice(0, 500)}`);
  }
  if (opts.angle) {
    parts.push(`ANGLE: ${opts.angle}`);
  }
  if (opts.script) {
    parts.push(`SCRIPT / BRIEF:\n${opts.script.slice(0, 2000)}`);
  }
  parts.push(`TOTAL DURATION: ${opts.totalDuration}s`);
  parts.push(`SCENE COUNT: ${opts.sceneCount}`);
  parts.push('\nGenerate the scene array as JSON.');
  return parts.join('\n\n');
}

// ════════════════════════════════════════════════════════════════════
// Response parsing — normalizes the LLM output into Scene[].
// ════════════════════════════════════════════════════════════════════
function parseSceneArray(raw: string, opts: BuildScenePromptsOptions): Scene[] {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Scene builder returned non-JSON: ${(err as Error).message}. Raw (first 300): ${cleaned.slice(0, 300)}`,
    );
  }

  // LLM sometimes wraps the array as { scenes: [...] }. Unwrap.
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.scenes)) {
    parsed = parsed.scenes;
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Scene builder returned non-array: ${typeof parsed}`);
  }

  const perSceneFallback = Math.max(3, Math.floor(opts.totalDuration / Math.max(1, opts.sceneCount)));

  return parsed.map((s: any, idx: number): Scene => {
    const scene: Scene = {
      sceneIndex: typeof s.sceneIndex === 'number' ? s.sceneIndex : idx,
      visualPrompt: String(s.visualPrompt || s.visualDescription || '').trim(),
      duration: typeof s.duration === 'number' && s.duration > 0 ? s.duration : perSceneFallback,
      productVisible: !!s.productVisible,
    };
    // Optional fields — only attach when the LLM populated them. UGC sets all
    // three product flags; animated typically sets cameraDirection; b_roll
    // omits spokenScript entirely.
    if (s.spokenScript && String(s.spokenScript).trim()) {
      scene.spokenScript = String(s.spokenScript).trim();
    }
    if (typeof s.productInHand === 'boolean') scene.productInHand = s.productInHand;
    if (typeof s.productNearFace === 'boolean') scene.productNearFace = s.productNearFace;
    if (s.cameraDirection && String(s.cameraDirection).trim()) {
      scene.cameraDirection = String(s.cameraDirection).trim();
    }
    return scene;
  });
}

// ════════════════════════════════════════════════════════════════════
// Convenience: derive a sensible scene count when caller has none.
// ════════════════════════════════════════════════════════════════════
export function defaultSceneCountFor(adType: AdType, animationStyle?: AnimationStyle): number {
  if (adType === 'animated' && animationStyle) {
    return getDefaultSceneCount(animationStyle);
  }
  return 4;
}
