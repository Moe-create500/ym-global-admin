/**
 * Static Ad Generator — Prompt builders, types, and text rule constants.
 * No magic strings. Every prompt pattern lives here.
 */

import type { ChatMessage } from './openai-chat';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AudienceProfile {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  pain_points: string[];
  desires: string[];
  objections: string[];
  mindset: string | null;
  failed_solutions: string[];
  demographics: string | null;
}

export interface TemplateZone {
  id: string;
  type: 'text' | 'image' | 'badge';
  label: string;
  position: string; // e.g. "top-left", "center", "bottom-bar"
  maxChars?: number;
  rules?: string;
}

export interface ImageTemplate {
  id: string;
  name: string;
  description: string | null;
  aspect_ratio: string;
  style: string;
  zones: TemplateZone[];
  reference_description: string;
}

export interface ProductContext {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  images: string[];
}

export interface GeneratedCopy {
  [zoneId: string]: string;
}

// ─── Text Rules ──────────────────────────────────────────────────────────────

export const BANNED_BROAD_WORDS = [
  'weight loss', 'healthy', 'natural', 'organic', 'best', 'amazing',
  'revolutionary', 'breakthrough', 'miracle', 'transform', 'guaranteed',
  'proven', 'scientifically', 'clinically', 'doctor recommended',
  'life-changing', 'game-changer', 'ultimate', 'perfect', 'incredible',
] as const;

export const TEXT_RULE_PRESETS: Record<string, string> = {
  'desire-specific': 'Say the desire directly — not "weight loss" but "fit in the dress you always wanted to wear"',
  'pain-specific': 'Name the exact pain — not "hair problems" but "watching your edges thin out every morning"',
  'scroll-stop': 'First line must make them stop scrolling — use pattern interrupts, unexpected statements, or direct callouts',
  'clickbait-subtle': 'Create curiosity without being obvious clickbait — make them NEED to know more',
  'no-broad-words': `Never use these words: ${BANNED_BROAD_WORDS.join(', ')}`,
  'social-proof': 'Include a believable number or social proof element — "47,000 women switched this month"',
  'urgency': 'Create urgency without fake scarcity — time-based or supply-based',
};

export const DEFAULT_TEXT_RULES = [
  'desire-specific',
  'pain-specific',
  'scroll-stop',
  'clickbait-subtle',
  'no-broad-words',
] as const;

// ─── Prompt Builders ─────────────────────────────────────────────────────────

export function buildCopyPrompt(params: {
  product: ProductContext;
  audience: AudienceProfile;
  template: ImageTemplate;
  textRules: string[];
  variationCount: number;
}): ChatMessage[] {
  const { product, audience, template, textRules, variationCount } = params;

  const rulesText = textRules
    .map(r => TEXT_RULE_PRESETS[r] || r)
    .map((r, i) => `${i + 1}. ${r}`)
    .join('\n');

  const zonesSpec = template.zones
    .filter(z => z.type === 'text')
    .map(z => `- "${z.id}" (${z.label}): max ${z.maxChars || 50} characters. ${z.rules || ''}`)
    .join('\n');

  const system: ChatMessage = {
    role: 'system',
    content: `You are an elite direct-response copywriter specializing in bottom-of-funnel e-commerce ads. You write ad copy that makes people stop scrolling and buy immediately.

Your copy is NEVER generic. You speak to a SPECIFIC person with SPECIFIC pain points. You name their exact frustrations, desires, and failed attempts. You make them feel seen.

You follow these text rules with zero exceptions:
${rulesText}

Respond with valid JSON only. No markdown, no explanation.`,
  };

  const userContent: string = `Write ${variationCount} copy variation(s) for a static image ad.

PRODUCT:
- Name: ${product.title}
- Price: $${(product.price_cents / 100).toFixed(2)}
- Description: ${product.description || 'N/A'}

TARGET AUDIENCE — "${audience.name}":
- Pain points: ${audience.pain_points.join(', ')}
- Desires: ${audience.desires.join(', ')}
- What they've tried and failed: ${audience.failed_solutions.join(', ')}
- Objections: ${audience.objections.join(', ')}
- What they're thinking: ${audience.mindset || 'N/A'}
- Demographics: ${audience.demographics || 'N/A'}

TEMPLATE ZONES (fill each zone):
${zonesSpec}

Return JSON:
{
  "variations": [
    {
      ${template.zones.filter(z => z.type === 'text').map(z => `"${z.id}": "copy for this zone"`).join(',\n      ')}
    }
  ]
}

Each variation must feel completely different — different angles, different hooks, different emotional triggers. Make them scroll-stopping.`;

  const user: ChatMessage = { role: 'user', content: userContent };

  return [system, user];
}

export function buildImagePrompt(params: {
  product: ProductContext;
  audience: AudienceProfile;
  template: ImageTemplate;
  copy: GeneratedCopy;
}): string {
  const { product, audience, template, copy } = params;

  const textOverlays = template.zones
    .filter(z => z.type === 'text' && copy[z.id])
    .map(z => `- ${z.label} (${z.position}): "${copy[z.id]}"`)
    .join('\n');

  const badgeZones = template.zones
    .filter(z => z.type === 'badge')
    .map(z => `- ${z.label} (${z.position})`)
    .join('\n');

  // Build text overlay list from either structured zones or raw copy keys
  let copyText = '';
  if (textOverlays) {
    copyText = textOverlays;
  } else {
    // No zones defined — use copy keys directly
    copyText = Object.entries(copy)
      .map(([key, val]) => `- ${key}: "${val}"`)
      .join('\n');
  }

  // Creative angles from audience if available
  const creativeAngles = (audience as any).creative_angles;
  let anglesText = '';
  try {
    const parsed = typeof creativeAngles === 'string' ? JSON.parse(creativeAngles) : creativeAngles;
    if (Array.isArray(parsed) && parsed.length > 0) anglesText = parsed.join(', ');
  } catch {}

  return `TASK: Create a paid Facebook/Instagram static ad image.

You have two reference images. Here is exactly what each one is and what to do with it:

IMAGE 1 — LAYOUT BLUEPRINT
This is an ad template. It is a STRUCTURAL GUIDE — not a finished ad. Think of it as an architect's floor plan. Your job is to build the real building from this blueprint.

Before generating anything, analyze Image 1 and identify:
1. THE FORMAT — Is this a phone mockup? A social media post screenshot? A split-screen comparison? A checklist? A product spotlight with benefit callouts? A review/testimonial card? A "us vs them" layout? Identify the exact format and replicate it.
2. THE GRID — How many columns? Where is the product zone? Where are the text zones? Is text on the left with product on the right? Is there a top headline bar and bottom CTA bar? Map every zone.
3. THE UI ELEMENTS — Does it have a phone frame? Instagram like/comment/share icons? Star ratings? Check/X icons? Toggle switches? Callout arrows pointing to the product? Profile pictures? Badge bars? Identify every UI element and include it in your output.
4. THE VISUAL WEIGHT — What's the biggest element? Usually the headline or product. Match that hierarchy.

IMAGE 2 — THE REAL PRODUCT
This is the actual product: ${product.title}. This exact product — same bottles, same labels, same packaging, same colors — must appear in your output wherever the template has a product placeholder.

WHAT TO THROW AWAY FROM THE TEMPLATE:
The template contains things that are NOT part of the real design. You must identify and replace them:
- GREEN HILLS / CLOUDS / LANDSCAPE ILLUSTRATIONS = These are Canva's default "image placeholder." They mean "put a real image here." Replace with: the real product photo, or a realistic lifestyle photo of the target audience, or a clean solid/gradient background.
- WHITE BLANK POUCHES / BOTTLES / GENERIC PACKAGING = Product placeholders. Replace with the real product from Image 2.
- ANY TEXT THAT READS LIKE A TEMPLATE: "Hook text here," "Benefit 1," "Benefit 2," "xxxx Verified Reviews," "Add a tagline here," "Your social media name," "@yoursocialhandle," "Reviewer's name," "Review here," "Add a sentence that describes your product," "Problem solved number 1," "Negative 1," "Positive 1," "Ingredient 1 Benefit," "Adjective 1 and Adjective 2," "Click below to find out more," "Product benefit 1," "Short tagline or product description," "Limited stock available," "How 2024 started / How 2024 is going," "me realising I need this product." ALL of this is placeholder. Remove every word of it.

WHO IS THIS AD FOR:
Name: ${audience.name}
She is dealing with: ${audience.pain_points.join('. ')}
She wants: ${audience.desires.join('. ')}
She already tried and it failed: ${audience.failed_solutions.join(', ')}
What is going through her mind right now: "${audience.mindset || 'She needs this to work.'}"
${anglesText ? `Creative angles that convert for her: ${anglesText}` : ''}

THE COPY — YOU WRITE IT:
You are a direct-response copywriter writing for this specific woman. Not a general audience. HER.

Rules for every word you put on this image:
1. HEADLINE (biggest text): Name her exact situation or desire. Not "Stronger Hair" — instead "The hair length I prayed for since going natural." Not "Weight Loss Solution" — instead "Fit in the dress you wore before the baby." Make her feel SEEN.
2. BENEFITS/BULLETS: Short. 3-6 words each. Specific outcomes, not features. Not "Contains Biotin" — instead "Edges visibly thicker in 4 weeks."
3. CTA: Urgent but not fake. "Shop the Bundle" / "Try It Today" / "Claim Yours." Never "Learn More."
4. SOCIAL PROOF (if template has stars/reviews): Use a realistic review. Real name, 5 stars, 1-2 sentence testimonial that sounds like a real customer, not marketing copy.
5. BANNED WORDS — never use: healthy, natural, organic, best, amazing, revolutionary, breakthrough, miracle, transform, guaranteed, proven, scientifically, clinically, life-changing, game-changer, ultimate, perfect, incredible.

VISUAL EXECUTION:
- Style: Photorealistic. Premium. This is a real ad that a brand paid a designer $500 to make. It must look like that.
- Background: Solid color, subtle gradient, or lifestyle photography. NEVER cartoons, illustrations, or clip art.
- Typography: Clean, modern sans-serif. Bold headlines, lighter body text. High contrast against background so every word is readable.
- Color palette: Derive from the template's color scheme. If template is dark/moody, stay dark. If bright/clean, stay bright.
- Product: Hero element. Prominent. Well-lit. Exactly as shown in Image 2.

PRIORITY ORDER (when constraints conflict):
1. Layout structure matches the template
2. Real product from Image 2 is used faithfully
3. All placeholder content is removed
4. Copy speaks to the specific audience
5. Premium visual quality

TEMPLATE: "${template.name}"
LAYOUT: ${template.reference_description}`;
}

// ─── Default Templates ───────────────────────────────────────────────────────

export const SEED_TEMPLATES: Omit<ImageTemplate, 'id'>[] = [
  {
    name: 'Product Spotlight',
    description: 'Clean layout with product center stage, headline top, benefits bottom',
    aspect_ratio: '1:1',
    style: 'Dark premium background with gold/warm accents, luxury feel',
    zones: [
      { id: 'headline', type: 'text', label: 'Main Headline', position: 'top-center', maxChars: 60, rules: 'Bold, scroll-stopping hook' },
      { id: 'subtext', type: 'text', label: 'Supporting Text', position: 'middle-left', maxChars: 100, rules: 'Expand on the hook, build desire' },
      { id: 'product', type: 'image', label: 'Product Image', position: 'center-right' },
      { id: 'cta', type: 'text', label: 'Call to Action', position: 'bottom-center', maxChars: 30, rules: 'Clear, urgent action' },
      { id: 'badges', type: 'badge', label: 'Trust Badges', position: 'bottom-bar' },
    ],
    reference_description: 'Product bottles/packaging displayed prominently in the center-right. Bold headline text at the top. Supporting copy with bullet-style benefits on the left side. CTA button at bottom. Trust badge bar (clean ingredients, science backed, etc.) at the very bottom.',
  },
  {
    name: 'Bold Headline Hero',
    description: 'Massive headline dominates, product and social proof support it',
    aspect_ratio: '4:5',
    style: 'Gradient background (dark to light), bold typography, high contrast',
    zones: [
      { id: 'headline', type: 'text', label: 'Hero Headline', position: 'top-left', maxChars: 40, rules: 'Massive, bold, desire-driven — the first thing they see' },
      { id: 'subtext', type: 'text', label: 'Body Copy', position: 'middle-left', maxChars: 120, rules: 'Pain-aware, empathetic, leads to product as the answer' },
      { id: 'product', type: 'image', label: 'Product Image', position: 'center-right' },
      { id: 'cta', type: 'text', label: 'CTA', position: 'bottom-center', maxChars: 25 },
      { id: 'badges', type: 'badge', label: 'Trust Badges', position: 'bottom-bar' },
    ],
    reference_description: 'Tall 4:5 format. Giant bold headline taking up the top-left third. Body copy below headline on the left. Product image on the right side, vertically centered. CTA button at bottom. Trust badges in a horizontal bar at the very bottom.',
  },
  {
    name: 'Benefits Breakdown',
    description: 'Three key benefits with icons, product image, clean layout',
    aspect_ratio: '1:1',
    style: 'Clean white/light background, professional, trustworthy, blue or green accents',
    zones: [
      { id: 'headline', type: 'text', label: 'Headline', position: 'top-center', maxChars: 50, rules: 'Clear value proposition' },
      { id: 'benefit1', type: 'text', label: 'Benefit 1', position: 'left-top', maxChars: 40, rules: 'Specific benefit with icon' },
      { id: 'benefit2', type: 'text', label: 'Benefit 2', position: 'left-middle', maxChars: 40, rules: 'Specific benefit with icon' },
      { id: 'benefit3', type: 'text', label: 'Benefit 3', position: 'left-bottom', maxChars: 40, rules: 'Specific benefit with icon' },
      { id: 'product', type: 'image', label: 'Product Image', position: 'center-right' },
      { id: 'cta', type: 'text', label: 'CTA', position: 'bottom-center', maxChars: 30 },
    ],
    reference_description: 'Square format. Headline at top. Three benefits listed vertically on the left with small icons. Product image large on the right side. CTA at bottom. Clean, professional look.',
  },
  {
    name: 'Sale / Discount',
    description: 'Bold discount percentage, urgency-driven, product front and center',
    aspect_ratio: '1:1',
    style: 'High energy — red, bold, urgent. Big discount numbers. White or light background with red accents',
    zones: [
      { id: 'discount', type: 'text', label: 'Discount Text', position: 'top-center', maxChars: 25, rules: 'Big bold number — e.g. "50% OFF" or "SAVE $30"' },
      { id: 'headline', type: 'text', label: 'Headline', position: 'middle-top', maxChars: 40, rules: 'What the sale is for' },
      { id: 'product', type: 'image', label: 'Product Image', position: 'center' },
      { id: 'cta', type: 'text', label: 'CTA', position: 'bottom-center', maxChars: 30, rules: 'Urgent — "Shop Now", "Grab Yours"' },
    ],
    reference_description: 'Square format. Giant discount number/percentage at the top in bold red. Product image centered and prominent. Headline above or below product. CTA button at bottom. Feels urgent and exciting.',
  },
  {
    name: 'Story / Reel Format',
    description: 'Vertical 9:16 for Stories and Reels, text top and bottom, product center',
    aspect_ratio: '9:16',
    style: 'Full-bleed imagery, cinematic, text overlays with semi-transparent backgrounds for readability',
    zones: [
      { id: 'hook', type: 'text', label: 'Hook Text', position: 'top-center', maxChars: 50, rules: 'Pattern interrupt — makes them stop tapping through stories' },
      { id: 'product', type: 'image', label: 'Product Image', position: 'center' },
      { id: 'subtext', type: 'text', label: 'Supporting Text', position: 'below-center', maxChars: 80, rules: 'Builds on the hook, creates desire' },
      { id: 'cta', type: 'text', label: 'CTA', position: 'bottom-center', maxChars: 25, rules: 'Swipe up / Shop now energy' },
    ],
    reference_description: 'Vertical 9:16 story format. Hook text at the very top with a semi-transparent dark background strip for readability. Product image large in the center. Supporting text below the product. CTA at the bottom. Cinematic, scroll-stopping feel.',
  },
];
