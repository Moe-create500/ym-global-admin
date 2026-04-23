/**
 * Seedance Pipeline — Script → Scenes → Render → Assemble
 *
 * Architecture:
 *   1. generateScript()    — LLM writes a short UGC script
 *   2. breakIntoScenes()   — LLM splits script into 2-3 scenes with separate visual/dialogue
 *   3. validateScene()     — Enforces strict separation before rendering
 *   4. renderScene()       — Calls Seedance I2V or T2V per scene
 *   5. buildCaptions()     — Deterministic captions from spokenScript fields
 *
 * Rules:
 *   - spokenScript contains ONLY natural dialogue (no labels, no prefixes)
 *   - visualPrompt contains ONLY scene direction (no dialogue)
 *   - Product placement is explicit per scene (visible, inHand, nearFace)
 *   - Seedance generates native audio (generate_audio: true) for lip sync
 */

import { generateText } from '@/lib/openai-chat';
import { createImageToVideo as seedanceI2V, createTextToVideo as seedanceT2V } from '@/lib/seedance';
import { normalizeScript, chunkScriptForSeedance, buildLanguageEnforcement } from '@/lib/voice-pipeline';

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

export interface Scene {
  sceneIndex: number;
  spokenScript: string;       // ONLY natural dialogue — no labels, no directions
  visualPrompt: string;       // ONLY scene direction — no dialogue
  duration: number;           // seconds (4-8 per scene)
  productVisible: boolean;
  productInHand: boolean;
  productNearFace: boolean;
}

export interface SeedanceJob {
  sceneIndex: number;
  requestId: string;
  model: string;
}

// ════════════════════════════════════════════════════════════
// 1. SCRIPT ENGINE
// ════════════════════════════════════════════════════════════

/**
 * Generate a short, natural UGC ad script.
 * Returns clean conversational dialogue only.
 */
export async function generateScript(opts: {
  productName: string;
  productDescription?: string;
  angle?: string;
  funnelStage?: string;
  hookStyle?: string;
  duration?: number;
}): Promise<string> {
  const dur = opts.duration || 15;
  const stage = opts.funnelStage || 'tof';

  const system = `You are a UGC ad scriptwriter. Write a ${dur}-second spoken script for a short-form video ad.

RULES:
- 3 to 5 sentences maximum
- Problem, story, solution arc
- Conversational and human. Like a real person talking to camera.
- One idea per sentence
- No abbreviations, no symbols, no percentages, no technical terms
- No labels like "Hook:" or "Line 1:" or "CTA:"
- No stage directions or camera instructions
- No product ingredient lists
- Just natural spoken words
- The script should feel like someone genuinely sharing their experience

FUNNEL STAGE: ${stage === 'tof' ? 'Top of funnel — grab attention, relate to a problem' : stage === 'mof' ? 'Middle of funnel — build trust, show transformation' : 'Bottom of funnel — urgency, clear call to action'}

Return ONLY the spoken dialogue. Nothing else.`;

  const user = `Product: ${opts.productName}${opts.productDescription ? `\nDescription: ${opts.productDescription}` : ''}${opts.angle ? `\nAngle: ${opts.angle}` : ''}${opts.hookStyle ? `\nHook style: ${opts.hookStyle}` : ''}`;

  const result = await generateText(system, user);
  return cleanScript(result);
}

// ════════════════════════════════════════════════════════════
// 2. SCENE BREAKDOWN ENGINE
// ════════════════════════════════════════════════════════════

/**
 * Break a script into 2-3 scenes with separated visual and dialogue layers.
 * If script is already provided (user wrote it), break it down.
 * If no script, use the raw prompt and extract dialogue vs visuals.
 */
export async function breakIntoScenes(opts: {
  script: string;
  totalDuration: number;
  productName: string;
  productDescription?: string;
  hasProductImage: boolean;
}): Promise<Scene[]> {
  const { script, totalDuration, productName, hasProductImage } = opts;

  const system = `You are a UGC video director. Break a spoken script into 2-3 sequential scenes for a ${totalDuration}-second video.

For each scene, output a JSON array. Each scene object must have:
- sceneIndex: number (0, 1, 2)
- spokenScript: string — ONLY the exact words the person says in this scene. No directions, no labels, no "Hook:" prefixes. Just natural speech.
- visualPrompt: string — ONLY what the camera sees. Environment, lighting, camera angle, motion, framing. No spoken words in this field.
- duration: number — seconds for this scene (must add up to ~${totalDuration})
- productVisible: boolean — is the product on screen?
- productInHand: boolean — is the person holding the product?
- productNearFace: boolean — is the product near their face/being applied?

RULES:
- spokenScript must contain ZERO visual directions
- visualPrompt must contain ZERO dialogue
- Each scene is one coherent moment
- Natural pacing — person speaks at normal conversational speed
- Product appears naturally, not forced
- First scene: hook/problem. Middle: story/product. Last: result/CTA.
- Product name: "${productName}"
${hasProductImage ? '- A product image will be provided as the starting frame' : ''}

Return ONLY valid JSON array. No markdown, no explanation.`;

  const result = await generateText(system, script);

  let scenes: Scene[];
  try {
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    scenes = JSON.parse(cleaned);
  } catch {
    // Fallback: treat entire script as one scene
    console.warn('[SEEDANCE-PIPELINE] Failed to parse scene breakdown, using single scene');
    scenes = [{
      sceneIndex: 0,
      spokenScript: cleanScript(script),
      visualPrompt: `UGC selfie video. Person talking to camera in natural light. Casual, authentic feel. Handheld iPhone camera.`,
      duration: totalDuration,
      productVisible: hasProductImage,
      productInHand: hasProductImage,
      productNearFace: false,
    }];
  }

  // Validate and clean each scene
  return scenes.map((s, i) => ({
    sceneIndex: i,
    spokenScript: cleanScript(s.spokenScript || ''),
    visualPrompt: stripDialogueFromVisual(s.visualPrompt || ''),
    duration: s.duration || Math.round(totalDuration / scenes.length),
    productVisible: !!s.productVisible,
    productInHand: !!s.productInHand,
    productNearFace: !!s.productNearFace,
  }));
}

/**
 * Parse a raw user prompt into scenes without LLM.
 * Used when the user already wrote the full prompt (not auto-generated).
 */
export function parsePromptIntoScenes(
  rawPrompt: string,
  totalDuration: number,
  hasProductImage: boolean,
): Scene[] {
  const dialogueLines: string[] = [];
  const visualLines: string[] = [];

  for (const line of rawPrompt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Visual/technical lines
    if (/^\[/.test(trimmed) ||
        /^(PRODUCT VISUAL|CAMERA|LIGHTING|STYLE|TECHNICAL|VISUAL|OPENING|Scene|Shot|RULES|FORMAT|COMPOSITION|FAST-PACED|This is a \d|PRODUCT REFERENCE|HOOK|CTA|Offer)/i.test(trimmed)) {
      visualLines.push(trimmed);
    } else if (/^".*"$/.test(trimmed)) {
      // Quoted dialogue
      dialogueLines.push(trimmed.replace(/^"|"$/g, ''));
    } else if (trimmed.length > 10 && /[a-z]/.test(trimmed) && !/^(RULES|Do not|Must be|Ensure|Avoid|Never|Always|Critical)/i.test(trimmed)) {
      dialogueLines.push(trimmed);
    } else {
      visualLines.push(trimmed);
    }
  }

  const spoken = dialogueLines.length > 0
    ? cleanScript(dialogueLines.join(' '))
    : cleanScript(rawPrompt);

  const visual = visualLines.length > 0
    ? visualLines.join('\n')
    : 'UGC selfie video. Person talking to camera in natural light. Casual, authentic feel. Handheld iPhone camera.';

  // Split into 2-3 scenes based on sentence count
  const sentences = spoken.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 5);
  const sceneCount = sentences.length <= 2 ? 1 : sentences.length <= 4 ? 2 : 3;
  const sceneDuration = Math.round(totalDuration / sceneCount);
  const scenes: Scene[] = [];

  for (let i = 0; i < sceneCount; i++) {
    const start = Math.round(i * sentences.length / sceneCount);
    const end = Math.round((i + 1) * sentences.length / sceneCount);
    const sceneDialogue = sentences.slice(start, end).join(' ');
    const isProductScene = i > 0 && hasProductImage; // product appears after hook

    scenes.push({
      sceneIndex: i,
      spokenScript: sceneDialogue,
      visualPrompt: visual,
      duration: sceneDuration,
      productVisible: isProductScene,
      productInHand: isProductScene,
      productNearFace: i === sceneCount - 1 && hasProductImage,
    });
  }

  return scenes;
}

// ════════════════════════════════════════════════════════════
// 3. VALIDATION
// ════════════════════════════════════════════════════════════

/**
 * Validate a scene before rendering.
 * Returns null if valid, or an error string if invalid.
 */
export function validateScene(scene: Scene): string | null {
  const { spokenScript, visualPrompt } = scene;

  // spokenScript must not contain visual directions
  if (/\b(camera|lighting|frame|aspect ratio|resolution|iPhone|handheld|UGC|selfie|B-roll|close-up|wide shot|pan|zoom|depth of field)\b/i.test(spokenScript)) {
    return `spokenScript contains visual direction: "${spokenScript.substring(0, 60)}..."`;
  }

  // spokenScript must not contain labels
  if (/^(Hook|Line \d|CTA|Scene|Shot|OPENING|TECHNICAL|VISUAL|RULES):/im.test(spokenScript)) {
    return `spokenScript contains labels: "${spokenScript.substring(0, 60)}..."`;
  }

  // visualPrompt must not contain dialogue (quoted speech or conversational text)
  // Allow short descriptive phrases but flag long conversational sentences
  const visualSentences = visualPrompt.split(/[.!?]/).filter(s => s.trim().length > 20);
  for (const vs of visualSentences) {
    const t = vs.trim();
    // If it reads like speech (first person, questions, emotional language)
    if (/\b(I was|I found|my skin|my face|I can't believe|you have to|try this|check this|I've been)\b/i.test(t)) {
      return `visualPrompt contains dialogue: "${t.substring(0, 60)}..."`;
    }
  }

  // spokenScript must not be empty
  if (spokenScript.trim().length < 5) {
    return 'spokenScript is empty or too short';
  }

  return null; // valid
}

// ════════════════════════════════════════════════════════════
// 4. SEEDANCE SCENE RENDERER
// ════════════════════════════════════════════════════════════

/**
 * Render a single scene with Seedance.
 * Builds the prompt with strict separation: visual first, then spoken dialogue.
 */
export async function renderScene(opts: {
  scene: Scene;
  productImageUrl: string | null;
  productDescription?: string;
  aspectRatio: string;
}): Promise<SeedanceJob> {
  const { scene, productImageUrl, productDescription, aspectRatio } = opts;

  // Build product placement instructions for the visual prompt
  let productPlacement = '';
  if (scene.productVisible) {
    const parts: string[] = [];
    if (scene.productInHand) parts.push('Person is holding the product');
    if (scene.productNearFace) parts.push('Product is near their face, being shown or applied');
    if (!scene.productInHand && !scene.productNearFace) parts.push('Product is visible in the scene');
    if (productDescription) parts.push(`Product: ${productDescription}`);
    productPlacement = parts.join('. ') + '.';
  }

  // Construct the Seedance prompt: visual context, then natural dialogue
  const promptParts: string[] = [];

  // Visual scene direction
  if (scene.visualPrompt) {
    promptParts.push(scene.visualPrompt);
  }

  // Product placement (part of visual, not dialogue)
  if (productPlacement) {
    promptParts.push(productPlacement);
  }

  // Spoken dialogue — chunked and formatted for clear Seedance speech
  promptParts.push(chunkScriptForSeedance(scene.spokenScript));

  // Language enforcement to prevent gibberish/drift
  promptParts.push(buildLanguageEnforcement());

  const seedancePrompt = promptParts.join('\n\n');

  console.log(`[SEEDANCE-PIPELINE] Rendering scene ${scene.sceneIndex}: dur=${scene.duration}s, product=${scene.productVisible}, prompt=${seedancePrompt.length} chars`);
  console.log(`[SEEDANCE-PIPELINE] Visual: "${scene.visualPrompt.substring(0, 80)}..."`);
  console.log(`[SEEDANCE-PIPELINE] Spoken: "${scene.spokenScript.substring(0, 80)}..."`);
  console.log(`[SEEDANCE-PIPELINE] Product visible=${scene.productVisible}, inHand=${scene.productInHand}, nearFace=${scene.productNearFace}`);

  // Use I2V if product image available and scene has product visible, else T2V
  if (productImageUrl && scene.productVisible) {
    const result = await seedanceI2V(seedancePrompt, productImageUrl, {
      duration: scene.duration,
      aspectRatio,
    });
    return { sceneIndex: scene.sceneIndex, requestId: result.requestId, model: result.model };
  } else {
    const result = await seedanceT2V(seedancePrompt, {
      duration: scene.duration,
      aspectRatio,
    });
    return { sceneIndex: scene.sceneIndex, requestId: result.requestId, model: result.model };
  }
}

/**
 * Render all scenes and return their job IDs.
 */
export async function renderAllScenes(opts: {
  scenes: Scene[];
  productImageUrl: string | null;
  productDescription?: string;
  aspectRatio: string;
}): Promise<SeedanceJob[]> {
  const jobs: SeedanceJob[] = [];

  for (const scene of opts.scenes) {
    // Validate before rendering
    const error = validateScene(scene);
    if (error) {
      console.error(`[SEEDANCE-PIPELINE] Scene ${scene.sceneIndex} validation failed: ${error}`);
      // Auto-fix: strip visual content from spokenScript
      scene.spokenScript = cleanScript(scene.spokenScript);
      const retryError = validateScene(scene);
      if (retryError) {
        throw new Error(`Scene ${scene.sceneIndex} invalid after cleanup: ${retryError}`);
      }
    }

    const job = await renderScene({
      scene,
      productImageUrl: opts.productImageUrl,
      productDescription: opts.productDescription,
      aspectRatio: opts.aspectRatio,
    });
    jobs.push(job);
  }

  return jobs;
}

// ════════════════════════════════════════════════════════════
// 5. CAPTION ENGINE
// ════════════════════════════════════════════════════════════

/**
 * Build captions from scene spoken scripts.
 * Deterministic — never uses provider transcript.
 */
export function buildCaptions(scenes: Scene[]): string {
  return scenes
    .sort((a, b) => a.sceneIndex - b.sceneIndex)
    .map(s => s.spokenScript)
    .join(' ')
    .trim();
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Clean a script: remove labels, formatting, abbreviations, symbols.
 */
function cleanScript(text: string): string {
  let s = text;
  // Remove labels like "Hook:", "Line 1:", "CTA:", "Scene 1:"
  s = s.replace(/^(Hook|Line \d+|CTA|Scene \d+|Shot \d+|OPENING|BODY|CLOSE)\s*[:—–-]\s*/gim, '');
  // Remove brackets
  s = s.replace(/\[.*?\]/g, '');
  s = s.replace(/\(.*?\)/g, '');
  // Remove technical keywords
  s = s.replace(/^(CAMERA|LIGHTING|TECHNICAL|VISUAL|PRODUCT VISUAL|RULES|FORMAT|COMPOSITION)[:].*/gim, '');
  // Normalize through voice pipeline
  s = normalizeScript(s);
  // Final cleanup
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Strip any dialogue from a visual prompt.
 */
function stripDialogueFromVisual(visual: string): string {
  let s = visual;
  // Remove quoted speech
  s = s.replace(/"[^"]*"/g, '');
  // Remove lines that look like dialogue (first person, conversational)
  const lines = s.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return false;
    if (/\b(I was|I found|I can't|I've been|my skin|my face|you have to|try this|check this out)\b/i.test(t)) return false;
    return true;
  });
  return lines.join('\n').trim();
}
