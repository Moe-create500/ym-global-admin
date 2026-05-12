import { generateText } from '@/lib/openai-chat';
import { STYLE_DEFINITIONS, getDefaultSceneCount } from '@/lib/animation-styles';
import type { AnimationStyle, GeneratorConfig, Product } from '@/components/creative-generator/types';
import type { StoryboardScene } from '@/lib/animated-storyboard';

/**
 * Output of the concept generator. Feeds into the storyboard generator
 * (animated-storyboard.ts) and the Seedance scene renderer (Round 6).
 */
export interface AnimatedConceptPackage {
  title: string;
  angle: string;
  hook: string;
  script: string;
  durationSeconds: number;
  scenes: StoryboardScene[];
  voSegmentsByScene: string[];
  styleNotes: string;
  durationValid: boolean;
}

export interface GenerateAnimatedConceptOptions {
  config: GeneratorConfig;
  product: Pick<Product, 'title' | 'description' | 'image_url'>;
  inspirationHooks?: string[];
  /** When 'service', baseInstructions are replaced with the 3PL/service-business
   *  framing. Animation style guidance and output JSON schema are unchanged.
   *  Default 'product' preserves existing behavior. */
  contentMode?: 'product' | 'service';
}

/**
 * Service-business (3PL) framing — replaces the DTC-product baseInstructions
 * when contentMode === 'service'. Audience, visual vocabulary, hook templates,
 * and ShipSourced facts are baked in. Animation style guidance + output JSON
 * schema are appended after this prompt by buildSystemPrompt, so structural
 * scene-decomposition rules carry over unchanged.
 */
const SERVICE_BUSINESS_BASE_INSTRUCTIONS = `You are creating an ad for a 3PL fulfillment service, NOT a physical product.

The "product" you are given describes a SERVICE: warehousing, pick/pack, shipping, fulfillment software. There is no physical good for the customer to receive — the value delivered is operational relief and growth enablement.

Audience: e-commerce founders and ops leads at brands shipping 100-10,000 orders/month. They are scrolling Meta/IG/TikTok between operational fires. They have one of these problems right now:
  - Their current 3PL is hiding fees / surprising them with bills
  - They are stuck in sales-call hell trying to evaluate alternatives
  - Their orders are shipping late, customers are complaining
  - They are outgrowing self-fulfillment (garage / spare bedroom / one warehouse worker)

Visual vocabulary you SHOULD use:
  - Warehouses (clean, modern, organized — NOT cluttered/dirty)
  - Branded boxes being packed
  - Conveyor belts, scanners, label printers in motion
  - Shipping labels with familiar carriers (USPS / UPS / FedEx)
  - Mobile or laptop dashboards showing order numbers, stats, charts
  - Founder/operator faces (focused, mid-30s to 40s, casual but professional)
  - Metaphor visuals: chaos -> order, multiple-tabs -> one-dashboard, hidden-fees-paper -> clear-numbers

Visual vocabulary you MUST AVOID:
  - "Product" beauty shots (there is no product)
  - Lifestyle-consumer scenes (the audience is operators, not consumers)
  - Generic stock-photo "business handshake" or "team in suits" cliches
  - Anything that requires depicting customers receiving packages (irrelevant to the actual buyer, who is the brand owner not their customer)

Hook directions (rotate / pick strongest for the brief):
  - PAIN: "Your 3PL is bleeding you with fees they didn't tell you about."
  - PAIN: "You shouldn't need a sales call to find out shipping prices."
  - ASPIRATION: "Scale to 1,000 orders/day without hiring another warehouse."
  - COMPARISON: "Why brands are leaving ShipBob / ShipHero for transparent pricing."
  - TRUST: "$150 onboarding. Same-day shipping. One dashboard. No commitment."

Concrete ShipSourced facts you can reference (these are verified from the brand's own marketing):
  - One-time $150 onboarding fee
  - Same-day shipping with tracking
  - Single client dashboard for orders / inventory / performance
  - Multi-store consolidation (no tab-switching)
  - Discounted shipping rates
  - No setup fees, no long-term commitment
  - Instant transparent pricing without sales calls

Compliance / claim guard:
  - Do NOT promise specific cost savings percentages (e.g. "save 40% on shipping") unless the user provides them in the brief. Vague claims like "discounted rates" are fine; specific percentages require user-provided substantiation.
  - Do NOT mention competitors by name unless the comparison is factually defensible (e.g. ShipSourced has feature X that competitor lacks). Generic comparisons like "compared to traditional 3PLs" are fine.

Logo handling: the user will upload the ShipSourced logo (or another 3PL's logo). Treat it as the brand mark — show it prominently in the final scene (ideally as a CTA card or brand reveal at the end), and as subtle inclusion on dashboards / packing labels / warehouse signage in middle scenes.

Structural scene-decomposition rules still apply:
  - The first 2 seconds must hook the viewer. Cold open with a problem, surprising claim, or visual pattern interrupt.
  - Each scene's visualDescription is a single concrete visual moment, 1-2 sentences max.
  - voSegment is 8-12 words per scene, filling 4s at natural conversational pace.
  - Each scene's duration MUST be exactly 4 seconds.
  - The CTA goes in the last scene's voSegment.`;

function buildSystemPrompt(style: AnimationStyle, contentMode: 'product' | 'service' = 'product'): string {
  const styleDef = STYLE_DEFINITIONS[style];

  const productInstructions = `You are an expert performance ad creative director specializing in animated video ads for DTC brands on Meta and TikTok.

Your job is to produce a structured concept for a short animated ad (8-30 seconds) that will scale on paid social. The output must be valid JSON matching the schema provided.

Critical rules:
1. The first 2 seconds must hook the viewer. Cold open with a problem, surprising claim, or visual pattern interrupt.
2. Each scene's visualDescription should be a single concrete visual moment, not a paragraph. Aim for 1-2 sentences max.
3. The voSegment for each scene should be 8-12 words. Each scene is exactly 4 seconds, and the VO should fill that time at natural conversational pace (roughly 2-3 words per second). Avoid 1-3 word fragments — they leave dead air. Aim for complete thoughts that flow into the next scene.
4. Each scene's duration MUST be exactly 4 seconds. Total durationSeconds equals scene count × 4.
5. Do NOT mention the brand name in the visual description repeatedly — the product is shown via reference image, the script does the brand naming.
6. The CTA goes in the last scene's voSegment.
7. Avoid generic "AI ad" phrases like "transform your skin", "say goodbye to", "introducing the future of". Write like a human script doctor.`;

  const baseInstructions = contentMode === 'service' ? SERVICE_BUSINESS_BASE_INSTRUCTIONS : productInstructions;

  const styleSpecific = `

ANIMATION STYLE: ${styleDef.label}
${styleDef.description}

Write the visualDescription for each scene assuming this style. ${styleDef.requiresCharacterConsistency ? 'A consistent character will appear across scenes — describe the character once in scene 1 and refer back to "the same character" in subsequent scenes.' : 'No characters are needed; focus visualDescription on product, environment, and effects.'}`;

  const outputSchema = `

Return ONLY valid JSON in this exact shape:
{
  "title": "internal label, 3-6 words",
  "angle": "the core angle in one sentence",
  "hook": "first 2 seconds as text — what the viewer sees and hears immediately",
  "script": "full VO script as continuous prose, 1-2 sentences per scene",
  "durationSeconds": 16,
  "scenes": [
    {
      "sceneIndex": 0,
      "duration": 4,
      "visualDescription": "1-2 sentences of what is on screen",
      "cameraDirection": "optional camera move e.g. slow zoom in, static medium shot"
    }
  ],
  "voSegmentsByScene": ["scene 0 VO line", "scene 1 VO line"]
}

scenes.length MUST equal voSegmentsByScene.length. The two arrays are parallel.`;

  return baseInstructions + styleSpecific + outputSchema;
}

function buildUserPrompt(opts: GenerateAnimatedConceptOptions): string {
  const { config, product, inspirationHooks } = opts;
  const sceneCount = config.storyboardSceneCount || getDefaultSceneCount(config.animationStyle!);
  const duration = config.videoDuration || 15;

  const parts: string[] = [];
  parts.push(`PRODUCT: ${product.title}`);
  if (product.description) {
    parts.push(`DESCRIPTION: ${product.description.slice(0, 500)}`);
  }
  parts.push(`DURATION: ${duration} seconds`);
  parts.push(`SCENE COUNT: ${sceneCount} scenes`);
  if (config.creativeType) {
    parts.push(`CREATIVE TYPE: ${config.creativeType.replace(/_/g, ' ')}`);
  }
  if (config.hookStyle) {
    parts.push(`HOOK STYLE: ${config.hookStyle.replace(/_/g, ' ')}`);
  }
  if (config.funnelStage) {
    const stageMap: Record<string, string> = {
      tof: 'top of funnel — awareness, broad appeal',
      mof: 'middle of funnel — proof, education',
      bof: 'bottom of funnel — urgency, direct CTA, offer-driven',
    };
    parts.push(`FUNNEL STAGE: ${stageMap[config.funnelStage] || config.funnelStage}`);
  }
  if (config.offer) {
    parts.push(`OFFER: ${config.offer}`);
  }
  if (config.platformTarget) {
    parts.push(`PLATFORM: ${config.platformTarget}`);
  }
  if (inspirationHooks && inspirationHooks.length > 0) {
    parts.push(`HIGH-PERFORMING HOOKS FROM PRIOR ADS (use as inspiration, do not copy):
${inspirationHooks.slice(0, 5).map(h => `- ${h}`).join('\n')}`);
  }

  parts.push(`\nGenerate the animated ad concept as JSON.`);
  return parts.join('\n\n');
}

function validateAndNormalize(
  raw: any,
  _expectedDuration: number,    // unused — scenes are hardcoded to 4s
  _expectedSceneCount: number,  // unused — sceneCount comes from raw.scenes.length
): AnimatedConceptPackage {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Concept generator returned non-object');
  }
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    throw new Error('Concept generator returned no scenes');
  }
  if (!Array.isArray(raw.voSegmentsByScene)) {
    throw new Error('Concept generator missing voSegmentsByScene array');
  }
  if (raw.scenes.length !== raw.voSegmentsByScene.length) {
    throw new Error(
      `Concept scenes (${raw.scenes.length}) and voSegments (${raw.voSegmentsByScene.length}) length mismatch`,
    );
  }

  // Animated scenes are always 4 seconds — Seedance I2V default and the duration
  // the system prompt enforces. Ignore whatever value the LLM returned for s.duration.
  const scenes: StoryboardScene[] = raw.scenes.map((s: any, idx: number) => ({
    sceneIndex: typeof s.sceneIndex === 'number' ? s.sceneIndex : idx,
    duration: 4, // Hardcoded — animated scenes are always 4 seconds (Seedance I2V default)
    visualDescription: String(s.visualDescription || '').trim(),
    cameraDirection: s.cameraDirection ? String(s.cameraDirection).trim() : undefined,
  }));

  return {
    title: String(raw.title || 'Animated Ad').trim(),
    angle: String(raw.angle || '').trim(),
    hook: String(raw.hook || '').trim(),
    script: String(raw.script || '').trim(),
    durationSeconds: scenes.length * 4,
    scenes,
    voSegmentsByScene: raw.voSegmentsByScene.map((v: any) => String(v || '').trim()),
    styleNotes: '',
    durationValid: true, // Always true — math is now deterministic (sceneCount × 4)
  };
}

export async function generateAnimatedConcept(
  opts: GenerateAnimatedConceptOptions,
): Promise<AnimatedConceptPackage> {
  const style = opts.config.animationStyle;
  if (!style) {
    throw new Error('generateAnimatedConcept: config.animationStyle is required');
  }

  const expectedDuration = opts.config.videoDuration || 15;
  const expectedSceneCount =
    opts.config.storyboardSceneCount || getDefaultSceneCount(style);

  const systemPrompt = buildSystemPrompt(style, opts.contentMode);
  const userPrompt = buildUserPrompt(opts);

  const rawText = await generateText(systemPrompt, userPrompt, {
    maxTokens: 2000,
    temperature: 0.8,
  });

  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Concept generator returned non-JSON: ${(err as Error).message}\nRaw response (first 500 chars): ${cleaned.slice(0, 500)}`,
    );
  }

  const concept = validateAndNormalize(parsed, expectedDuration, expectedSceneCount);
  concept.styleNotes = STYLE_DEFINITIONS[style].visualStyleGuide;

  return concept;
}
