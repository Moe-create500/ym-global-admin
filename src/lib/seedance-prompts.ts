/**
 * Seedance 2.0 Cinematic Prompt Engineering
 *
 * Based on the Higgsfield Seedance 2.0 skills framework.
 * Transforms simple product descriptions into cinematic video prompts
 * with camera specs, lighting physics, and hook patterns.
 *
 * Used when engine = 'seedance' to upgrade prompt quality from
 * generic descriptions to production-grade video prompts.
 */

// ═══ Hook Patterns ═══

const HOOK_PATTERNS = [
  { key: 'product_drop', label: 'Product Drop', prompt: 'Dark minimal background. Product descends into frame with motion blur and dramatic lighting shift. Catches light mid-drop. Premium feel.' },
  { key: 'texture_asmr', label: 'Texture Close-Up', prompt: 'Extreme macro close-up of product surface texture. Fingers slowly interact with the product. Satisfying tactile detail. ASMR visual style.' },
  { key: 'before_after', label: 'Before/After', prompt: 'Quick transition showing problem state then solved state. Split-screen or rapid cut. Instantly communicates the benefit.' },
  { key: 'direct_address', label: 'Direct Address', prompt: 'Person looks directly at camera with genuine reaction. Hand gesture toward camera. Breaks fourth wall. Feels personal and urgent.' },
  { key: 'unboxing', label: 'Unboxing Reveal', prompt: 'Hands carefully open premium packaging. Product emerges into light. Satisfying ASMR-style unboxing. Shows quality through presentation.' },
  { key: 'ingredient_burst', label: 'Ingredient Burst', prompt: 'Key ingredients visually burst outward from the product center. Dynamic, energetic, colorful. Communicates natural or premium ingredients.' },
  { key: 'in_hand', label: 'In-Hand Demo', prompt: 'Hands holding product naturally, demonstrating key feature within 2 seconds. Shows scale, texture, and immediate use context.' },
  { key: 'lifestyle_flash', label: 'Lifestyle Flash', prompt: 'Quick cut to aspirational lifestyle scene with product naturally integrated. Sells the feeling, not just the product.' },
  { key: 'creator_reaction', label: 'Creator Reaction', prompt: 'Person unboxes or tries product for first time. Eyes light up with genuine surprised delight. Authentic emotional response.' },
  { key: 'scarcity', label: 'Scarcity Signal', prompt: 'Product with glowing text overlay suggesting limited availability. FOMO-driven visual urgency.' },
];

// ═══ Product Category Configs ═══

interface CategoryConfig {
  keyVisuals: string;
  hookRecommendation: string;
  lifestyleContext: string;
  cameraStyle: string;
  lightingStyle: string;
  colorGrade: string;
}

const CATEGORY_CONFIGS: Record<string, CategoryConfig> = {
  'beauty': {
    keyVisuals: 'Close-up of product bottle with light refracting through liquid. Ingredient macro shots with shimmer. Before/after skin texture. Application demonstration with smooth blending. Skin glow enhancement.',
    hookRecommendation: 'texture_asmr',
    lifestyleContext: 'Morning skincare ritual. Bathroom vanity with natural light. Dewy, glowing skin close-up. Confident, radiant expression.',
    cameraStyle: 'Slow dolly push-in on product. Macro lens for texture. Smooth rack focus from product to face.',
    lightingStyle: 'Soft diffused window light. Warm golden hour glow on skin. Clean white studio for product isolation.',
    colorGrade: 'Warm, luminous, golden highlights with clean skin tones. Soft contrast.',
  },
  'health': {
    keyVisuals: 'Product in hand showing label clearly. Capsules or contents visible. Natural ingredients visual. Person taking the product. Before/after wellness transformation.',
    hookRecommendation: 'before_after',
    lifestyleContext: 'Morning wellness routine. Kitchen counter with healthy foods. Active lifestyle montage. Peaceful meditation moment.',
    cameraStyle: 'Steady medium shot for authenticity. Close-up on product details. Slow pan across ingredients.',
    lightingStyle: 'Clean, bright, natural daylight. Warm and inviting. Healthy glow.',
    colorGrade: 'Clean, natural, slightly warm. Greens and earth tones. Fresh and organic feeling.',
  },
  'food': {
    keyVisuals: 'Ingredient showcase with macro detail. Pouring, steaming, sizzling action. Finished product with appealing presentation. Consumption moment with satisfaction.',
    hookRecommendation: 'texture_asmr',
    lifestyleContext: 'Morning breakfast scene. Kitchen with natural light. Social gathering. Indulgent moment.',
    cameraStyle: 'Top-down for plating. Slow motion pour. Macro for texture. Orbit around dish.',
    lightingStyle: 'Warm tungsten lighting. Steam catching backlight. Natural daylight from window.',
    colorGrade: 'Warm, rich, saturated colors. Golden tones. Appetite-inducing palette.',
  },
  'default': {
    keyVisuals: 'Product hero shot with clean background. Multiple angle showcase. Detail close-ups. In-context usage scene.',
    hookRecommendation: 'product_drop',
    lifestyleContext: 'Person using product in natural setting. Aspirational environment. Genuine satisfaction moment.',
    cameraStyle: 'Smooth 360 rotation. Push-in for detail. Pull-back for context. Dolly movement.',
    lightingStyle: 'Clean studio key light for product. Natural light for lifestyle. Dramatic rim lighting for premium feel.',
    colorGrade: 'Clean, modern, slightly desaturated with selective color pops on the product.',
  },
};

// ═══ Ad Structure Templates ═══

const AD_STRUCTURES = {
  'hook_showcase_benefit_cta': {
    label: 'Hook → Showcase → Benefit → CTA',
    timing: '0-2s: Hook | 2-8s: Product showcase | 8-12s: Lifestyle/benefit | 12-15s: CTA',
  },
  'before_after_sandwich': {
    label: 'Before/After Sandwich',
    timing: '0-3s: Before (problem) | 3-9s: Product showcase | 9-12s: After (solution) + CTA',
  },
  'unboxing_journey': {
    label: 'Unboxing Journey',
    timing: '0-2s: Package reveal | 2-5s: Opening | 5-12s: Product + rotation | 12-15s: CTA',
  },
  'testimonial_embed': {
    label: 'Testimonial Embed',
    timing: '0-1s: Hook | 1-8s: Product showcase | 8-13s: Reaction moment | 13-15s: CTA',
  },
};

// ═══ Main Prompt Builder ═══

export interface SeedancePromptOptions {
  productName: string;
  productDescription?: string;
  productCategory?: string;
  duration: number;
  aspectRatio: string;
  hookStyle?: string;
  funnelStage?: string;
  conceptAngle?: string;
  beliefs?: string[];
  uniqueMechanism?: string;
}

/**
 * Build a cinematic Seedance 2.0 prompt from product info.
 * Transforms a simple product description into a multi-paragraph
 * prompt with camera specs, lighting notes, and hook patterns.
 */
export function buildSeedancePrompt(opts: SeedancePromptOptions): string {
  const {
    productName, productDescription, productCategory,
    duration, aspectRatio, hookStyle, funnelStage,
    conceptAngle, beliefs, uniqueMechanism,
  } = opts;

  // Detect category
  const catKey = detectCategory(productName, productDescription || '', productCategory || '');
  const cat = CATEGORY_CONFIGS[catKey] || CATEGORY_CONFIGS['default'];

  // Pick hook pattern
  const hookKey = hookStyle || cat.hookRecommendation;
  const hook = HOOK_PATTERNS.find(h => h.key === hookKey) || HOOK_PATTERNS[0];

  // Pick ad structure based on funnel stage
  const structure = funnelStage === 'bof' ? AD_STRUCTURES['testimonial_embed']
    : funnelStage === 'mof' ? AD_STRUCTURES['before_after_sandwich']
    : AD_STRUCTURES['hook_showcase_benefit_cta'];

  // Build the cinematic prompt
  const parts: string[] = [];

  // Header
  parts.push(`Generate a ${duration}-second e-commerce product advertisement video for "${productName}".`);
  parts.push(`Target: direct-response Meta/TikTok ad. Aspect ratio: ${aspectRatio}. Optimized for scroll-stopping.`);
  parts.push('');

  // Concept angle
  if (conceptAngle) {
    parts.push(`CREATIVE ANGLE: ${conceptAngle}`);
    parts.push('');
  }

  // Beliefs / unique mechanism
  if (uniqueMechanism) {
    parts.push(`UNIQUE SELLING POINT: ${uniqueMechanism}`);
  }
  if (beliefs && beliefs.length > 0) {
    parts.push(`KEY BELIEF TO INSTALL: "${beliefs[0]}"`);
  }
  parts.push('');

  // Ad structure with timing
  parts.push(`AD STRUCTURE: ${structure.label}`);
  parts.push(`TIMING: ${structure.timing}`);
  parts.push('');

  // Hook (first 2 seconds)
  parts.push(`2-SECOND HOOK (${hook.label}):`);
  parts.push(hook.prompt);
  parts.push('');

  // Product showcase
  parts.push(`PRODUCT SHOWCASE:`);
  parts.push(cat.keyVisuals);
  if (productDescription) {
    parts.push(`Product details: ${productDescription.substring(0, 200)}`);
  }
  parts.push('');

  // Lifestyle / benefit
  parts.push(`LIFESTYLE CONTEXT:`);
  parts.push(cat.lifestyleContext);
  parts.push('');

  // Camera and lighting specs
  parts.push(`CAMERA: ${cat.cameraStyle}`);
  parts.push(`LIGHTING: ${cat.lightingStyle}`);
  parts.push(`COLOR GRADE: ${cat.colorGrade}`);
  parts.push('');

  // CTA direction
  if (funnelStage === 'bof') {
    parts.push('CTA: Urgency-driven. "Shop Now" with scarcity element. Direct-to-purchase energy.');
  } else if (funnelStage === 'mof') {
    parts.push('CTA: Trust-building. Social proof moment. "See why thousands switched." Education-to-action.');
  } else {
    parts.push('CTA: Curiosity-driven. "Discover why this is different." Soft but compelling.');
  }

  // Technical specs
  parts.push('');
  parts.push('TECHNICAL: Photorealistic rendering. No CGI artifacts. Smooth camera transitions. Mobile-optimized framing (subject fills 70% of frame). NATURAL conversational pacing — people speak at normal real-life speed, NOT slow motion. Energy should feel like a real TikTok/Reel, not a meditation video.');

  return parts.join('\n');
}

/**
 * Detect product category from name and description.
 */
function detectCategory(name: string, desc: string, category: string): string {
  const text = `${name} ${desc} ${category}`.toLowerCase();
  if (text.match(/skincare|serum|moistur|cream|balm|tallow|lotion|beauty|glow|anti-aging|face|skin/)) return 'beauty';
  if (text.match(/supplement|vitamin|magnesium|capsule|health|wellness|sleep|energy|immune|probiotic/)) return 'health';
  if (text.match(/food|coffee|chocolate|protein|snack|drink|beverage|tea|organic.*eat/)) return 'food';
  return 'default';
}

/**
 * Get available hook patterns for UI display.
 */
export function getHookPatterns() {
  return HOOK_PATTERNS.map(h => ({ key: h.key, label: h.label }));
}
