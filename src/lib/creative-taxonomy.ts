/**
 * Creative Taxonomy & Decision Engine
 *
 * Layers 1-4 of the creative generation contract.
 * Every option has an exact definition, strategy rules, and generation behavior.
 * Optimized for Meta/Facebook ads, supplements & beauty vertical.
 */

// ═══════════════════════════════════════════════════════
// LAYER 1 — CREATIVE TAXONOMY
// ═══════════════════════════════════════════════════════

export interface TaxonomyEntry {
  id: string;
  label: string;
  definition: string;
  useCase: string;
  preferWhen: string;
  avoidWhen: string;
  bestFunnelFit: string[];
  bestProductFit: string[];
  metaUseCases: string;
  outputRequirements: string;
  antiPatterns: string;
}

// ── Content Type ──

export const CONTENT_TYPES: Record<string, TaxonomyEntry> = {
  video: {
    id: 'video',
    label: 'Video',
    definition: 'Vertical video ad (9:16) optimized for Reels, Stories, and in-feed video placements on Meta.',
    useCase: 'Primary format for scroll-stopping content. Higher engagement rates, better for storytelling and demonstrations.',
    preferWhen: 'Product requires demonstration, before/after, or human connection. Account data shows video outperforms image.',
    avoidWhen: 'Quick promotion or flash sale where speed to market matters more than production quality.',
    bestFunnelFit: ['tof', 'mof', 'bof'],
    bestProductFit: ['supplements', 'skincare', 'beauty', 'wellness', 'fitness'],
    metaUseCases: 'Reels placement (highest organic reach), Stories (immersive), In-feed video (autoplay with captions).',
    outputRequirements: 'Must include: hook (0-3s), script with speaker directions, scene structure, visual direction, B-roll shots, avatar suggestion, CTA, ad copy, headline.',
    antiPatterns: 'No landscape video. No videos over 30s for TOF. No text-heavy videos without spoken audio. No robotic/AI-looking presenters.',
  },
  image: {
    id: 'image',
    label: 'Image',
    definition: 'Static image ad (1080x1080 or 1080x1350) optimized for feed and Stories placements on Meta.',
    useCase: 'Quick production, high volume testing, offer-driven campaigns, retargeting.',
    preferWhen: 'Running high-volume creative tests, simple offer communication, or retargeting with social proof.',
    avoidWhen: 'Product requires demonstration or the account data shows image underperforms video.',
    bestFunnelFit: ['mof', 'bof'],
    bestProductFit: ['supplements', 'skincare', 'beauty', 'bundles', 'flash-sales'],
    metaUseCases: 'Feed placement (1:1 or 4:5 ratio), Stories (9:16 with text overlay), Carousel (multi-image).',
    outputRequirements: 'Must include: headline (max 8 words), subheadline, concept description, visual composition spec, offer placement, CTA direction, ad copy.',
    antiPatterns: 'No more than 20% text coverage (Meta penalizes). No cluttered layouts. No stock-looking photography.',
  },
};

// ── Creative Type ──

export const CREATIVE_TYPES: Record<string, TaxonomyEntry> = {
  testimonial: {
    id: 'testimonial',
    label: 'Testimonial',
    definition: 'A real or realistic customer sharing their genuine experience with the product. First-person perspective, authentic delivery.',
    useCase: 'Social proof at scale. Most reliable format for supplements/beauty where trust is the primary conversion barrier.',
    preferWhen: 'Product has strong results story, customer base exists, trust is the bottleneck. Works at every funnel stage.',
    avoidWhen: 'Brand new product with zero social proof. Never fake testimonials — always frame as realistic creator content.',
    bestFunnelFit: ['tof', 'mof', 'bof'],
    bestProductFit: ['supplements', 'skincare', 'haircare', 'wellness', 'weight-management'],
    metaUseCases: 'Reels (native UGC feel), Feed (longer-form testimonial), Stories (quick endorsement).',
    outputRequirements: 'Script must be first-person. Include specific result claims (timeline, measurable outcome). Show product in use. End with recommendation.',
    antiPatterns: 'No scripted/corporate feel. No unsubstantiated medical claims. No perfect/polished delivery — imperfection builds trust.',
  },
  b_roll: {
    id: 'b_roll',
    label: 'B-Roll',
    definition: 'Cinematic product footage with no presenter. Aesthetic, texture-focused, sensory-driven visuals with natural product sounds or voiceover.',
    useCase: 'Brand building, product beauty shots, ingredient storytelling through visuals. Strong for premium positioning.',
    preferWhen: 'Product has strong visual appeal (textures, colors, packaging). Building brand awareness or remarketing to warm audiences.',
    avoidWhen: 'Product requires explanation or the audience needs social proof to convert. Weak for cold TOF without a hook.',
    bestFunnelFit: ['mof'],
    bestProductFit: ['skincare', 'beauty', 'premium-supplements', 'essential-oils', 'luxury-wellness'],
    metaUseCases: 'Reels (aesthetic/trending audio), Feed (brand video), Stories (product tease).',
    outputRequirements: 'Must specify 5+ specific shots with camera angles, lighting, and product interaction. Include texture/sensory details. Audio: subtle product sounds only (no music).',
    antiPatterns: 'No talking head. No text-heavy overlays. No hard-sell CTA. No generic stock footage — every shot must feature the actual product.',
  },
  product_demo: {
    id: 'product_demo',
    label: 'Product Demo',
    definition: 'Hands-on demonstration showing the product being used, opened, applied, or consumed. Focuses on the physical experience.',
    useCase: 'Converting consideration-stage audiences who need to SEE the product work before buying.',
    preferWhen: 'Product has a unique mechanism, interesting texture, satisfying application, or non-obvious usage. MOF/BOF retargeting.',
    avoidWhen: 'Product is a simple capsule/tablet with no visual demonstration value. Cold audience who does not know why they need it yet.',
    bestFunnelFit: ['mof', 'bof'],
    bestProductFit: ['skincare', 'serums', 'powders', 'topical-supplements', 'beauty-tools', 'bundles'],
    metaUseCases: 'Reels (satisfying unboxing/application), Feed (detailed walkthrough), Stories (quick demo).',
    outputRequirements: 'Must show: unboxing OR product in hand, application/usage, result/finish. Include close-up texture shots. Hands must appear natural.',
    antiPatterns: 'No just placing product on table. No skipping the actual usage moment. No unrealistic before/after in the demo itself.',
  },
  before_after: {
    id: 'before_after',
    label: 'Before / After',
    definition: 'Transformation-driven content showing a clear before state and after state. The product is positioned as the catalyst for change.',
    useCase: 'Strongest conversion format for products with visible results (skin, hair, body, energy, sleep). Proof-heavy.',
    preferWhen: 'Product has demonstrable visible or experiential results. BOF audiences who need final proof to convert.',
    avoidWhen: 'Product results are subtle or take months to appear. Never use manipulated/fake before-after imagery.',
    bestFunnelFit: ['mof', 'bof'],
    bestProductFit: ['skincare', 'haircare', 'weight-management', 'teeth-whitening', 'anti-aging', 'acne'],
    metaUseCases: 'Feed (split-screen comparison), Reels (transformation reveal), Stories (swipe before/after).',
    outputRequirements: 'Must show clear before state, usage period reference, and after state. Include timeline ("after 4 weeks"). Use same lighting/angle for both states.',
    antiPatterns: 'No manipulated images. No unrealistic timelines. No medical claims — use "supports", "helps improve appearance of". No different lighting/angles between before and after.',
  },
  problem_solution: {
    id: 'problem_solution',
    label: 'Problem → Solution',
    definition: 'Opens with an agitation of the problem/pain point, then positions the product as the solution. Classic direct-response structure.',
    useCase: 'Universal format. Works at every funnel stage. Strongest when the problem is emotionally resonant and widely experienced.',
    preferWhen: 'Product solves a specific, relatable problem. Audience is problem-aware but not yet solution-aware.',
    avoidWhen: 'Product is a general wellness supplement without a specific problem-solution fit. Avoid over-agitating sensitive health issues.',
    bestFunnelFit: ['tof', 'mof'],
    bestProductFit: ['supplements', 'pain-relief', 'sleep', 'stress', 'digestion', 'skin-concerns', 'energy'],
    metaUseCases: 'Reels (relatable problem hook → product reveal), Feed (longer problem narrative), Stories (quick problem-solution).',
    outputRequirements: 'Must open with problem agitation (first 3s). Problem must be specific and relatable. Solution reveal must feel natural, not forced. Include mechanism explanation.',
    antiPatterns: 'No fear-mongering. No medical diagnosis language. No "cures" or "treats" claims. Problem agitation must not exceed 40% of content.',
  },
  founder_story: {
    id: 'founder_story',
    label: 'Founder Story',
    definition: 'Brand origin story told by the founder or presented as the founder journey. Why this product exists, what problem it was created to solve.',
    useCase: 'Trust building and brand differentiation. Humanizes the brand. Strong for premium/mission-driven brands.',
    preferWhen: 'Brand has a compelling origin story. Founder is relatable. Product was created from personal experience with the problem.',
    avoidWhen: 'Founder story is generic ("I wanted to create a better product"). No founder available or story is not compelling.',
    bestFunnelFit: ['mof'],
    bestProductFit: ['premium-supplements', 'clean-beauty', 'mission-driven-brands', 'family-owned', 'science-backed'],
    metaUseCases: 'Reels (emotional origin moment), Feed (longer narrative), Stories (behind-the-scenes).',
    outputRequirements: 'Must include: personal problem that led to product creation, "aha moment", what makes this product different, authenticity cues. Founder or actor as founder.',
    antiPatterns: 'No generic corporate origin. No bragging about revenue/growth. No skipping the emotional "why". Must feel genuine, not scripted.',
  },
  social_proof: {
    id: 'social_proof',
    label: 'Social Proof',
    definition: 'Compilation of reviews, ratings, user-generated content, press mentions, or expert endorsements. Volume-based trust building.',
    useCase: 'Overcoming skepticism with quantity of proof. "Everyone is using this" effect. Strong for conversion.',
    preferWhen: 'Product has strong reviews, high star rating, press coverage, or large customer base. MOF/BOF retargeting.',
    avoidWhen: 'Product is brand new with no reviews. Never fabricate reviews or endorsements.',
    bestFunnelFit: ['mof', 'bof'],
    bestProductFit: ['supplements', 'skincare', 'beauty', 'wellness', 'any-product-with-reviews'],
    metaUseCases: 'Feed (review compilation), Reels (rapid-fire review montage), Stories (screenshot reviews).',
    outputRequirements: 'Must include: specific review quotes, star ratings, number of reviews/customers, variety of reviewers. Include at least 3 distinct proof points.',
    antiPatterns: 'No fake reviews. No single-source proof. No "doctor recommended" without real doctor. No unverifiable statistics.',
  },
  lifestyle: {
    id: 'lifestyle',
    label: 'Lifestyle',
    definition: 'Product integrated naturally into an aspirational but attainable daily life scene. The product is part of the lifestyle, not the hero.',
    useCase: 'Brand building and desire creation. Shows the audience who they could become. Strong for awareness and aspiration.',
    preferWhen: 'Product fits into a daily routine. Target audience aspires to a specific lifestyle. Building brand/category awareness.',
    avoidWhen: 'Audience needs education about the product first. Product is complex and requires explanation.',
    bestFunnelFit: ['tof'],
    bestProductFit: ['wellness', 'beauty', 'fitness-supplements', 'morning-routine', 'self-care', 'premium-brands'],
    metaUseCases: 'Reels (aesthetic routine), Feed (lifestyle moment), Stories (day-in-the-life).',
    outputRequirements: 'Product must appear naturally in scene (not forced). Show aspirational but believable lifestyle. Include environmental details. Minimal text overlay.',
    antiPatterns: 'No product-as-hero framing. No hard sell. No unrealistic luxury that alienates. No ignoring the product entirely.',
  },
  hook_viral: {
    id: 'hook_viral',
    label: 'Hook-Based Viral',
    definition: 'Content designed around a single powerful hook moment that stops the scroll. Everything serves the hook. Maximum attention capture.',
    useCase: 'Cold audience acquisition. Maximum reach and engagement. Testing new hooks at scale.',
    preferWhen: 'Running TOF prospecting. Need to break through ad fatigue. Testing new angles rapidly.',
    avoidWhen: 'Product requires nuanced explanation. Audience is already warm. Risk of being too gimmicky.',
    bestFunnelFit: ['tof'],
    bestProductFit: ['any-product', 'trending-products', 'supplements-with-surprising-benefits', 'beauty-innovations'],
    metaUseCases: 'Reels (native viral format), Feed (thumb-stop), Stories (swipe-up hook).',
    outputRequirements: 'Hook must be in first 1 second. Must be genuinely surprising, controversial, or pattern-breaking. Rest of content must deliver on the hook promise.',
    antiPatterns: 'No clickbait hooks that do not deliver. No hooks unrelated to the product. No hooks that violate Meta ad policy.',
  },
  educational: {
    id: 'educational',
    label: 'Educational',
    definition: 'Content that teaches the audience something valuable about their problem, ingredients, or the category. Positions brand as authority.',
    useCase: 'Building trust through expertise. Ingredient storytelling. Differentiating from competitors through knowledge.',
    preferWhen: 'Product has science-backed ingredients, unique formulation, or misunderstood category. Audience is research-minded.',
    avoidWhen: 'Audience is impulse-buying. Product differentiation is price/offer, not formulation. Content would be too dense.',
    bestFunnelFit: ['mof'],
    bestProductFit: ['supplements', 'science-backed-skincare', 'functional-wellness', 'clinical-beauty', 'vitamins'],
    metaUseCases: 'Reels (quick fact/myth bust), Feed (ingredient deep-dive), Stories (tip series).',
    outputRequirements: 'Must teach something specific and verifiable. Include ingredient names, mechanisms, or study references. Keep language accessible. End with product connection.',
    antiPatterns: 'No medical claims. No made-up statistics. No academic jargon without explanation. No pure education without product tie-in.',
  },
  podcast_style: {
    id: 'podcast_style',
    label: 'Podcast Style',
    definition: 'Talking head or interview format shot to look like a podcast clip. Intimate, conversational, authority-building.',
    useCase: 'Authority building and trust. Makes brand feel like an expert voice. Good for complex supplement categories.',
    preferWhen: 'Brand has access to experts, doctors, or knowledgeable founders. Category requires credibility. MOF trust-building.',
    avoidWhen: 'Audience is not research-minded. Product is simple and does not need expert positioning. No credible speaker available.',
    bestFunnelFit: ['mof'],
    bestProductFit: ['supplements', 'clinical-skincare', 'functional-nutrition', 'biohacking', 'medical-grade-beauty'],
    metaUseCases: 'Reels (clip from "podcast"), Feed (extended conversation), Stories (quick expert quote).',
    outputRequirements: 'Must feel like a real podcast clip, not staged. Include professional audio quality direction. Speaker must make a specific, memorable claim. Captions required.',
    antiPatterns: 'No obviously staged/scripted delivery. No actual medical advice. No long monologues without visual breaks.',
  },
  routine: {
    id: 'routine',
    label: 'Routine',
    definition: 'Product integrated into a morning, evening, fitness, or self-care routine. Step-by-step format showing the product as part of a larger system.',
    useCase: 'Showing product context and building purchase intent through aspiration. "I want that routine" effect.',
    preferWhen: 'Product fits naturally into daily routine. Target audience values self-care rituals. Multiple products in the line.',
    avoidWhen: 'Product is a one-time purchase. Routine format feels forced for the category.',
    bestFunnelFit: ['tof', 'mof'],
    bestProductFit: ['skincare', 'supplements', 'beauty', 'wellness-bundles', 'morning-supplements', 'sleep-products'],
    metaUseCases: 'Reels (morning/evening routine), Feed (detailed routine walkthrough), Stories (step-by-step).',
    outputRequirements: 'Must show 3-5 steps. Product must appear naturally as one step. Include time-of-day context. Show real environment (bathroom, kitchen).',
    antiPatterns: 'No routines with only one product. No unrealistically perfect morning. No skipping the actual product usage moment.',
  },
  comparison: {
    id: 'comparison',
    label: 'Comparison',
    definition: 'Direct or indirect comparison between this product and alternatives (competitors, old habits, or previous solutions).',
    useCase: 'Competitive differentiation. Overcoming "why this one?" objection. Showing superior ingredients, value, or results.',
    preferWhen: 'Product has clear advantages over competitors. Audience is comparison-shopping. BOF conversion.',
    avoidWhen: 'No clear competitive advantage. Risk of defamation. Comparison feels petty or desperate.',
    bestFunnelFit: ['mof', 'bof'],
    bestProductFit: ['supplements', 'skincare', 'vitamins', 'protein', 'any-product-with-differentiation'],
    metaUseCases: 'Feed (side-by-side), Reels (vs format), Stories (poll/quiz comparison).',
    outputRequirements: 'Must compare on specific, verifiable dimensions (ingredients, dosage, price-per-serving). Must be factual. Use "ours vs typical" framing instead of naming competitors.',
    antiPatterns: 'No naming competitors directly (Meta policy risk). No false claims about competitors. No "we are the best" without specifics.',
  },
  myth_busting: {
    id: 'myth_busting',
    label: 'Myth Busting',
    definition: 'Content that identifies a common misconception in the category and corrects it, positioning the brand as a truth-teller.',
    useCase: 'Attention-grabbing education. Disrupting category assumptions. Building authority through contrarianism.',
    preferWhen: 'Category has genuine misconceptions. Brand can credibly challenge conventional wisdom. TOF attention grab.',
    avoidWhen: 'Myth is not actually widespread. Correction could be seen as condescending. No credible basis for the counter-claim.',
    bestFunnelFit: ['tof', 'mof'],
    bestProductFit: ['supplements', 'skincare', 'vitamins', 'collagen', 'probiotics', 'any-misunderstood-category'],
    metaUseCases: 'Reels (quick myth bust), Feed (detailed correction), Stories (true/false quiz).',
    outputRequirements: 'Must state the myth clearly. Must provide credible correction. Must tie back to product. Use "most people think X, but actually Y" structure.',
    antiPatterns: 'No making up myths to bust. No attacking customers for believing the myth. No unsubstantiated counter-claims.',
  },
  pov_relatable: {
    id: 'pov_relatable',
    label: 'POV / Relatable',
    definition: 'Content shot from the viewer perspective or portraying a universally relatable scenario. "That moment when..." format.',
    useCase: 'Maximum relatability and shareability. The audience sees themselves in the content. TOF viral potential.',
    preferWhen: 'Product solves a widely experienced micro-frustration. Target audience is active on social media. TOF prospecting.',
    avoidWhen: 'Product is niche with a small addressable audience. Scenario is forced or not genuinely relatable.',
    bestFunnelFit: ['tof'],
    bestProductFit: ['any-consumer-product', 'supplements', 'beauty', 'sleep', 'stress', 'energy', 'skin-concerns'],
    metaUseCases: 'Reels (POV native format), Feed (relatable meme-style), Stories (interactive).',
    outputRequirements: 'Must depict a universally experienced moment. Product introduction must feel like a natural discovery, not an ad. Use trending POV formats.',
    antiPatterns: 'No forced relatability. No scenarios that only apply to 1% of people. No product placement that breaks the POV immersion.',
  },
  product_stack: {
    id: 'product_stack',
    label: 'Product Stack / BOGO',
    definition: 'Multiple units of the same product stacked, fanned out, or arranged together on a clean surface. Faceless — only hands visible. A voiceover announces the offer. Designed for BOGO, bundle, and limited-time deals.',
    useCase: 'Bottom-of-funnel offer ads. When running BOGO, bundle deals, or volume discounts. The visual of multiple products creates perceived value and urgency.',
    preferWhen: 'Running a specific offer (BOGO, bundle, discount code). Product packaging is visually appealing. BOF retargeting warm audiences.',
    avoidWhen: 'No offer to announce. Product is digital or has no physical form. Top-of-funnel cold audience who doesn\'t know the brand yet.',
    bestFunnelFit: ['bof'],
    bestProductFit: ['skincare', 'supplements', 'beauty', 'wellness', 'bundles', 'serums', 'oils'],
    metaUseCases: 'Reels (quick stack reveal + offer), Feed (arrangement + deal CTA), Stories (swipe-up offer).',
    outputRequirements: 'Must show: 3-5 identical products arranged together. Hands arranging or touching products. Clean surface, good lighting. Voiceover announces the offer clearly. CTA with offer code or deal.',
    antiPatterns: 'No showing a single product. No face visible. No long explanations — keep it short and punchy. No cluttered background distracting from the product stack.',
  },
};

// ── Funnel Stage ──

export const FUNNEL_STAGES: Record<string, TaxonomyEntry & { ctaStyle: string; proofLevel: string; urgencyLevel: string; copyDensity: string; hookTiming: string }> = {
  tof: {
    id: 'tof',
    label: 'Top of Funnel',
    definition: 'Cold audience. Never heard of the brand. Scrolling passively. Goal: stop the scroll, spark curiosity, earn attention.',
    useCase: 'Prospecting new audiences. Building awareness. Testing new hooks and angles at scale.',
    preferWhen: 'Launching to new audiences. Scaling spend. Testing creative concepts. Account needs fresh pipeline.',
    avoidWhen: 'Budget is limited and needs immediate ROAS. Audience is already warm.',
    bestFunnelFit: ['tof'],
    bestProductFit: ['any'],
    metaUseCases: 'Broad targeting, Advantage+ audiences, interest-based prospecting, lookalike audiences.',
    outputRequirements: 'Hook must work in first 1 second. Content must feel native/organic, not promotional. Soft CTA only.',
    antiPatterns: 'No hard-sell CTA. No price mentions in first 50% of content. No assuming audience knows the brand. No long-form without a hook.',
    ctaStyle: 'Soft: "check this out", "link in bio", "you need to see this". No "buy now" or "shop now".',
    proofLevel: 'Light: one stat, one quote, or one visual proof point. Do not stack proof — save it for MOF.',
    urgencyLevel: 'None. No countdown, no scarcity, no limited time. Pure curiosity and value.',
    copyDensity: 'Low. Primary text: 2-4 sentences max. Headline: 5-8 words. No walls of text.',
    hookTiming: 'First 1 second must stop the scroll. If the first frame is not attention-grabbing, the ad fails.',
  },
  mof: {
    id: 'mof',
    label: 'Middle of Funnel',
    definition: 'Warm audience. Aware of the category or brand. Evaluating options. Goal: build trust, educate, differentiate.',
    useCase: 'Retargeting website visitors, video viewers, social engagers. Nurturing consideration.',
    preferWhen: 'Audience has seen TOF content. Product requires education or trust-building. Competitive market.',
    avoidWhen: 'No warm audience exists yet. Product is impulse-buy with no consideration phase.',
    bestFunnelFit: ['mof'],
    bestProductFit: ['any'],
    metaUseCases: 'Custom audiences (web visitors, video viewers 50%+, social engagers), remarketing.',
    outputRequirements: 'Lead with credibility. Include proof (reviews, expert opinions, results). Explain why this product vs alternatives.',
    antiPatterns: 'No repeating TOF hooks — audience already knows the brand. No skipping proof/trust elements. No going straight to offer.',
    ctaStyle: 'Medium: "see why 10,000+ people switched", "try it risk-free", "learn more about our formula".',
    proofLevel: 'Heavy: 3+ proof points — reviews, expert quotes, ingredient evidence, customer count, awards.',
    urgencyLevel: 'Light. Can mention popularity ("selling fast") but no hard countdown or scarcity.',
    copyDensity: 'Medium. Primary text: 4-6 sentences. Can include ingredient lists, benefit bullets, review quotes.',
    hookTiming: 'First 3 seconds must establish credibility or intrigue. Can be slower than TOF but must still earn attention.',
  },
  bof: {
    id: 'bof',
    label: 'Bottom of Funnel',
    definition: 'Hot audience. Ready to buy. Just needs the final push. Goal: convert with urgency, offer, and decisive proof.',
    useCase: 'Converting warm audiences. Cart abandoners. High-intent retargeting. Maximizing existing momentum.',
    preferWhen: 'Strong warm audience exists. Product has a compelling offer. Account ROAS is >1.5x.',
    avoidWhen: 'No warm audience pipeline. No offer or differentiator. Account has insufficient TOF volume.',
    bestFunnelFit: ['bof'],
    bestProductFit: ['any'],
    metaUseCases: 'Add-to-cart retargeting, checkout abandoners, purchase lookalikes, high-intent custom audiences.',
    outputRequirements: 'Lead with offer or decisive proof. Include guarantee/risk reversal. Hard CTA. Urgency must feel real, not fake.',
    antiPatterns: 'No soft CTAs. No educational content without conversion intent. No fake scarcity on evergreen products.',
    ctaStyle: 'Hard: "shop now", "claim your bundle", "use code X for 20% off", "limited time offer".',
    proofLevel: 'Decisive: final objection killers — guarantee, money-back promise, customer count, star rating.',
    urgencyLevel: 'High. Countdown, limited stock, limited-time offer, "last chance". Must be genuine or offer-based.',
    copyDensity: 'High. Primary text: 5-8 sentences. Include offer details, guarantee, multiple CTAs, urgency language.',
    hookTiming: 'First 2 seconds must communicate offer or urgency. Audience already knows the product — lead with the reason to buy NOW.',
  },
};

// ── Hook Style ──

export const HOOK_STYLES: Record<string, TaxonomyEntry & { openingBehavior: string; exampleFormats: string[] }> = {
  pattern_interrupt: {
    id: 'pattern_interrupt',
    label: 'Pattern Interrupt',
    definition: 'An unexpected, jarring, or surprising opening that breaks the viewer out of passive scrolling. Visual or verbal shock.',
    useCase: 'Maximum scroll-stopping power. Best for TOF cold audiences who have no reason to stop.',
    preferWhen: 'Cold audience. Competitive feed. Account CTR is below average. Need to break through ad blindness.',
    avoidWhen: 'Warm audience who already knows the brand. Risk of feeling gimmicky or clickbaity.',
    bestFunnelFit: ['tof'],
    bestProductFit: ['any'],
    metaUseCases: 'Reels (first-frame shock), Feed (thumb-stop moment), Stories (unexpected opening).',
    outputRequirements: 'First frame/word must be unexpected. Can use: bold claim, visual disruption, sudden action, controversial statement, reverse expectation.',
    antiPatterns: 'No bait-and-switch. No misleading claims. No shocking content that violates Meta policy. Must deliver on the hook promise.',
    openingBehavior: 'Start with something the viewer does NOT expect to see in their feed. Break the visual or audio pattern of normal content.',
    exampleFormats: ['"Stop buying [category] until you read this"', 'Unexpected visual (pouring product in unusual way)', '"Your [routine] is making your [problem] worse"', 'Quick cut montage that stops suddenly'],
  },
  curiosity: {
    id: 'curiosity',
    label: 'Curiosity',
    definition: 'Opens a mental loop that the viewer needs to close. Creates a knowledge gap that can only be filled by watching/reading.',
    useCase: 'Engagement-driven. High completion rates. Best for content that reveals something valuable.',
    preferWhen: 'Product has a surprising benefit, unusual ingredient, or counterintuitive mechanism. Story-driven content.',
    avoidWhen: 'Content does not actually deliver a satisfying payoff. Audience is impatient (BOF).',
    bestFunnelFit: ['tof', 'mof'],
    bestProductFit: ['supplements-with-unique-ingredients', 'innovative-products', 'science-backed'],
    metaUseCases: 'Reels (open loop → reveal), Feed (curiosity headline), Stories (swipe for answer).',
    outputRequirements: 'Must open an explicit loop ("I found out why...", "Nobody talks about this..."). Loop must be closed within the content. Payoff must be genuinely interesting.',
    antiPatterns: 'No loops that never close. No clickbait without substance. No curiosity hooks unrelated to the product.',
    openingBehavior: 'Ask a question, make an incomplete statement, or reveal partial information that demands completion.',
    exampleFormats: ['"I just found out what most [products] are actually made of..."', '"This is the ingredient nobody talks about"', '"I was wrong about [category] for years"', '"3 things I wish I knew before buying [product type]"'],
  },
  emotional: {
    id: 'emotional',
    label: 'Emotional',
    definition: 'Leads with an emotional state — frustration, hope, fear, relief, joy, vulnerability. Connects on a human level before introducing product.',
    useCase: 'Deep connection. High share rates. Best for products tied to emotional outcomes (confidence, sleep, pain, anxiety).',
    preferWhen: 'Product solves an emotionally charged problem. Target audience is emotionally motivated. Trust is the barrier.',
    avoidWhen: 'Product is utilitarian with no emotional connection. Risk of being manipulative or exploitative.',
    bestFunnelFit: ['tof', 'mof'],
    bestProductFit: ['sleep', 'stress', 'anxiety', 'skin-confidence', 'pain', 'aging', 'self-care', 'weight'],
    metaUseCases: 'Reels (vulnerable moment), Feed (emotional story), Stories (personal share).',
    outputRequirements: 'Must lead with a genuine emotional moment. Emotion must be specific (not generic "feeling good"). Product must feel like a natural part of the emotional resolution.',
    antiPatterns: 'No exploiting serious health conditions. No guilt-tripping. No fake crying/emotions. No triggering content around eating disorders, mental health crises, or self-harm.',
    openingBehavior: 'Start with a vulnerable, honest emotional statement or a visually emotional moment that the viewer instantly recognizes.',
    exampleFormats: ['"I was so tired of waking up exhausted..."', '[Close-up of person looking defeated, then finding hope]', '"This is embarrassing but I need to talk about it"', '"The moment everything changed for my [skin/sleep/energy]"'],
  },
  authority: {
    id: 'authority',
    label: 'Authority',
    definition: 'Opens with credibility — expert opinion, scientific fact, professional endorsement, or authoritative statement.',
    useCase: 'Trust building for skeptical audiences. Differentiating through expertise. Category education.',
    preferWhen: 'Product is science-backed. Audience is research-minded. Category has trust issues (supplements, anti-aging).',
    avoidWhen: 'No credible authority available. Audience prefers peer recommendations over expert opinions.',
    bestFunnelFit: ['mof'],
    bestProductFit: ['supplements', 'clinical-skincare', 'medical-grade', 'vitamins', 'probiotics'],
    metaUseCases: 'Feed (expert endorsement), Reels (expert clip), Stories (expert quote card).',
    outputRequirements: 'Must cite a specific credential, study, or expert. Must not make unsupported medical claims. Authority must be genuine or framed as professional opinion.',
    antiPatterns: 'No fake doctors. No "studies show" without a real study. No white-coat theater without real credentials. No implying medical endorsement.',
    openingBehavior: 'Lead with a credential, a surprising scientific fact, or a professional statement that commands attention through expertise.',
    exampleFormats: ['"As a nutritionist, this is the one supplement I recommend to everyone"', '"New research just confirmed what we suspected about [ingredient]"', '"Most supplement companies won\'t tell you this"', '"After 10 years in dermatology, I only trust products that..."'],
  },
  relatable: {
    id: 'relatable',
    label: 'Relatable',
    definition: 'Opens with a universally experienced micro-moment that makes the viewer think "that is literally me". Instant identification.',
    useCase: 'Shareability and connection. The "tag a friend" format. Best for common daily frustrations that products solve.',
    preferWhen: 'Product solves a common, widely experienced problem. Target audience is social-media native. TOF virality.',
    avoidWhen: 'Problem is niche or not widely experienced. Risk of being too generic and not converting.',
    bestFunnelFit: ['tof'],
    bestProductFit: ['any-consumer-product', 'sleep', 'energy', 'skin', 'stress', 'daily-supplements'],
    metaUseCases: 'Reels (relatable moment), Feed (meme-style), Stories (poll/this-or-that).',
    outputRequirements: 'Must depict a moment that 80%+ of the target audience has experienced. Must feel observed, not manufactured. Product solution must feel like a genuine discovery.',
    antiPatterns: 'No forced relatability. No scenarios that only resonate with a tiny niche. No making fun of the audience.',
    openingBehavior: 'Show or describe a specific, detailed everyday moment that triggers instant recognition: "oh my god, yes".',
    exampleFormats: ['"POV: It\'s 3pm and you literally cannot keep your eyes open"', '"Me pretending I\'m not falling apart while running on 4 hours of sleep"', '"When you\'ve tried 47 products and nothing works"', '"That moment when your [skin/energy/sleep] finally cooperates"'],
  },
};

// ── Avatar / Presenter ──

export const AVATAR_STYLES: Record<string, TaxonomyEntry & { castingNotes: string; deliveryStyle: string }> = {
  female_ugc: {
    id: 'female_ugc', label: 'Female UGC',
    definition: 'Female content creator filming in selfie/front-camera style. Authentic, relatable, casual.',
    useCase: 'Primary format for beauty, skincare, and wellness supplements targeting women 25-55.',
    preferWhen: 'Target audience is female. Product is beauty/skincare/wellness. UGC outperforms branded content in the account.',
    avoidWhen: 'Product targets men. Brand positioning is premium/clinical rather than relatable.',
    bestFunnelFit: ['tof', 'mof', 'bof'], bestProductFit: ['skincare', 'beauty', 'wellness', 'supplements'],
    metaUseCases: 'Reels, Stories, Feed — native UGC format.', outputRequirements: 'Selfie-style camera. Natural lighting. Real environment. Casual spoken delivery.',
    antiPatterns: 'No overly polished/model-level presenter. No reading from script obviously. No studio lighting.',
    castingNotes: 'Age-appropriate to target audience. Relatable appearance. Genuine enthusiasm, not performative. Should feel like a real customer, not an actor.',
    deliveryStyle: 'Conversational, slightly imperfect. Minor filler words ("like", "honestly", "okay so"). Short pauses. Looking at camera like talking to a friend.',
  },
  male_ugc: {
    id: 'male_ugc', label: 'Male UGC',
    definition: 'Male content creator filming in selfie/front-camera style. Authentic, direct, casual.',
    useCase: 'Products targeting men. Fitness supplements, men\'s grooming, general wellness for male audiences.',
    preferWhen: 'Target audience is male. Product is fitness/energy/men\'s health. Account data shows male presenters convert.',
    avoidWhen: 'Product primarily targets women. Brand is feminine-coded.',
    bestFunnelFit: ['tof', 'mof', 'bof'], bestProductFit: ['fitness-supplements', 'mens-grooming', 'energy', 'protein', 'testosterone'],
    metaUseCases: 'Reels, Stories, Feed — native UGC format.', outputRequirements: 'Same as female UGC but with male presenter.',
    antiPatterns: 'No gym-bro stereotypes unless intentional. No overly aggressive delivery. No shirtless without reason.',
    castingNotes: 'Relatable, not intimidating. Age-appropriate. Can be athletic but not bodybuilder unless fitness product.',
    deliveryStyle: 'Direct, confident but not aggressive. Shorter sentences. Matter-of-fact tone. "Real talk" energy.',
  },
  creator_influencer: {
    id: 'creator_influencer', label: 'Creator / Influencer',
    definition: 'Higher-production UGC with an influencer or established creator feel. More polished than raw UGC but still authentic.',
    useCase: 'When you need the credibility of a creator but the authenticity of UGC. Premium product positioning.',
    preferWhen: 'Brand collaborates with creators. Product needs social credibility. Targeting creator-aware audiences.',
    avoidWhen: 'Budget does not support creator production. Audience distrusts influencers.',
    bestFunnelFit: ['tof', 'mof'], bestProductFit: ['beauty', 'wellness', 'lifestyle-supplements', 'premium-skincare'],
    metaUseCases: 'Reels (native creator content), Feed (polished UGC).', outputRequirements: 'Slightly higher production than raw UGC. Better lighting, framing. Still authentic delivery.',
    antiPatterns: 'No overly promotional/sponsored-post feel. No "use my code" as the entire message.',
    castingNotes: 'Creator aesthetic — ring light, clean background, but personality-driven. Someone the audience would follow.',
    deliveryStyle: 'Confident and personable. Slightly polished but still casual. Can use humor. More "showing you" than "telling you".',
  },
  expert_authority: {
    id: 'expert_authority', label: 'Expert / Authority',
    definition: 'Professional or credentialed presenter — doctor, nutritionist, esthetician, scientist, formulator.',
    useCase: 'Maximum trust and credibility. Essential for science-backed claims. Category education.',
    preferWhen: 'Product needs clinical credibility. Category has trust issues. MOF education/trust building.',
    avoidWhen: 'No real expert available. Audience prefers peer recommendations. TOF cold audiences who do not respond to authority.',
    bestFunnelFit: ['mof'], bestProductFit: ['supplements', 'clinical-skincare', 'vitamins', 'medical-grade'],
    metaUseCases: 'Feed (expert endorsement), Reels (expert clip).', outputRequirements: 'Must reference real or realistic credentials. Professional but accessible delivery.',
    antiPatterns: 'No fake credentials. No white-coat theater. No medical claims. No "as a doctor, I prescribe this".',
    castingNotes: 'Professional appearance. Can be in office/lab setting. Credentials visible (name tag, title on screen). Trustworthy demeanor.',
    deliveryStyle: 'Measured and knowledgeable. Uses accessible language (not jargon). Confident but not preachy. Explains "why" not just "what".',
  },
  podcast_host: {
    id: 'podcast_host', label: 'Podcast Host',
    definition: 'Shot to look like a podcast or interview setting. Microphone visible. Intimate, conversational, authority-building.',
    useCase: 'Long-form credibility. Makes brand feel like a thought leader. Great for complex supplement categories.',
    preferWhen: 'Category requires education. Audience is podcast-listening demographic. MOF trust building.',
    avoidWhen: 'Content needs to be under 15 seconds. Audience is visual-first (beauty/skincare demos).',
    bestFunnelFit: ['mof'], bestProductFit: ['supplements', 'biohacking', 'clinical', 'functional-nutrition'],
    metaUseCases: 'Reels (podcast clip), Feed (extended interview).', outputRequirements: 'Microphone in frame. Clean background. Clip must have one memorable soundbite.',
    antiPatterns: 'No actual 30-minute podcast format. No mumbling/rambling. No medical advice.',
    castingNotes: 'Articulate speaker. Can be founder, expert, or relatable host. Professional audio quality implied.',
    deliveryStyle: 'Conversational but focused. Short, quotable statements. Slight lean-in energy. "Let me tell you what most people get wrong about..."',
  },
  faceless_product_only: {
    id: 'faceless_product_only', label: 'Faceless / Product Only',
    definition: 'No human presenter. Product is the hero. Hands may appear but no face on camera. Text overlays carry the message.',
    useCase: 'When no presenter is available. High-volume testing. Product-focused demos. Text-led storytelling.',
    preferWhen: 'No creator budget. Product is visually compelling. Running rapid creative tests. A/B testing copy angles.',
    avoidWhen: 'Audience needs human connection to convert. Product is not visually interesting. Account data shows face-to-camera outperforms.',
    bestFunnelFit: ['mof', 'bof'], bestProductFit: ['skincare', 'beauty-tools', 'supplements-with-packaging', 'bundles'],
    metaUseCases: 'Feed (product showcase), Reels (satisfying product shots), Stories (quick offer).', outputRequirements: 'Text overlays must carry the narrative. Product must be visually compelling. Include close-ups and texture shots.',
    antiPatterns: 'No static single-shot of product on table. No text-only slides. No ignoring sound design (use natural product/environment sounds).',
    castingNotes: 'N/A — no presenter. Hands should appear natural if visible (manicured, age-appropriate to audience).',
    deliveryStyle: 'Visual storytelling + text overlays + natural product sounds. Pacing is critical — each shot should last 2-4 seconds max. Text must be readable in 1 second.',
  },
};

// ── Generation Goal ──

export const GENERATION_GOALS: Record<string, TaxonomyEntry & { promptBehavior: string }> = {
  new_concept: {
    id: 'new_concept', label: 'New Concept',
    definition: 'Generate entirely fresh creative concepts from scratch. No reference to existing ads. Pure ideation.',
    useCase: 'Starting a new testing cycle. Exploring untested angles. Launching new products.',
    preferWhen: 'No existing winning ads. Fresh product launch. Account needs new creative pipeline.',
    avoidWhen: 'Winning ads exist that should be iterated on instead of abandoned.',
    bestFunnelFit: ['tof', 'mof', 'bof'], bestProductFit: ['any'],
    metaUseCases: 'Creative testing campaigns, Advantage+ creative.', outputRequirements: 'Each concept must be unique in angle and approach. No repetition between packages.',
    antiPatterns: 'No recycling existing ad copy. No generic concepts that could apply to any product.',
    promptBehavior: 'Generate original concepts. Use account intelligence to inform direction but do not copy existing ads. Each package must test a genuinely different hypothesis.',
  },
  generate_variations: {
    id: 'generate_variations', label: 'Generate Variations',
    definition: 'Create variations of a specific existing package. Keep the core angle. Change execution details (hook, structure, CTA, emotion).',
    useCase: 'Iterating on a winning concept. A/B testing specific elements. Creative scaling.',
    preferWhen: 'A package shows promise and needs testing variations. Scaling a proven angle.',
    avoidWhen: 'The base package has not been tested yet. Generating variations of a losing concept.',
    bestFunnelFit: ['tof', 'mof', 'bof'], bestProductFit: ['any'],
    metaUseCases: 'A/B testing, creative refresh, angle scaling.', outputRequirements: 'Each variation must change at least 2 elements (hook + CTA, structure + emotion, etc.). Core angle must remain recognizable.',
    antiPatterns: 'No variations that are essentially the same package with minor word changes. No losing the core angle in pursuit of novelty.',
    promptBehavior: 'Receive the source package. Keep the core angle/concept intact. Systematically vary: hook type, emotional trigger, pacing/structure, CTA approach. Label each variation with what changed.',
  },
  use_winner_as_base: {
    id: 'use_winner_as_base', label: 'Use Winner as Base',
    definition: 'Take a winning ad from the account and use its creative DNA as the foundation for new packages.',
    useCase: 'Scaling what works. Adapting a proven ad into new formats or with fresh execution.',
    preferWhen: 'Account has a clear winner. Need to scale that winner into more volume without direct repetition.',
    avoidWhen: 'The winning ad is already showing fatigue. No clear winner exists.',
    bestFunnelFit: ['tof', 'mof', 'bof'], bestProductFit: ['any'],
    metaUseCases: 'Creative scaling, format adaptation.', outputRequirements: 'Must preserve the winning elements (angle, proof type, emotional arc). Must add new execution freshness.',
    antiPatterns: 'No exact copies of the winning ad. No losing the winning elements in pursuit of freshness.',
    promptBehavior: 'Analyze the winning ad creative DNA. Identify what makes it work (hook, proof, emotion, CTA). Create new packages that preserve these winning elements while changing execution (new script, new visuals, new presenter).',
  },
  refresh_fatigued_ad: {
    id: 'refresh_fatigued_ad', label: 'Refresh Fatigued Ad',
    definition: 'Take a fatiguing ad and create fresh versions that maintain what worked while changing enough to reset audience response.',
    useCase: 'Extending the life of a proven angle. Combating frequency-based fatigue. Keeping spend on a profitable concept.',
    preferWhen: 'A once-profitable ad is showing declining ROAS/CTR with sustained spend. Account cannot afford to lose the angle.',
    avoidWhen: 'Ad was never performing well. Problem is targeting, not creative fatigue.',
    bestFunnelFit: ['tof', 'mof', 'bof'], bestProductFit: ['any'],
    metaUseCases: 'Creative refresh, fatigue rotation.', outputRequirements: 'Must change visual environment, hook, and opening 3 seconds. Can keep core script structure and proof points.',
    antiPatterns: 'No changing only the thumbnail. No complete departure from the winning angle. No refreshing an ad that was never good.',
    promptBehavior: 'Analyze the fatigued ad. Identify what was working (angle, proof, CTA). Change: hook execution, visual environment, presenter, opening 3 seconds, scene order. Keep: core angle, key proof points, winning CTA structure.',
  },
  winner_to_new_format: {
    id: 'winner_to_new_format', label: 'Winner → New Format',
    definition: 'Take a winning concept and adapt it into a completely different creative format (e.g., testimonial → comparison, demo → routine).',
    useCase: 'Maximizing the value of a winning angle by expressing it through different formats. Creative diversification.',
    preferWhen: 'A winning angle works but all variations are the same format. Need to test the angle in different creative structures.',
    avoidWhen: 'The format IS the reason the ad works (e.g., the demo itself is the selling point).',
    bestFunnelFit: ['tof', 'mof', 'bof'], bestProductFit: ['any'],
    metaUseCases: 'Format testing, creative diversification.', outputRequirements: 'Must use a different creative type than the original. Must preserve the core selling proposition. Must feel natural in the new format.',
    antiPatterns: 'No forcing an angle into an incompatible format. No losing the core message in format translation.',
    promptBehavior: 'Extract the core selling proposition from the winner. Identify the emotional and logical mechanics that made it convert. Rebuild those mechanics inside the selected creative type format. The new format must serve the same persuasion goal through a different vehicle.',
  },
};

// ═══════════════════════════════════════════════════════
// LAYER 2 — PERFORMANCE KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════

export const META_PERFORMANCE_KB = {
  mobile: {
    assumption: 'All content is consumed on mobile, vertically, in a noisy feed. Design for one-handed, sound-off viewing with captions.',
    rules: [
      'Design for 9:16 vertical first. 1:1 acceptable for feed images.',
      'Text must be readable at mobile size — minimum effective font.',
      'Captions/subtitles required for all video content (85% of video watched without sound).',
      'Touch targets and visual hierarchy must work on 6-inch screens.',
    ],
  },
  placements: {
    feed: 'Primary placement. Autoplay with sound off. First frame is the ad. 1:1 or 4:5 images, 9:16 or 4:5 video.',
    reels: 'Highest organic reach. Must feel native — no brand intros, no logo watermarks in first 3s. 9:16 vertical only.',
    stories: 'Full-screen immersive. 15s max per story. Quick hook + CTA. Swipe-up or tap-through intent.',
  },
  video: {
    bestPractices: [
      'Hook in first 1s (TOF) to 3s (MOF/BOF) — this determines if the ad survives.',
      '15-30s optimal length for TOF/MOF. 6-15s for BOF.',
      'Captions always — never assume sound on.',
      'Native/UGC aesthetic outperforms polished brand video 2-3x on Meta.',
      'Show product within first 5 seconds for BOF, within 10 seconds for MOF.',
      'End with a clear closing moment — do not cut off mid-sentence.',
    ],
  },
  image: {
    bestPractices: [
      'Less than 20% text coverage — Meta deprioritizes text-heavy images.',
      'Bold, high-contrast headline readable at mobile thumbnail size (48px+ equivalent).',
      'Product must be clearly visible and identifiable within 1 second of viewing.',
      'Simple composition — one focal point, not cluttered. Maximum 3 text elements (hook + proof + CTA).',
      'Lifestyle > studio for TOF. Product hero > lifestyle for BOF.',
      'Every static ad must follow HOOK → PROOF → PRODUCT → CTA hierarchy top-to-bottom.',
      'Proof element must be visually distinct (star rating, stat number, quote marks, comparison checkmarks).',
      'CTA must be the most actionable element — clear verb, accent color, bottom placement.',
      'For supplements/beauty: show the actual bottle/packaging, not abstract ingredient graphics.',
      'Avoid: vague headlines, abstract concepts, pretty-but-non-selling layouts, weak CTAs, cluttered compositions.',
    ],
  },
  hooks: {
    timing: 'The first 1 second determines 80% of ad performance. Invest disproportionate effort in the opening frame.',
    principles: [
      'Pattern interrupt: break the visual rhythm of the feed.',
      'Curiosity gap: open a loop the viewer needs to close.',
      'Self-identification: make the viewer think "that is me".',
      'Authority signal: instant credibility that earns attention.',
      'Emotional trigger: tap into a feeling the viewer is already experiencing.',
    ],
  },
  cta: {
    byFunnel: {
      tof: 'Soft: "check this out", "link in bio". No purchase language.',
      mof: 'Medium: "learn more", "see why people switched", "try risk-free".',
      bof: 'Hard: "shop now", "get X% off today", "limited time". Direct action.',
    },
  },
  audio: {
    rules: [
      'NO background music. NO ambient music. NO soundtrack. NO cinematic scoring.',
      'Audio must be ONLY: natural voice, room tone, subtle environmental sounds.',
      'If presenter speaks, audio is their voice only — no music bed underneath.',
      'For faceless/product-only content: silence or subtle ASMR-like product sounds only (cap opening, pouring, tapping).',
      'Never describe music, beats, tracks, or melodies in any prompt or script.',
    ],
  },
  realism: {
    rules: [
      'Handheld camera feel — slight natural shake, not robotic stabilization.',
      'Natural lighting only — window light, golden hour, bathroom vanity, ring light with real shadows.',
      'Real-world environments — slightly lived-in, not perfectly staged.',
      'Human pacing — natural pauses, breathing room, not hyper-edited.',
      'No over-CGI or synthetic-looking product swaps.',
      'No unrealistic transitions (no morphing, no impossible camera moves).',
      'Correct product proportions — no oversized or miniaturized products.',
      'Consistent product appearance across all frames — same label, same colors, same branding.',
      'Realistic skin texture if hands/face appear — pores, natural tone variation.',
      'UGC aesthetic: slightly warm color grade, not oversaturated or HDR-looking.',
    ],
    ugcDelivery: [
      'Natural speech patterns with slight imperfection.',
      'Allow filler words: "honestly", "like", "okay so", "I mean".',
      'Slight pauses and minor restarts are authentic.',
      'Conversational energy, not announcer or spokesperson tone.',
      'Looking at camera like talking to a friend, not presenting to an audience.',
    ],
  },
  productIdentity: {
    rules: [
      'Use ONLY the exact product specified — never substitute with a generic or similar product.',
      'The provided reference image IS the product. Match its exact bottle shape, cap color, label layout, and color palette.',
      'If product images are provided, the video must show THAT EXACT product — same colors, same design, same label.',
      'Product must be recognizable and identifiable in every scene where it appears.',
      'NEVER hallucinate or invent text on labels — if you cannot render label text faithfully, do not attempt close-ups that require readable micro-text.',
      'Product proportions must be physically realistic — correct size relative to hands/environment.',
      'If multiple products in a bundle, each must match its real appearance individually.',
    ],
    shotComposition: [
      'Prefer clean front-facing compositions that show the overall bottle silhouette and colors.',
      'Avoid extreme close-ups of the label — AI text rendering produces garbled/wrong text.',
      'Avoid rotated angles that make label rendering worse.',
      'Use medium or wide shots to preserve overall recognizable branding.',
      'For hero product shots, use the reference image framing as closely as possible.',
      'Hand-held shots with the real bottle look are preferred over static product-on-table.',
      'Simple realistic motion around the exact product — slow reveal, gentle rotation, pick-up-and-show.',
    ],
  },
  // ── Product Physical Behavior Rules ──
  productBehavior: {
    capsule_supplement: {
      objectType: 'Small handheld supplement bottle with screw-top or flip-top cap',
      scale: 'Fits comfortably in one hand. Approximately 4-6 inches tall. NOT a water bottle, NOT a beverage container.',
      correctUsage: [
        'Hold bottle in one hand naturally',
        'Unscrew or flip open the cap',
        'Pour 1-2 capsules into palm of other hand',
        'Put capsules in mouth and swallow with a glass of water (NOT from the bottle)',
        'Close cap and set bottle down',
      ],
      forbiddenActions: [
        'NEVER drink directly from the supplement bottle',
        'NEVER squeeze the bottle like a drink container',
        'NEVER pour liquid from the bottle into mouth',
        'NEVER treat as a beverage/water bottle',
        'NEVER show the bottle at water-bottle scale — it must be small',
      ],
      visualCues: 'The bottle should look like a standard supplement container: opaque/dark plastic or glass, with a label wrapping around it, screw-top cap. Similar to a vitamin bottle from a pharmacy.',
    },
    topical_product: {
      objectType: 'Cream, serum, or balm container — jar, tube, or pump bottle',
      scale: 'Small to medium, held in fingertips or palm',
      correctUsage: ['Open container', 'Scoop/pump/squeeze product onto fingertips', 'Apply to skin with gentle motions'],
      forbiddenActions: ['NEVER drink or ingest topical products', 'NEVER pour onto food'],
      visualCues: 'Clean, cosmetic-style packaging. Often lighter colors, pump dispensers, or small jars.',
    },
  },
  fatigue: {
    signals: 'CTR declining while spend maintains. Frequency >3 on same audience. ROAS declining without audience saturation.',
    prevention: 'Rotate creatives every 2-3 weeks. Test 3-5 hooks per angle. Vary visual environment between variations.',
  },
  variation: {
    principles: [
      'Test one variable at a time when possible (hook, CTA, proof, format).',
      'Keep core angle consistent across variations — you are testing execution, not concept.',
      'Minimum 3 variations per angle to get statistically meaningful signal.',
      'Kill losing variations at $50-100 spend if no signal. Scale winners at $200+ spend.',
    ],
  },
  policy: {
    supplements: [
      'Never claim to "cure", "treat", "prevent", or "diagnose" any condition.',
      'Use: "supports", "helps", "promotes", "may help", "designed to".',
      'No before/after images that imply medical transformation.',
      'No references to specific diseases (cancer, diabetes, heart disease).',
      'Ingredient claims must be supportable. No proprietary blend hype without specifics.',
      'Testimonial results should include "individual results may vary" context.',
    ],
    beauty: [
      'No claims of permanent results from cosmetic products.',
      'Before/after must be same lighting, angle, and camera — no manipulation.',
      'No "clinically proven" without a real clinical study.',
      'Avoid: "anti-aging" (acceptable on Meta but tread carefully), "wrinkle removal" (say "appearance of fine lines").',
      'No body-shaming language. Frame transformations positively.',
    ],
    general: [
      'No misleading urgency (fake countdown on evergreen product).',
      'No fake reviews or fabricated endorsements.',
      'No engagement bait ("comment YES to get a discount").',
      'Landing page must match ad claims — no bait-and-switch.',
    ],
  },
  // ── Creative Playbook: funnel-specific content frameworks ──
  funnelPlaybook: {
    tof: {
      videoIdeas: ['Trend duet / reaction', 'Ingredient experiment', 'Founder rant / hot take', '"Watch me try" challenge', ':15 hook-only reel', ':30 mini-doc', 'Myth-buster', 'ASMR texture edit'],
      imageIdeas: ['Meme panel', 'Ingredient macro spotlight', 'Lifestyle collage', 'Motion poster', 'Trend format ("tell me without telling me")'],
      copyPrompts: ['Problem call-out with relatability', 'Surprising stat or claim', 'Time promise ("30-second routine")', 'Price power ("$29 neck lift in a jar?")'],
      kpiTargets: 'Thumb-stop >25%, 3-sec view >35%, CPC <$1.20',
    },
    mof: {
      videoIdeas: ['UGC testimonial stack', 'Expert duo / co-sign', 'Routine builder ("Day in the life")', 'FAQ cutdown', 'Before/after montage', 'Live Q&A clips'],
      imageIdeas: ['Carousel comparison', 'Review quote stack', 'Before/after panel', '"How it works" infographic', 'Price stack vs treatments'],
      copyPrompts: ['Social proof number ("15,000+ verified buyers")', 'Ingredient authority ("Powered by peptides + niacinamide")', 'Objection handler ("No tingling, no downtime")'],
      kpiTargets: 'Link CTR >1.5%, ATC cost <$8',
    },
    bof: {
      videoIdeas: ['"Cart close" countdown', 'Bundle walkthrough', 'FAQ rapid-fire', 'Guarantee explainer', 'Offer walkthrough', 'Concierge demo'],
      imageIdeas: ['Limited-offer banner', 'Bundle breakdown chart', 'Guarantee badge', 'Payment-plan callout', 'Offer poster with UGC background blur'],
      copyPrompts: ['"Ends tonight"', '"Tap to claim free shipping"', '"90-day results or it\'s on us"', 'Bundle price math'],
      kpiTargets: 'CPA target met, ROAS target met, On-site CVR optimized',
    },
  },
  // ── Image Ad Engine — strict format types + layout rules ──
  imageAdFormats: {
    testimonial_image: {
      id: 'testimonial_image', label: 'Testimonial Image',
      structure: 'HOOK (top) → PROOF (middle) → PRODUCT (center/bottom) → CTA (bottom)',
      layout: 'Review quote at top in large bold text with quotation marks. 5-star rating directly below quote. Product image center-right at 30-40% of frame. Customer first name + "Verified Buyer" bottom-left. CTA button bottom-right.',
      textDensity: 'Medium — headline + quote + CTA. Under 20% coverage.',
      visualRules: 'Real product photo. Quote marks around testimonial. Warm, trustworthy color palette (cream/white bg, dark text). Star rating must be gold/yellow.',
      useCase: 'MOF/BOF retargeting with social proof.',
      whyItConverts: 'Third-party voice is more believable than brand claims. Star rating creates instant credibility. Specific detail in the quote ("after 2 weeks") outperforms vague praise.',
      bestHookPatterns: ['"I didn\'t expect results this fast"', '"I\'ve tried everything — this actually worked"', '"My [skin/energy/sleep] changed in [X] days"', '"4.8 stars and I see why"'],
      bestProofPatterns: ['specific-timeframe quote ("After just 2 weeks...")', 'before/after detail in quote', 'reorder mention ("Already on my 3rd bottle")', 'skeptic-to-believer arc'],
      bestCtaByFunnel: { tof: 'See Why People Love It', mof: 'Read More Reviews', bof: 'Try It Risk-Free' },
      avoid: ['Generic praise ("Great product!"). Fake-sounding quotes. No star rating. Quote longer than 2 lines. Stock photo customer.'],
      supplementBeautyBias: 'Use real condition the product addresses. Quote should mention specific improvement. Include reorder signal if possible.',
    },
    review_stack: {
      id: 'review_stack', label: 'Review Stack',
      structure: 'HOOK (header stat) → PROOF (stacked reviews) → PRODUCT (sidebar) → CTA (bottom)',
      layout: 'Top: "4.8 stars from 12,000+ reviews" in bold. 3 review cards stacked vertically, each with star rating + 1-line quote + first name. Product image 25% width on right side. CTA bar full width at bottom.',
      textDensity: 'High — multiple review quotes. Keep each to 1 line max. Under 20% total.',
      visualRules: 'Clean grid layout. Screenshot-style review cards with slight shadow. Gold star graphics. Alternating subtle card backgrounds.',
      useCase: 'MOF/BOF trust building with volume proof.',
      whyItConverts: 'Volume of reviews creates consensus effect. Multiple voices feel more authentic than one. The aggregate stat anchors credibility.',
      bestHookPatterns: ['"15,000+ verified reviews — here\'s what they say"', '"Why this has a 4.8-star average"', '"3 reviews that changed my mind"', '"What 10,000 customers discovered"'],
      bestProofPatterns: ['3 diverse quotes (different benefits: energy, skin, sleep)', 'each review mentions a specific timeframe', 'one review mentions switching from a competitor', 'aggregate stat header (total reviews + avg rating)'],
      bestCtaByFunnel: { tof: 'See All Reviews', mof: 'Join 15,000+ Happy Customers', bof: 'Get Yours Today' },
      avoid: ['All reviews saying the same thing. Reviews longer than 1 line each. No aggregate stat. Fake-looking perfect reviews. No star ratings.'],
      supplementBeautyBias: 'Each review should mention a different benefit. Include a skeptic-to-believer review. One review should mention reordering.',
    },
    offer_stack: {
      id: 'offer_stack', label: 'Offer Stack',
      structure: 'HOOK (urgency headline) → PRODUCT (hero) → OFFER (price/bundle) → CTA (action)',
      layout: 'Urgency headline at top in bold ("Buy 2 Get 1 FREE" or "40% OFF Today Only"). Hero product image center at 40% of frame. Price comparison: strikethrough old price → new price. Bundle visual if applicable. High-contrast CTA button at bottom.',
      textDensity: 'Medium-high — price, offer, CTA. Bold typography with price emphasis.',
      visualRules: 'High-contrast colors. Price must be largest number on the image. Red strikethrough on old price. Green/bold on new price. Urgency badge (LIMITED TIME, TODAY ONLY). Product must be exact from source images.',
      useCase: 'BOF conversion and retargeting.',
      whyItConverts: 'Price anchoring (strikethrough) creates perceived value. Urgency creates FOMO. Bundle math makes the deal feel logical. Clear savings number reduces purchase friction.',
      bestHookPatterns: ['"Buy 2 Get 1 FREE — Today Only"', '"40% OFF — Limited Stock"', '"$29/bottle (was $49) — Bundle & Save"', '"Free Shipping + 20% OFF This Week"'],
      bestProofPatterns: ['price comparison (was/now)', 'savings math ("Save $47")', 'bundle breakdown showing per-unit cost', 'urgency countdown or stock indicator'],
      bestCtaByFunnel: { tof: 'See the Deal', mof: 'Claim Your Bundle', bof: 'Shop Now — 40% OFF' },
      avoid: ['Hiding the price. Vague discounts without numbers. No urgency signal. Burying the offer below the fold. Making it look like spam.'],
      supplementBeautyBias: 'Show bundle (3-bottle or 6-bottle) prominently. Per-unit math helps. Free shipping badge. Subscription savings if applicable.',
    },
    before_after: {
      id: 'before_after', label: 'Before / After',
      structure: 'BEFORE (left/top) → AFTER (right/bottom) → PRODUCT (center) → CTA (bottom)',
      layout: 'Clean split view: left=before state with "BEFORE" label, right=after state with "AFTER" label. Clear divider line. Product overlapping center at the divider. Timeline text ("After 4 weeks") below product. CTA at bottom.',
      textDensity: 'Low-medium — labels + timeline + CTA only. Let the visual contrast do the selling.',
      visualRules: 'SAME lighting, SAME angle, SAME person in both halves. Before side slightly desaturated. After side warm/vibrant. Product at center divider creates the visual bridge.',
      useCase: 'MOF/BOF proof-driven conversion.',
      whyItConverts: 'Visual transformation is instantly understandable. The contrast creates desire. Timeframe makes results feel achievable. The product at center positions it as the bridge between states.',
      bestHookPatterns: ['"4 weeks. Same person."', '"What 30 days looks like"', '"The difference is real"', '"Before I found this vs. After"'],
      bestProofPatterns: ['specific timeframe (weeks/days)', 'same-person same-angle comparison', 'zoom detail on the improvement area', 'product as the visual bridge between states'],
      bestCtaByFunnel: { tof: 'See the Transformation', mof: 'Start Your Transformation', bof: 'Get Started Today' },
      avoid: ['Different lighting/angles between halves. Unrealistic transformations. No timeframe. Missing the product. Before/after that looks the same.'],
      supplementBeautyBias: 'Show realistic, believable transformation. Skin clarity, energy level, or physique — not dramatic overnight changes. Include "results may vary" small.',
    },
    product_highlight: {
      id: 'product_highlight', label: 'Product Highlight',
      structure: 'PRODUCT (hero center) → KEY BENEFIT (overlay) → INGREDIENT CALLOUTS (around product) → CTA (bottom)',
      layout: 'Product image large and centered at 50% of frame. 2-3 ingredient/benefit callout badges around product connected by thin lines. Clean white or brand-color background. Single bold benefit headline above product. CTA at bottom.',
      textDensity: 'Low — callout badges + headline + CTA. Visual-first.',
      visualRules: 'Product from exact source images, clean background. Ingredient callout badges are small rounded pills. Professional but not clinical. Brand colors in accents.',
      useCase: 'TOF/MOF product awareness and education.',
      whyItConverts: 'Clean product visibility builds recognition. Ingredient callouts educate without overwhelming. Works for cold audiences who need to understand what they are looking at.',
      bestHookPatterns: ['"3 ingredients your [routine] is missing"', '"What\'s actually inside"', '"The formula behind the results"', '"Clean. Tested. Effective."'],
      bestProofPatterns: ['ingredient badges with benefit labels', 'dosage amounts on callouts', '"clinically studied" or "third-party tested" badge', 'key differentiator callout'],
      bestCtaByFunnel: { tof: 'Learn More', mof: 'See Full Ingredients', bof: 'Add to Cart' },
      avoid: ['Too many callouts (max 3). Cluttered layout. Generic "premium quality" claims. Hiding the product behind text. Ingredient names without benefit context.'],
      supplementBeautyBias: 'Show dosage per capsule on callouts. Highlight hero ingredient with a brief benefit. Show capsule count on bottle.',
    },
    problem_solution: {
      id: 'problem_solution', label: 'Problem → Solution',
      structure: 'PROBLEM (top, bold) → AGITATION (subtext) → SOLUTION/PRODUCT (center) → CTA (bottom)',
      layout: 'Bold problem statement at top in high-contrast text. 1-line agitation subtext below in smaller font. Divider or arrow pointing down. Product image as the solution in center with "The Solution:" label. Benefit statement beside product. CTA at bottom.',
      textDensity: 'Medium — problem + agitation + solution label + CTA.',
      visualRules: 'Problem zone uses warning colors (red/dark amber text or desaturated bg). Solution zone uses positive colors (green/bright, product glows). Clear visual contrast between the two halves.',
      useCase: 'TOF/MOF awareness for problem-aware audiences.',
      whyItConverts: 'Identifies the pain first, creating recognition. Agitation deepens the urgency. Product as solution creates a logical resolution. Works because people buy solutions, not products.',
      bestHookPatterns: ['"Still struggling with [problem]?"', '"Tired of [frustration]?"', '"If [common problem], read this"', '"The real reason your [routine] isn\'t working"'],
      bestProofPatterns: ['problem stated as question the viewer identifies with', 'brief agitation making the problem feel urgent', 'product positioned as the resolution with benefit', 'optional: small social proof badge near CTA'],
      bestCtaByFunnel: { tof: 'Discover the Fix', mof: 'See How It Works', bof: 'Solve It Now' },
      avoid: ['Vague problems nobody identifies with. No clear solution shown. Problem and solution looking visually similar. Preachy or medical-claim tone.'],
      supplementBeautyBias: 'Name the specific condition: fatigue, breakouts, bloating, dull skin — not "feel better". Show the product next to the solution benefit.',
    },
    comparison: {
      id: 'comparison', label: 'Comparison',
      structure: 'THEIRS (left) → OURS (right) → PRODUCT (right hero) → CTA (bottom)',
      layout: 'Two-column split: left="Typical [category]" in muted/gray tones with X marks, right="[Product Name]" in vibrant brand tones with checkmarks. 3-4 comparison points stacked. Our product image on right column. CTA spanning bottom.',
      textDensity: 'Medium — 3-4 comparison bullet points. Short, scannable.',
      visualRules: 'Left column desaturated/gray. Right column vibrant/branded. Checkmarks green, X marks red. Our product image vivid, competitors represented generically. Clear visual winner on the right.',
      useCase: 'MOF/BOF competitive differentiation.',
      whyItConverts: 'Side-by-side contrast makes the choice obvious. Checkmarks create subconscious scoring. The visual weight is biased toward our product. Works for audiences comparing options.',
      bestHookPatterns: ['"Not all [products] are created equal"', '"What you\'re really getting"', '"The difference matters"', '"Why people are switching"'],
      bestProofPatterns: ['3-4 specific comparison points (dosage, purity, testing, price)', 'checkmark vs X visual scoring', 'competitor represented as generic category not specific brand', 'our product shown as vivid hero image'],
      bestCtaByFunnel: { tof: 'See the Difference', mof: 'Compare Now', bof: 'Make the Switch' },
      avoid: ['Naming specific competitor brands (legal risk). Too many comparison points (max 4). Both columns looking equal. Unfair or misleading comparisons.'],
      supplementBeautyBias: 'Compare on: dosage, third-party testing, filler-free, capsule count, bioavailability. These are real differentiators supplement buyers care about.',
    },
    social_proof_stats: {
      id: 'social_proof_stats', label: 'Social Proof Stats',
      structure: 'STAT (hero number) → CONTEXT (supporting text) → PRODUCT (bottom) → CTA (bottom)',
      layout: 'Massive stat number top-center at 72px+ ("15,000+"). Descriptor text directly below ("Happy Customers" or "5-Star Reviews"). Product image bottom-center at 30% of frame. CTA button below product.',
      textDensity: 'Low — one big number, one line of context, CTA. Maximum impact, minimum clutter.',
      visualRules: 'Stat number is the visual hero — largest element on the image. Bold sans-serif. Clean background. Product recognizable but not dominant.',
      useCase: 'MOF/BOF trust building.',
      whyItConverts: 'Large numbers trigger bandwagon effect. Simple composition is scannable in 1 second. The stat does the selling — the product just needs to be identifiable.',
      bestHookPatterns: ['"15,000+ happy customers can\'t be wrong"', '"4.8 stars from real buyers"', '"Reordered 3x on average"', '"#1 rated in [category]"'],
      bestProofPatterns: ['customer count', 'average star rating', 'reorder rate', 'units sold', 'years trusted'],
      bestCtaByFunnel: { tof: 'Join Thousands of Fans', mof: 'See Why They Love It', bof: 'Get Yours Now' },
      avoid: ['Fake or inflated numbers. No supporting context for the stat. Stat buried in text. Multiple competing numbers. Product taking visual priority over the stat.'],
      supplementBeautyBias: 'Use reorder rate or review count — these are uniquely credible for supplements. "3rd bottle on average" is stronger than "thousands sold".',
    },
    ugc_style_still: {
      id: 'ugc_style_still', label: 'UGC-Style Still',
      structure: 'HOOK (text overlay) → PRODUCT IN CONTEXT (lifestyle photo) → CTA (small overlay)',
      layout: 'Lifestyle photo: person holding/using product in real environment (kitchen counter, bathroom mirror, gym bag). Bold text overlay at top in social-media-native font (white with black shadow). Tiny CTA text at bottom. Looks like a screenshot of a TikTok or Instagram post.',
      textDensity: 'Low — 1 hook line + tiny CTA. Mostly visual context.',
      visualRules: 'Must look like a real social media post, NOT a designed ad. Phone-quality lighting. Slightly imperfect composition. Product visible but held naturally. No logo overlays. No branded frames.',
      useCase: 'TOF awareness, native feed content.',
      whyItConverts: 'Bypasses ad blindness — looks like organic content. The authenticity triggers trust. Platform-native feel increases engagement. Best for cold audiences who ignore polished ads.',
      bestHookPatterns: ['"this changed my routine"', '"I didn\'t think this would work but..."', '"why is nobody talking about this"', '"3 weeks in and wow"', '"the one thing I actually reorder"'],
      bestProofPatterns: ['implied personal use (product in hand, in real setting)', 'casual tone implies genuine experience', 'lifestyle context shows integration into daily life', 'raw aesthetic signals authenticity'],
      bestCtaByFunnel: { tof: 'link in bio', mof: 'check the reviews', bof: 'tap to try' },
      avoid: ['Polished studio look. Brand logos on the photo. Professional lighting. Model-quality person. Designed CTA buttons. Any element that screams "ad".'],
      supplementBeautyBias: 'Show the bottle in a real kitchen/bathroom. Person should be relatable, not aspirational. Hand-holding-product or product-on-counter works best.',
    },
    authority_claim: {
      id: 'authority_claim', label: 'Authority Claim',
      structure: 'CREDENTIAL (top) → CLAIM (center) → PRODUCT (bottom) → CTA (bottom)',
      layout: 'Credential badge or title at top ("Recommended by Nutritionists" or "Backed by 12 Clinical Studies"). Bold benefit claim in center in large text. Product image bottom-center with ingredient highlight. CTA button at bottom.',
      textDensity: 'Medium — credential + claim + CTA.',
      visualRules: 'Professional, clean, medical-grade aesthetic. Trust badges (third-party tested, GMP certified). White or light blue background. No flashy colors — credibility over excitement.',
      useCase: 'MOF trust building for supplements and clinical skincare.',
      whyItConverts: 'Authority bypasses personal skepticism. Credentials create implied endorsement. Works for audiences who research before buying. The clinical feel justifies the price.',
      bestHookPatterns: ['"Recommended by nutritionists"', '"Backed by science, loved by customers"', '"The #1 doctor-recommended [type]"', '"Clinically studied ingredients inside"'],
      bestProofPatterns: ['professional credential or title', 'number of studies or clinical trials', 'certification badges (GMP, third-party tested, NSF)', 'expert quote or recommendation'],
      bestCtaByFunnel: { tof: 'Learn the Science', mof: 'See the Research', bof: 'Doctor-Recommended — Try Now' },
      avoid: ['Fake credentials. Medical claims that violate FTC/FDA. "Doctor" without actual doctor endorsement. Overly clinical look that feels pharmaceutical. Claims without backing.'],
      supplementBeautyBias: 'GMP certified, third-party tested, and "formulated by" are the strongest trust signals for supplements. For beauty: dermatologist-tested, clinical trial results.',
    },
  },
  // ── Image Platform Rules ──
  imagePlatformRules: {
    meta: {
      ratio: '1:1 (feed) or 4:5 (feed tall) or 9:16 (stories)',
      textRule: 'Under 20% text coverage — Meta deprioritizes text-heavy images.',
      layout: 'Clear visual hierarchy. One focal point. Bold headline readable at mobile thumbnail size. Product identifiable within 1 second. Structure follows HOOK→PROOF→PRODUCT→CTA top-to-bottom.',
      style: 'Polished but authentic. Clean composition. Conversion-ready. Professional sans-serif typography (Montserrat/Inter weight). Strong contrast ratios.',
      cta: 'CTA button style at bottom — rounded rectangle, accent color, white text. Clear action verb matching funnel stage.',
      visualMood: 'Clean, bright, professional. Light backgrounds (white, cream, light gray). Bold accent colors for CTA and key elements. Product photography should feel premium but real.',
      drRules: 'Every image must pass the 1-second test: viewer knows WHAT the product is, WHY they should care, and WHAT to do next. No ambiguity. No abstract concepts.',
    },
    tiktok: {
      ratio: '9:16 (full screen) or 1:1',
      textRule: 'TikTok-native text overlays. Bold, centered, short phrases. White text with black drop shadow. Not polished brand graphics.',
      layout: 'Looser composition. Text overlays feel hand-placed, not grid-aligned. Product shown in real context (hand, counter, bag). Hook text dominates the top third.',
      style: 'Raw, native, phone-screenshot aesthetic. Like a creator post, not a brand ad. Slightly warm/saturated color grade. Imperfect framing is intentional.',
      cta: 'Soft: "link in bio", "check this out", "tap for details". Text-only, no formal button graphic. Placed casually at bottom.',
      visualMood: 'Warm, saturated, casual. Real environments (kitchen, bathroom, desk). Phone-camera quality lighting (not studio). Product held or placed naturally.',
      drRules: 'Must look like something a real person posted, not something a brand designed. The hook text is the ad — everything else supports it. Proof should feel organic (screenshot of review, casual mention).',
    },
  },
  // ── CapCut Layout Spec (for image-to-layout pipeline) ──
  capcutLayoutSpec: {
    zones: {
      top: 'Hook zone — headline text. Font: bold sans-serif, 48-72px. Color: white on dark or black on light. Position: 10-25% from top.',
      center: 'Product/proof zone — hero image or proof element. Position: 25-70% vertical.',
      bottom: 'CTA zone — action text + offer. Font: bold, 36-48px. Color: accent color. Position: 75-90% from top.',
    },
    fontRules: 'Sans-serif only (Montserrat, Inter, or Poppins style). Bold for headlines, regular for body. Maximum 3 font sizes per image.',
    colorRules: 'Maximum 3 colors: background, text, accent. Accent for CTA and key numbers. High contrast between text and background.',
    spacingRules: 'Minimum 5% padding from all edges. Minimum 3% spacing between text blocks. No overlapping text elements.',
  },
  // ── Modular UGC Script Structure (45-60s) ──
  ugcScriptStructure: {
    beats: [
      { name: 'Hook', timing: '0-2s', rule: 'Challenge/question + visual interrupt. Pattern interrupt with texture, motion, or bold claim in first 0.3s.' },
      { name: 'Context', timing: '2-8s', rule: '"I tried [product] because…" — establish relatable problem and personal connection.' },
      { name: 'Demo/Proof', timing: '8-25s', rule: 'Apply product + overlay benefits / ingredient callouts. Show the product working.' },
      { name: 'Social Proof', timing: '25-35s', rule: '"X verified buyers" + screenshot stack or review overlay.' },
      { name: 'Offer', timing: '35-45s', rule: 'Price point, free shipping, bundle deal. Make the value undeniable.' },
      { name: 'CTA', timing: '45-55s', rule: 'Direct action: "Tap to [benefit]." Match funnel stage CTA rules.' },
    ],
    shortVersion: [
      { name: 'Hook', timing: '0-3s', rule: 'Scroll-stopping opener.' },
      { name: 'Problem + Product', timing: '3-10s', rule: 'Relatable problem → product as solution.' },
      { name: 'Proof', timing: '10-18s', rule: 'Results, social proof, or demonstration.' },
      { name: 'CTA', timing: '18-20s', rule: 'Action prompt matched to funnel stage.' },
    ],
  },
  // ── Proven Hook Types for Beauty/Health ──
  hookBank: {
    types: [
      { name: 'Texture Interrupt', description: 'Pattern interrupt with texture or motion (pouring serum, rubbing balm, ASMR foam) in first 0.3s.', bestFor: ['skincare', 'topicals', 'beauty'] },
      { name: 'Problem Call-out', description: '"[Problem] in your 30s? Same." overlayed while showing the issue.', bestFor: ['anti-aging', 'skin-concerns', 'pain'] },
      { name: 'Ingredient Flex', description: 'Macro shot + "Powered by [ingredient] + [ingredient]" text at frame one.', bestFor: ['supplements', 'clinical-skincare', 'vitamins'] },
      { name: 'Price Power', description: '"$29 [solution] in a jar?" + product reveal.', bestFor: ['any-product', 'low-ticket', 'bundles'] },
      { name: 'Time Promise', description: '"30-second routine for [problem]."', bestFor: ['skincare', 'supplements', 'quick-routines'] },
    ],
  },
  // ── Testing & Scaling Rules ──
  testingFramework: {
    batching: 'Launch 2 new concepts/week, each with 3 iterations (hook swap, CTA swap, text overlay swap).',
    killRule: 'Kill after spending 2x target CPA with no conversion signal.',
    refreshRule: 'Refresh hook once performance decays 20% from peak.',
    reskinRule: 'Re-skin monthly with seasonal colorways or influencer swaps.',
    reuseRule: 'Turn winning hook into static image, slice top testimonial into GIF, extract copy for email/SMS.',
    scorecard: ['Hook strength (1-5)', 'Story clarity (1-5)', 'Offer clarity (1-5)', 'Branding subtlety (1-5)', 'Platform fit (1-5)'],
  },
};

// ═══════════════════════════════════════════════════════
// PLATFORM TARGETING
// ═══════════════════════════════════════════════════════

export interface PlatformRules {
  id: string;
  label: string;
  definition: string;
  visualExecution: string;
  pacingExecution: string;
  hookExecution: string;
  ctaExecution: string;
  captionExecution: string;
  audioExecution: string;
  realismModifier: string;
  formatSpec: string;
}

export const PLATFORM_TARGETS: Record<string, PlatformRules> = {
  meta: {
    id: 'meta', label: 'Facebook / Meta',
    definition: 'Optimized for Meta ad placements: Feed, Reels, Stories. Direct-response capable. Autoplay sound-off default. Must convert in-feed.',
    visualExecution: 'Clean but native. Product must be clearly identifiable early (within first 5s for MOF/BOF, 10s for TOF). Slightly more polished than raw UGC — still authentic but production-aware. Avoid overly raw phone footage that looks unpaid.',
    pacingExecution: 'Structured pacing. Hook in first 1-3s depending on funnel stage. Clear beginning/middle/end. No dead time. Every second earns attention. Slightly more edited than TikTok — jump cuts OK but purposeful.',
    hookExecution: 'Must work with sound off. First frame must be visually compelling. Text overlay on hook recommended. Thumb-stop thinking — compete with friends/family content in feed.',
    ctaExecution: 'Match funnel stage precisely. TOF: soft ("check this out"). MOF: medium ("see why people switched"). BOF: direct ("shop now", "claim offer"). CTA button text matters — align with ad headline.',
    captionExecution: 'Captions mandatory — 85% of Meta video watched without sound. Burned-in subtitles, not platform auto-captions. Clean, readable, consistent style.',
    audioExecution: 'No background music. Voice + room tone only. Must work fully silent (captions carry the message). Sound is a bonus, not a requirement.',
    realismModifier: 'Authentic but conversion-ready. Not raw to the point of looking accidental. The "intentional UGC" aesthetic — looks native but clearly has a message.',
    formatSpec: 'Primary: 9:16 vertical (Reels/Stories). Also: 4:5 or 1:1 for feed. Duration: 15-30s TOF/MOF, 6-15s BOF.',
  },
  tiktok: {
    id: 'tiktok', label: 'TikTok',
    definition: 'Optimized for TikTok For You Page. Must feel like native content, not an ad. Sound-on default. Creator-first aesthetic. Must earn attention organically.',
    visualExecution: 'Raw, native, phone-shot aesthetic. Lo-fi is premium on TikTok. Overproduced = skipped. Real environments, real lighting, real imperfection. Product integration must feel organic, not staged.',
    pacingExecution: 'Fast-paced, creator-native rhythm. Quick cuts, natural energy, no corporate timing. The first 0.5s determines survival. Match the pace of organic TikTok content — slightly faster than Meta.',
    hookExecution: 'Sound-on hook preferred. Verbal hooks work best ("okay so..." / "stop scrolling if..."). Visual hooks secondary. Must feel like content, not advertising. Match trending hook formats when possible.',
    ctaExecution: 'Softer even at BOF. "Link in bio" energy. Never feel like a Facebook ad CTA on TikTok. Even conversion content should feel like a recommendation, not a sales pitch.',
    captionExecution: 'Text overlays in TikTok-native style (centered, bold, short phrases). Not subtitle-style — keyword/phrase overlay style. Use TikTok text formatting conventions.',
    audioExecution: 'No background music. Voice is primary. Room tone and natural audio valued. Sound-on assumed but captions still important for accessibility.',
    realismModifier: 'Maximum rawness. This must look like something a real person posted organically. Zero polish. Imperfection IS the production value. If it looks like an ad, it fails.',
    formatSpec: '9:16 vertical only. Full-screen. Duration: 15-30s for most formats. 7-15s for hooks/viral. Never exceed 60s.',
  },
};

// ═══════════════════════════════════════════════════════
// FORMAT REALISM ENGINE
// ═══════════════════════════════════════════════════════

export interface FormatRealism {
  realism: 'very_high' | 'high' | 'medium_high' | 'medium';
  polish: 'low' | 'medium_low' | 'medium' | 'medium_high';
  rawness: 'high' | 'medium_high' | 'medium' | 'low';
  adIntensity: 'very_low' | 'low' | 'medium' | 'medium_high';
  toneDirective: string;
  pacingDirective: string;
  scriptDirective: string;
  hookFilter: string;
  presenterDirective: string;
  visualDirective: string;
  avoidList: string[];
  authenticityMarkers: string[];
}

export const FORMAT_REALISM: Record<string, FormatRealism> = {
  testimonial: {
    realism: 'very_high', polish: 'low', rawness: 'high', adIntensity: 'very_low',
    toneDirective: 'Write as if a real person is genuinely talking about something they used. Not pitching, not selling — sharing. Use spoken language, not written copy. Allow sentence fragments, restarts, and natural rhythm. Sound like a voice memo to a friend, not an ad script.',
    pacingDirective: 'Conversational pacing with natural pauses. No rapid-fire benefit lists. Let moments breathe. Allow 1-2 seconds of silence or hesitation. Do not rush to the CTA.',
    scriptDirective: 'First person only. Start with a relatable problem or moment, not the product. Build to the product naturally through experience. Use phrases like "honestly", "I didn\'t expect", "the thing is", "I know it sounds weird but". Limit to 2-3 specific benefits mentioned naturally in conversation, never stacked as a list. End with a genuine soft recommendation, not a sales close.',
    hookFilter: 'The hook must sound like something this person would actually say to a friend. No copywriter hooks. No "shocking discovery" language. Examples: "Okay I actually need to talk about this", "I didn\'t think this would work", "So my friend told me about this thing..."',
    presenterDirective: 'Casual, warm, slightly imperfect delivery. Allow filler words. Allow looking away briefly. Allow small smiles and genuine micro-expressions. Not performing — just talking.',
    visualDirective: 'Selfie-mode or front-facing phone camera. Natural/messy background (real room, real kitchen, real bathroom). Slightly imperfect framing. Natural lighting — window or overhead, not ring light. No studio setup.',
    avoidList: ['Stacked benefit lists', 'Perfect sentence structure', 'Marketing buzzwords ("revolutionary", "game-changer")', 'Unnatural enthusiasm', 'Commercial pacing', 'Studio lighting', 'Perfect framing', 'Overly scripted transitions', 'Reading from a teleprompter feel', 'Too many claims in too short a time'],
    authenticityMarkers: ['Specific personal detail ("I\'ve been using this for about 3 weeks now")', 'Mild uncertainty ("I think it\'s the magnesium, honestly")', 'Natural filler ("like", "honestly", "okay so")', 'Genuine reaction moment', 'Casual recommendation ("you should try it" not "buy now")'],
  },
  b_roll: {
    realism: 'high', polish: 'medium', rawness: 'medium', adIntensity: 'low',
    toneDirective: 'Visual storytelling only. No spoken narrative — let the product speak through imagery. Sensory-driven: textures, pouring, spreading, light catching surfaces.',
    pacingDirective: 'Slow, intentional pacing. Each shot 2-4 seconds. Let the product be the subject. No rushing between shots. Gentle transitions — cuts, not effects.',
    scriptDirective: 'No spoken script. Text overlays only if needed — minimal, native-looking. Captions should feel like platform-native text, not brand graphics.',
    hookFilter: 'Visual hook only. First shot must be the most visually arresting moment: texture, pour, reveal, or unexpected product interaction.',
    presenterDirective: 'No face on camera. Hands may appear — natural, not posed. Product interaction should feel organic.',
    visualDirective: 'Product-focused cinematography with handheld feel. Natural lighting. Real surfaces (marble, wood, bathroom tile). Shallow depth of field. Subtle camera movement.',
    avoidList: ['Talking head', 'Hard-sell text overlays', 'Robotic camera movements', 'Stock footage aesthetic', 'Over-edited transitions'],
    authenticityMarkers: ['Real surface textures', 'Natural light and shadows', 'Slight camera shake', 'Organic product interaction', 'Believable environment'],
  },
  product_demo: {
    realism: 'high', polish: 'medium_low', rawness: 'medium_high', adIntensity: 'medium',
    toneDirective: 'Practical and demonstrative. Show the product working in real conditions. Not a commercial — a real person using the product and showing what happens.',
    pacingDirective: 'Functional pacing. Spend time on the actual usage moment. Do not rush past the demo. Let the viewer see the product being used in real time.',
    scriptDirective: 'Narration should explain what\'s happening naturally: "So you just open it like this" / "I take two of these in the morning". Not scripted walkthrough — casual explanation.',
    hookFilter: 'Hook should be about the experience: "Let me show you how I use this" / "This is my actual routine" / "Watch what happens when..."',
    presenterDirective: 'Hands-on, practical energy. Not performing — demonstrating. Can be casual and slightly imperfect.',
    visualDirective: 'Close-to-mid shots of product interaction. Real hands, real environment. Show the physical experience: opening, pouring, applying, texture.',
    avoidList: ['Skipping the actual demo moment', 'Pure product-on-table beauty shots without interaction', 'Over-narrating without showing'],
    authenticityMarkers: ['Real usage in real environment', 'Genuine tactile interaction', 'Casual narration during demo', 'Showing the actual product, not a render'],
  },
  before_after: {
    realism: 'medium_high', polish: 'medium_low', rawness: 'medium_high', adIntensity: 'medium',
    toneDirective: 'Proof-focused and factual. Let the transformation speak for itself. Do not over-explain — the visual difference is the message.',
    pacingDirective: 'Build-up pacing. Spend time establishing the "before" state genuinely. The reveal should feel earned, not instant.',
    scriptDirective: 'Keep narration grounded: "This was me 4 weeks ago" / "After using this for a month, here\'s where I\'m at". Include timeline. Do not overclaim.',
    hookFilter: 'Start with the relatable "before" state. The hook is the problem, not the solution.',
    presenterDirective: 'Same person in both states. Genuine, not performative. Allow vulnerability in the "before" state.',
    visualDirective: 'SAME lighting, SAME angle, SAME camera for both states. The only variable should be the result. Natural lighting.',
    avoidList: ['Different lighting between states', 'Exaggerated claims', 'Medical transformation language', 'Manipulated imagery', 'Instant transformation without timeline'],
    authenticityMarkers: ['Consistent lighting and angle', 'Specific timeline mentioned', 'Vulnerability in before state', 'Measured optimism in after state'],
  },
  problem_solution: {
    realism: 'high', polish: 'medium_low', rawness: 'medium_high', adIntensity: 'medium',
    toneDirective: 'Start frustrated, end relieved. The emotional arc IS the ad. Do not skip the problem — spend real time in it so the solution feels earned.',
    pacingDirective: 'Problem gets 40% of time. Solution gets 40%. CTA gets 20%. Do not rush past the pain point.',
    scriptDirective: 'Problem should be specific and emotionally real: "I was waking up every morning with zero energy" — not "Are you tired?". Solution should feel discovered, not pitched.',
    hookFilter: 'Open with the problem as if venting to a friend. Not a rhetorical question — a real statement of frustration.',
    presenterDirective: 'Emotional range — genuinely frustrated at the start, genuinely relieved by the middle. Not acting — living the arc.',
    visualDirective: 'Problem state should look real and relatable. Solution state should feel naturally better, not staged-perfect.',
    avoidList: ['Rushing past the problem', 'Rhetorical questions as hooks', 'Instant magic solutions', 'Overacting frustration or joy'],
    authenticityMarkers: ['Specific problem detail', 'Emotional sincerity', 'Natural discovery of solution', 'Measured relief, not euphoria'],
  },
  founder_story: {
    realism: 'high', polish: 'medium', rawness: 'medium', adIntensity: 'low',
    toneDirective: 'Personal and grounded. This is someone talking about why they built something. Vulnerable about the problem, passionate about the solution, honest about the journey.',
    pacingDirective: 'Story pacing. Beginning, middle, end. Allow the personal moment to land.',
    scriptDirective: 'Must include a personal struggle. The product should feel like a solution the founder needed for themselves first. "I created this because I couldn\'t find what I needed."',
    hookFilter: 'Start with the personal struggle, not the product. "Two years ago I was dealing with..." / "Nobody was making what I needed, so..."',
    presenterDirective: 'Founder energy — passionate but not preachy. Vulnerable but confident. Talking about something they care about deeply.',
    visualDirective: 'Behind-the-scenes feel. Lab, kitchen, office, or wherever the product was conceived. Not a studio — a real place with meaning.',
    avoidList: ['Corporate origin story', 'Revenue/growth bragging', 'Generic "I wanted to make something better"', 'Skipping the personal why'],
    authenticityMarkers: ['Personal struggle shared', 'Specific "aha moment"', 'Passion for the mission', 'Honest about challenges'],
  },
  social_proof: {
    realism: 'medium_high', polish: 'medium', rawness: 'medium', adIntensity: 'medium',
    toneDirective: 'Let the proof speak. Volume of evidence creates trust. Multiple voices, multiple angles, multiple data points.',
    pacingDirective: 'Rapid but not frantic. Each proof point gets 2-3 seconds. Build a sense of overwhelming evidence.',
    scriptDirective: 'Use real review quotes. Include specific numbers. Variety of voices and perspectives. "15,000 verified buyers" + specific review quotes + star rating.',
    hookFilter: 'Lead with the most impressive stat or quote. "This has a 4.8 star rating from 15,000 verified buyers."',
    presenterDirective: 'Multiple voices or compilation format. Not a single presenter lecturing about reviews.',
    visualDirective: 'Review screenshots, star ratings, customer photos. Montage style. Each shot is a proof point.',
    avoidList: ['Single-source proof', 'Fake-looking reviews', 'Unverifiable statistics', 'Only one type of proof'],
    authenticityMarkers: ['Specific review quotes', 'Variety of reviewers', 'Real screenshots', 'Verifiable numbers'],
  },
  lifestyle: {
    realism: 'high', polish: 'medium', rawness: 'medium', adIntensity: 'very_low',
    toneDirective: 'Aspirational but attainable. Show a life the viewer wants and can realistically have. Product is a natural part of it, not the hero.',
    pacingDirective: 'Relaxed, flowing pacing. No urgency. Let the lifestyle moment breathe.',
    scriptDirective: 'Minimal narration. If any, it should feel like internal monologue or casual reflection. Product mentioned naturally, not featured.',
    hookFilter: 'Visual hook only. The lifestyle itself stops the scroll. No verbal hooks — the aspirational moment IS the hook.',
    presenterDirective: 'Living their life, not presenting to camera. Candid, not performative.',
    visualDirective: 'Beautiful but real. Golden hour, morning routine, calm evening. Product appears naturally as part of the scene.',
    avoidList: ['Product-as-hero framing', 'Hard-sell energy', 'Unrealistic luxury', 'Ignoring the product entirely'],
    authenticityMarkers: ['Natural product integration', 'Believable environment', 'Aspirational but attainable', 'Candid energy'],
  },
  hook_viral: {
    realism: 'medium_high', polish: 'low', rawness: 'high', adIntensity: 'low',
    toneDirective: 'Maximum attention capture. Everything serves the hook. Native social energy — this should feel like content, not an ad.',
    pacingDirective: 'Fast opening, then earned engagement. The first 0.5 seconds is everything.',
    scriptDirective: 'Hook-first structure. The opening moment must be genuinely surprising. The rest must deliver on the promise.',
    hookFilter: 'This IS the hook format. The hook must be genuinely unexpected — not a copywriter hook, a content-creator hook.',
    presenterDirective: 'High energy, genuine surprise or conviction. Not performing — reacting or discovering.',
    visualDirective: 'First frame must visually disrupt the feed. Movement, unexpected visual, or bold visual statement.',
    avoidList: ['Clickbait without delivery', 'Hooks unrelated to product', 'Copywriter-style headlines as hooks', 'Slow build-ups'],
    authenticityMarkers: ['Genuine surprise or discovery', 'Content-native format', 'Fast scroll-stop moment', 'Delivers on the hook promise'],
  },
  educational: {
    realism: 'medium_high', polish: 'medium', rawness: 'medium', adIntensity: 'medium',
    toneDirective: 'Knowledgeable but accessible. Teaching, not lecturing. Share something genuinely interesting that the viewer did not know.',
    pacingDirective: 'Structured but conversational. Point-by-point but not robotic. Allow moments of "isn\'t that interesting?" energy.',
    scriptDirective: 'Teach one specific thing well. Use specific ingredient names, mechanisms, or facts. End with a natural product connection — do not force it.',
    hookFilter: 'Open with a surprising fact or misconception. "Most people don\'t know that..." / "Here\'s what your [product type] probably doesn\'t have..."',
    presenterDirective: 'Informed and curious, not preachy. Explaining to a friend, not lecturing to a class.',
    visualDirective: 'Can use text overlays for facts/ingredients. Clean but not sterile. Real person in real setting explaining something.',
    avoidList: ['Medical claims', 'Jargon without explanation', 'Pure lecture without engagement', 'Education without product tie-in'],
    authenticityMarkers: ['Specific verifiable fact', 'Accessible explanation', 'Genuine interest in the topic', 'Natural product connection'],
  },
  podcast_style: {
    realism: 'high', polish: 'medium', rawness: 'medium', adIntensity: 'low',
    toneDirective: 'Conversational and reflective. This is a discussion, not a presentation. Low pressure, high credibility.',
    pacingDirective: 'Relaxed, podcast-like pacing. Allow for thinking pauses. Not rushed. One key insight per clip.',
    scriptDirective: 'Write as spoken conversation, not polished copy. Use "I think", "what I\'ve found", "the interesting thing is". One memorable soundbite per clip.',
    hookFilter: 'Open with a contrarian or insightful statement. "Here\'s what most people get wrong about [topic]..." / "I get this question all the time..."',
    presenterDirective: 'Thoughtful, articulate, relaxed. Leaning in slightly. Not projecting — conversing.',
    visualDirective: 'Microphone visible. Clean background. Warm lighting. Professional but intimate setup.',
    avoidList: ['Hard-sell energy', '30-minute podcast format in a 20s clip', 'Rambling without a point', 'Scripted-sounding delivery'],
    authenticityMarkers: ['One clear memorable insight', 'Conversational rhythm', 'Professional but warm setting', 'Thoughtful pauses'],
  },
  routine: {
    realism: 'high', polish: 'medium_low', rawness: 'medium_high', adIntensity: 'low',
    toneDirective: 'This is someone showing their actual routine. Not performing a routine — living it. The product is one natural step.',
    pacingDirective: 'Real-time routine pacing. Each step gets enough time to feel genuine. No hyper-edited speed-through.',
    scriptDirective: 'Casual narration: "First I do this... then I take these... and then I..." Product is one step among several.',
    hookFilter: 'Open with the routine context: "My morning routine" / "What I actually do before bed" / "How I start my day now"',
    presenterDirective: 'Living the routine, not presenting it. Casual, slightly sleepy for morning, relaxed for evening.',
    visualDirective: 'Real environment — actual bathroom, actual kitchen. Multiple angles as they move through the space.',
    avoidList: ['Only one product in routine', 'Unrealistically perfect morning', 'Skipping the product moment', 'Staged-looking routine'],
    authenticityMarkers: ['Multiple routine steps', 'Real environment details', 'Product as natural part', 'Time-of-day context'],
  },
  comparison: {
    realism: 'medium_high', polish: 'medium', rawness: 'medium', adIntensity: 'medium_high',
    toneDirective: 'Factual and confident, not aggressive. Show the difference — do not trash the alternative. Let the comparison speak.',
    pacingDirective: 'Side-by-side pacing. Each comparison point gets equal time. Build to the conclusion.',
    scriptDirective: 'Compare on specific, verifiable dimensions: ingredients, dosage, price-per-serving. Use "ours vs typical" framing. Never name competitors.',
    hookFilter: 'Open with the comparison framing: "I compared the top 3 [products]" / "Not all [products] are the same. Here\'s why."',
    presenterDirective: 'Informed, fair, not preachy. Like a friend who did the research for you.',
    visualDirective: 'Side-by-side layout or sequential comparison. Clean, clear visual hierarchy.',
    avoidList: ['Naming competitors', 'False claims about alternatives', 'Aggressive/condescending tone', '"We\'re the best" without specifics'],
    authenticityMarkers: ['Specific comparison dimensions', 'Factual basis', 'Fair framing', 'Informed recommendation'],
  },
  myth_busting: {
    realism: 'medium_high', polish: 'medium_low', rawness: 'medium_high', adIntensity: 'low',
    toneDirective: 'Informed contrarian. "Most people think X, but actually Y." Not condescending — enlightening.',
    pacingDirective: 'Myth statement (2-3s) → pause → correction (5-8s) → product tie-in (3-5s). Let the correction land.',
    scriptDirective: 'State the myth clearly and believably. Correct it with a credible explanation. Connect naturally to the product.',
    hookFilter: 'The myth IS the hook. State it as if you used to believe it too. "I used to think [myth] until I learned..."',
    presenterDirective: 'Sharing a discovery, not lecturing. Genuine "I was surprised by this too" energy.',
    visualDirective: 'Can use text overlays for myth vs fact. Real person, real setting.',
    avoidList: ['Making up myths', 'Attacking people for believing the myth', 'Unsubstantiated corrections', 'Condescending tone'],
    authenticityMarkers: ['Genuine surprise at the correction', 'Credible explanation', 'Relatable "I thought so too" framing'],
  },
  pov_relatable: {
    realism: 'very_high', polish: 'low', rawness: 'high', adIntensity: 'very_low',
    toneDirective: 'Socially native. This must feel like content someone would actually post — not an ad pretending to be a POV. The relatability IS the content.',
    pacingDirective: 'Quick recognition, then payoff. The viewer should identify with the scenario in under 1 second.',
    scriptDirective: 'Minimal script. The scenario speaks for itself. If there is text, it is platform-native overlay ("me when...", "POV:", "that feeling when..."). Product discovery should feel organic.',
    hookFilter: 'The scenario IS the hook. Use trending POV formats. Must be immediately recognizable to 80%+ of target audience.',
    presenterDirective: 'Living the moment, not acting it. Reacting naturally. Subtle expressions. Not over-performing.',
    visualDirective: 'Phone-shot, raw, native. This should look exactly like organic social content. Zero production value beyond a phone camera.',
    avoidList: ['"Ad pretending to be POV"', 'Forced relatability', 'Niche scenarios', 'Over-acting the scenario', 'Product placement that breaks the POV'],
    authenticityMarkers: ['Instant recognition', 'Platform-native format', 'Organic product discovery', 'Feels like real content, not paid ad'],
  },
  product_stack: {
    realism: 'high', polish: 'medium_high', rawness: 'medium', adIntensity: 'medium_high',
    toneDirective: 'Excited, deal-focused energy. Like someone who just discovered an incredible deal and has to share it. Short, punchy, offer-driven.',
    pacingDirective: 'Fast and punchy. Show the product stack immediately. Announce the offer within 3 seconds. The entire video is about the deal — no buildup needed.',
    scriptDirective: 'Ultra-short offer script. 2-3 sentences max. "Buy one, get one free!" / "Stock up while you can." / "Use code X for Y% off." No storytelling — just the deal.',
    hookFilter: 'The stack of products IS the hook. Multiple products = perceived value. Open with the visual of 3-5 products together.',
    presenterDirective: 'FACELESS. Hands only — arranging, stacking, touching, or picking up products. No face, no body above wrists. Clean, well-lit hands.',
    visualDirective: 'Clean surface (marble, wood, white). Top-down or 45-degree angle. Products stacked, fanned, or pyramid-arranged. Hands entering frame to arrange. Good lighting highlighting product labels.',
    avoidList: ['Face visible', 'Single product only', 'Cluttered background', 'Long monologue', 'Storytelling arc'],
    authenticityMarkers: ['Multiple products visible', 'Clean arrangement', 'Hands-only presenter', 'Clear offer announcement', 'Deal urgency'],
  },
};

/** Get the format realism directive for a creative type, filtered by hook and avatar style */
export function getFormatRealismDirective(creativeType: string, hookStyle: string, avatarStyle: string): string {
  const fr = FORMAT_REALISM[creativeType] || FORMAT_REALISM.testimonial;
  const parts = [
    `FORMAT REALISM [${fr.realism} realism, ${fr.polish} polish, ${fr.rawness} rawness]:`,
    `TONE: ${fr.toneDirective}`,
    `PACING: ${fr.pacingDirective}`,
    `SCRIPT: ${fr.scriptDirective}`,
    `HOOK FILTER (${hookStyle}): ${fr.hookFilter}`,
    `PRESENTER: ${fr.presenterDirective}`,
    `VISUAL: ${fr.visualDirective}`,
    `AVOID: ${fr.avoidList.join('; ')}`,
    `AUTHENTICITY: ${fr.authenticityMarkers.join('; ')}`,
  ];
  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════
// LAYER 3 — SELECTION-TO-STRATEGY MAPPING
// ═══════════════════════════════════════════════════════

export interface CreativeIntent {
  creativeDefinition: string;
  funnelDefinition: string;
  hookDefinition: string;
  presenterDefinition: string;
  formatDirectives: string;
  messagingDirectives: string;
  visualDirectives: string;
  ctaDirectives: string;
  performanceDirectives: string;
  policyDirectives: string;
  variationDirectives: string;
  accountOptimizationNotes: string;
  audioDirectives: string;
  realismDirectives: string;
  productIdentityDirectives: string;
  formatRealismDirectives: string;
  platformDirectives: string;
}

export function buildCreativeIntent(config: {
  contentType: string;
  creativeType: string;
  funnelStage: string;
  hookStyle: string;
  avatarStyle: string;
  generationGoal: string;
  platformTarget?: string;
  product?: { title: string; description?: string; category?: string; priceCents?: number } | null;
  offer?: string;
  accountInsights?: { avgRoas?: number; avgCtr?: number; avgCpa?: number; learnedWins?: string[]; learnedLosses?: string[]; fatiguedNames?: string[] } | null;
}): CreativeIntent {
  const ct = CONTENT_TYPES[config.contentType] || CONTENT_TYPES.video;
  const cr = CREATIVE_TYPES[config.creativeType] || CREATIVE_TYPES.testimonial;
  const fs = FUNNEL_STAGES[config.funnelStage] || FUNNEL_STAGES.tof;
  const hs = HOOK_STYLES[config.hookStyle] || HOOK_STYLES.curiosity;
  const av = AVATAR_STYLES[config.avatarStyle] || AVATAR_STYLES.female_ugc;
  const gg = GENERATION_GOALS[config.generationGoal] || GENERATION_GOALS.new_concept;
  const insights = config.accountInsights;

  const creativeDefinition = `CREATIVE TYPE: ${cr.label}\n${cr.definition}\nUse case: ${cr.useCase}\nOutput requirements: ${cr.outputRequirements}\nAnti-patterns: ${cr.antiPatterns}`;

  const funnelDefinition = `FUNNEL STAGE: ${fs.label}\n${fs.definition}\nCTA style: ${fs.ctaStyle}\nProof level: ${fs.proofLevel}\nUrgency level: ${fs.urgencyLevel}\nCopy density: ${fs.copyDensity}\nHook timing: ${fs.hookTiming}`;

  const hookDefinition = `HOOK STYLE: ${hs.label}\n${hs.definition}\nOpening behavior: ${hs.openingBehavior}\nExample formats:\n${hs.exampleFormats.map(e => `  - ${e}`).join('\n')}`;

  const presenterDefinition = `PRESENTER: ${av.label}\n${av.definition}\nCasting notes: ${av.castingNotes}\nDelivery style: ${av.deliveryStyle}`;

  const formatDirectives = config.contentType === 'video'
    ? `FORMAT: Vertical video (9:16)\n${META_PERFORMANCE_KB.video.bestPractices.map(r => `- ${r}`).join('\n')}`
    : `FORMAT: Static image\n${META_PERFORMANCE_KB.image.bestPractices.map(r => `- ${r}`).join('\n')}`;

  const funnelPlaybook = META_PERFORMANCE_KB.funnelPlaybook[config.funnelStage as keyof typeof META_PERFORMANCE_KB.funnelPlaybook];
  const ugcBeats = config.contentType === 'video' ? META_PERFORMANCE_KB.ugcScriptStructure.shortVersion : null;
  const playbookSection = funnelPlaybook ? `\nFUNNEL PLAYBOOK (${fs.label}):\n${config.contentType === 'video' ? `- Video ideas to draw from: ${funnelPlaybook.videoIdeas.join(', ')}` : `- Image ideas to draw from: ${funnelPlaybook.imageIdeas.join(', ')}`}\n- Copy style prompts: ${funnelPlaybook.copyPrompts.join(' | ')}\n- KPI targets: ${funnelPlaybook.kpiTargets}` : '';
  const scriptSection = ugcBeats ? `\nSCRIPT STRUCTURE (follow this beat map):\n${ugcBeats.map(b => `- ${b.name} (${b.timing}): ${b.rule}`).join('\n')}` : '';
  const messagingDirectives = `MESSAGING RULES:\n- Hook timing: ${META_PERFORMANCE_KB.hooks.timing}\n- Content must serve the ${fs.label} intent: ${fs.definition.split('.')[0]}\n- Creative type behavior: ${cr.outputRequirements}${playbookSection}${scriptSection}`;

  const visualDirectives = `VISUAL RULES:\n- ${META_PERFORMANCE_KB.mobile.assumption}\n- Placement awareness:\n  Feed: ${META_PERFORMANCE_KB.placements.feed}\n  Reels: ${META_PERFORMANCE_KB.placements.reels}`;

  const ctaDirectives = `CTA: ${fs.ctaStyle}`;

  const performanceDirectives = `PERFORMANCE OPTIMIZATION:\n- ${META_PERFORMANCE_KB.variation.principles.map(p => `- ${p}`).join('\n')}\n- Fatigue prevention: ${META_PERFORMANCE_KB.fatigue.prevention}`;

  const policyRules = [
    ...META_PERFORMANCE_KB.policy.supplements,
    ...META_PERFORMANCE_KB.policy.beauty,
    ...META_PERFORMANCE_KB.policy.general,
  ];
  const policyDirectives = `POLICY GUARDRAILS:\n${policyRules.map(r => `- ${r}`).join('\n')}`;

  const variationDirectives = `GENERATION GOAL: ${gg.label}\n${gg.definition}\nBehavior: ${gg.promptBehavior}\nAnti-patterns: ${gg.antiPatterns}`;

  // Account-specific optimization (Layer 5: optimizer, not definer)
  const acctNotes: string[] = [];
  if (insights?.avgRoas) acctNotes.push(`Account avg ROAS: ${insights.avgRoas}x — ${insights.avgRoas > 2 ? 'strong performance, push for scale' : insights.avgRoas > 1 ? 'profitable but room to improve' : 'below breakeven, prioritize hook testing'}.`);
  if (insights?.avgCtr) acctNotes.push(`Account avg CTR: ${insights.avgCtr}% — ${insights.avgCtr > 3 ? 'hooks are working, optimize for conversion' : 'hooks need improvement, prioritize scroll-stopping openers'}.`);
  if (insights?.learnedWins?.length) acctNotes.push(`PROVEN WINNERS (double down):\n${insights.learnedWins.map(w => `  ✓ ${w}`).join('\n')}`);
  if (insights?.learnedLosses?.length) acctNotes.push(`PROVEN LOSERS (avoid):\n${insights.learnedLosses.map(l => `  ✗ ${l}`).join('\n')}`);
  if (insights?.fatiguedNames?.length) acctNotes.push(`FATIGUED (avoid similar angles): ${insights.fatiguedNames.join(', ')}`);
  // Product info is passed in the user prompt — only include name here as a reference
  if (config.product) {
    acctNotes.push(`PRODUCT: ${config.product.title}${config.offer ? ` | Offer: ${config.offer}` : ''}`);
  }
  const accountOptimizationNotes = acctNotes.length > 0
    ? `ACCOUNT-SPECIFIC OPTIMIZATION (use to refine, not redefine):\n${acctNotes.join('\n\n')}`
    : 'No account data available. Use best practices for supplements & beauty.';

  const formatRealismDirectives = getFormatRealismDirective(config.creativeType, config.hookStyle, config.avatarStyle);

  const plat = PLATFORM_TARGETS[config.platformTarget || 'meta'] || PLATFORM_TARGETS.meta;
  const platformDirectives = `PLATFORM: ${plat.label}\n${plat.definition}\nVisual: ${plat.visualExecution}\nPacing: ${plat.pacingExecution}\nHook: ${plat.hookExecution}\nCTA: ${plat.ctaExecution}\nCaptions: ${plat.captionExecution}\nAudio: ${plat.audioExecution}\nRealism: ${plat.realismModifier}\nFormat: ${plat.formatSpec}`;

  const audioDirectives = `AUDIO — MANDATORY:\n${META_PERFORMANCE_KB.audio.rules.map(r => `- ${r}`).join('\n')}`;

  const realismDirectives = `REALISM — MANDATORY:\n${META_PERFORMANCE_KB.realism.rules.map(r => `- ${r}`).join('\n')}${config.contentType === 'video' ? `\nUGC DELIVERY:\n${META_PERFORMANCE_KB.realism.ugcDelivery.map(r => `- ${r}`).join('\n')}` : ''}`;

  const productIdentityDirectives = config.product
    ? `PRODUCT IDENTITY — HARD REQUIREMENT:\n${META_PERFORMANCE_KB.productIdentity.rules.map(r => `- ${r}`).join('\n')}\nSHOT COMPOSITION FOR PRODUCT:\n${META_PERFORMANCE_KB.productIdentity.shotComposition.map(r => `- ${r}`).join('\n')}\nTHIS PRODUCT: "${config.product.title}" — every scene must show THIS exact product, not a generic substitute. The provided reference image is the source of truth for branding.`
    : `PRODUCT IDENTITY:\n${META_PERFORMANCE_KB.productIdentity.rules.map(r => `- ${r}`).join('\n')}`;

  return {
    creativeDefinition, funnelDefinition, hookDefinition, presenterDefinition,
    formatDirectives, messagingDirectives, visualDirectives, ctaDirectives,
    performanceDirectives, policyDirectives, variationDirectives, accountOptimizationNotes,
    audioDirectives, realismDirectives, productIdentityDirectives, formatRealismDirectives, platformDirectives,
  };
}

// ═══════════════════════════════════════════════════════
// LAYER 4 — GENERATION CONTRACT
// ═══════════════════════════════════════════════════════

/**
 * Build a compact generation contract for fast-draft mode.
 * Includes only the directives that directly affect output quality.
 * Drops: performance principles, variation testing theory, full placement specs, hook timing theory.
 * Keeps: creative definition, funnel rules, hook behavior, presenter style, policy, output schema.
 */
export function buildFastContract(intent: CreativeIntent, contentType: string, quantity: number, funnelStage?: string, videoDuration?: number): string {
  const playbook = META_PERFORMANCE_KB.funnelPlaybook[(funnelStage || 'tof') as keyof typeof META_PERFORMANCE_KB.funnelPlaybook];
  const dur = videoDuration || 20;
  const budget = getDurationBudget(dur);
  const videoOutputSpec = `Each video package JSON: { "title": "max 60 chars", "angle": "5-10 words", "hook": "exact opening words (max ${budget.beats[0].maxWords} words)", "script": "EXACT spoken script for ${dur}s, ${budget.minWords}-${budget.maxWords} words total. CTA at end must fit ${budget.ctaMaxWords} words. Stage directions in [brackets] don't count.", "sceneStructure": "second-by-second", "visualDirection": "camera, lighting, setting", "brollDirection": "3-5 shots", "presenterBehavior": "delivery style", "pacingNotes": "edit rhythm", "cta": "exact CTA, max ${budget.ctaMaxWords} words", "adCopy": "Facebook text 3-8 sentences", "headline": "max 40 chars", "variants": ["3 one-line variations"] }`;
  const imageOutputSpec = `Each image package JSON: { "title": "max 60 chars", "angle": "5-10 words — the specific selling angle, not generic", "imageFormat": "one of: testimonial_image, review_stack, offer_stack, before_after, product_highlight, problem_solution, comparison, social_proof_stats, ugc_style_still, authority_claim", "headline": "max 8 words, bold, specific, scroll-stopping — NOT generic ('Discover the hype'). Must name the benefit or create urgency", "subheadline": "max 15 words, supports headline with proof or specificity", "hookText": "the scroll-stopping text overlay max 10 words — this is the MOST important element. Must be specific, believable, and create curiosity or recognition. Strong examples: 'I didn't think this would work', '4.8 stars from 15,000 buyers', 'Why so many people keep reordering this'. Weak examples to AVOID: 'Discover the hype', 'Learn more', 'Why it works'", "proofElement": "SPECIFIC proof: exact review quote with customer name, exact stat with number, exact before/after timeframe, exact ingredient with dosage, exact certification. NOT vague ('social proof' or 'customer reviews')", "productPlacement": "where product appears (center, right-side, bottom, top-right overlay, split-view)", "ctaText": "exact CTA text matching funnel: TOF='See Why People Love It', MOF='Read the Reviews', BOF='Shop Now — 40% OFF'", "ctaPlacement": "bottom-center, bottom-right, or text-overlay", "visualComposition": "layout: top=hook zone, center=proof+product zone, bottom=CTA zone. Specify ratio (1:1 for Meta feed, 9:16 for TikTok). Colors and background.", "colorScheme": {"background": "#hex", "textPrimary": "#hex", "accent": "#hex for CTA"}, "offerPlacement": "where price/discount appears if applicable — must include actual numbers", "textOverlays": [{"text": "exact text", "position": "top/center/bottom", "fontSize": "48px/36px/24px", "fontWeight": "bold/regular", "color": "#hex"}], "adCopy": "platform primary text 3-8 sentences — specific benefits not generic claims", "variants": ["3-5 variations — each MUST change a DIFFERENT element: hook angle, proof type, format type, CTA urgency, or emotional framing. Not just wording tweaks."] }`;

  // Compact creative + funnel definition (strip useCase/antiPatterns to save tokens)
  const cr = CREATIVE_TYPES[Object.keys(CREATIVE_TYPES).find(k => intent.creativeDefinition.includes(CREATIVE_TYPES[k].label)) || 'testimonial'];
  const compactCreative = `TYPE: ${cr.label}. ${cr.definition} Requirements: ${cr.outputRequirements}`;

  return `Elite creative director for supplements & beauty on Meta. ${contentType === 'video' ? `9:16 vertical video, ${dur}s.` : 'Static image 1080x1080 or 4:5.'}

${compactCreative}

${intent.funnelDefinition}

${intent.hookDefinition}

PRESENTER: ${intent.presenterDefinition.split('\n').slice(0, 2).join('. ')}

${intent.formatRealismDirectives}

PLATFORM: ${intent.platformDirectives.split('\n').slice(0, 3).join('. ')}

RULES: Show ONLY the exact product specified — no generics.
${contentType === 'video' ? `NO music/soundtrack — voice + room tone only.\n\n${buildDurationDirective(dur)}` : `IMAGE DR FRAMEWORK: Every static ad MUST follow HOOK → PROOF → PRODUCT → CTA hierarchy. Hook must be specific and scroll-stopping (not generic). Proof must be concrete (exact quote, exact stat, exact timeframe). CTA must match funnel stage. AVOID: vague headlines, abstract concepts, pretty-but-non-selling layouts, generic hooks like "Discover the hype" or "Learn more". For supplements/beauty: show the actual bottle, name the specific benefit, use believable proof.`}

POLICY: No "cure/treat/prevent". Use "supports/helps/promotes". No fake reviews.

${intent.accountOptimizationNotes}

OUTPUT: ${contentType === 'video' ? videoOutputSpec : imageOutputSpec}
Return: { "packages": [${quantity} objects] }. Each unique angle.`;
}

export function buildGenerationContract(intent: CreativeIntent, contentType: string, quantity: number, videoDuration?: number): string {
  const dur = videoDuration || 20;
  const budget = getDurationBudget(dur);
  const videoOutputSpec = `For EACH video package, return exactly this JSON structure:
{
  "title": "max 60 chars — descriptive creative title",
  "angle": "core marketing angle in 5-10 words",
  "hook": "EXACT opening line/moment word-for-word (first 1-3 seconds). MAX ${budget.beats[0].maxWords} spoken words. This is the most important element.",
  "script": "Full ${dur}s script with [speaker directions]. EXACT dialogue, ${budget.minWords}-${budget.maxWords} spoken words total (target ${budget.targetWords}). Stage directions in [brackets] are not counted. CTA must fit in last ${budget.ctaReserveSeconds}s using max ${budget.ctaMaxWords} words.",
  "sceneStructure": "Second-by-second breakdown showing what happens in each time block. Must align with the funnel stage timing rules.",
  "visualDirection": "Camera angles, lighting, setting, wardrobe, props — detailed enough to shoot from this brief alone.",
  "brollDirection": "3-5 specific B-roll shots with exact descriptions of what is shown.",
  "presenterBehavior": "How the presenter looks, acts, and delivers based on the avatar definition above. Specific gestures, expressions, energy level.",
  "pacingNotes": "Edit rhythm, cut frequency, energy arc throughout the video.",
  "cta": "Exact CTA text and delivery style. Must match the funnel stage CTA rules above.",
  "adCopy": "Facebook primary text (3-8 sentences). Must match the copy density rules for this funnel stage. Include formatting and emojis consistent with Meta native content.",
  "headline": "Facebook ad headline, max 40 chars.",
  "variants": ["3-5 one-line descriptions of variations, each specifying WHAT changes (hook, emotion, CTA, structure)."]
}`;

  const imageOutputSpec = `For EACH image package, return exactly this JSON structure:
{
  "title": "max 60 chars — specific creative title, not generic",
  "angle": "core marketing angle in 5-10 words — the specific selling proposition",
  "imageFormat": "MUST be one of: testimonial_image, review_stack, offer_stack, before_after, product_highlight, problem_solution, comparison, social_proof_stats, ugc_style_still, authority_claim",
  "headline": "Bold headline, max 8 words. Must stop scroll at thumbnail size. MUST be specific and benefit-driven. Strong: 'I Stopped Waking Up Exhausted'. Weak: 'Discover the Difference'. Name the benefit or the problem solved.",
  "subheadline": "Supporting line, max 15 words. Adds proof or specificity to the headline.",
  "hookText": "The scroll-stopping text overlay, max 10 words. This is the FIRST thing the viewer reads and the MOST important element of the ad. Must create instant recognition, curiosity, or credibility. Strong examples: 'I didn't expect results this fast', '4.8 stars from 15,000 buyers', 'Why so many people keep reordering this', 'My skin changed in 2 weeks'. AVOID generic hooks: 'Discover the hype', 'Learn more', 'Why it works', 'Check this out'.",
  "proofElement": "SPECIFIC proof element — not a category, but the actual content. Examples: '\"After 2 weeks my energy completely changed\" — Sarah M., Verified Buyer', '4.8 stars from 12,847 verified reviews', 'Visible improvement after 14 days in clinical trial', '3rd-party tested for purity and potency'. Do NOT write vague proof like 'customer reviews' or 'social proof'.",
  "productPlacement": "Where the product image appears: center, right-side, bottom, top-right overlay, or split-view.",
  "conceptAngle": "Why this specific image format and angle works for this funnel stage. What makes it convert.",
  "visualComposition": "Exact layout blueprint: top zone (10-25%) = hook text, center zone (25-70%) = proof + product, bottom zone (75-90%) = CTA + offer. Specify ratio (1:1 for Meta feed, 4:5 for Meta tall, 9:16 for TikTok/Stories). Colors, background treatment. Under 20% text coverage.",
  "textOverlays": [
    {"text": "exact text string", "position": "top|center|bottom", "fontSize": "48px|36px|24px", "fontWeight": "bold|regular", "color": "#hex color code"}
  ],
  "offerPlacement": "Where price/discount/bundle info appears with actual numbers. Example: 'Top-right badge: SAVE $47 — strikethrough $79, bold $32/bottle'. Not just 'discount shown'.",
  "ctaText": "Exact CTA button text. TOF: 'See Why People Love It', 'Learn More'. MOF: 'Read the Reviews', 'See How It Works'. BOF: 'Shop Now — 40% OFF', 'Claim Your Bundle', 'Get Started Today'.",
  "ctaPlacement": "bottom-center (Meta button style), bottom-right, or text-overlay (TikTok casual). Style: button for Meta, text for TikTok.",
  "colorScheme": {"background": "#hex", "textPrimary": "#hex", "accent": "#hex for CTA and key numbers"},
  "adCopy": "Facebook/TikTok primary text (3-8 sentences). Must be specific — name the product, name the benefit, include proof. Not generic category copy.",
  "variants": ["3-5 variations — each MUST change a DIFFERENT testable element: hook angle (different emotional trigger), proof type (review vs stat vs before/after), format type (switch to a different imageFormat), CTA urgency level, or emotional framing. Not minor wording tweaks — genuinely testable creative variations."]
}`;

  return `═══ GENERATION CONTRACT ═══

You MUST follow every directive below. These are not suggestions — they are the contract.

${intent.creativeDefinition}

${intent.funnelDefinition}

${intent.hookDefinition}

${intent.presenterDefinition}

${intent.formatRealismDirectives}

${intent.platformDirectives}

${intent.audioDirectives}

${intent.realismDirectives}

${intent.productIdentityDirectives}

${intent.formatDirectives}

${contentType === 'video' ? buildDurationDirective(dur) : ''}

${intent.messagingDirectives}

${intent.visualDirectives}

${intent.ctaDirectives}

${intent.performanceDirectives}

${intent.policyDirectives}

${intent.variationDirectives}

${intent.accountOptimizationNotes}

═══ OUTPUT FORMAT ═══

${contentType === 'video' ? videoOutputSpec : imageOutputSpec}

Return: { "packages": [${quantity} package objects] }
Each package must test a genuinely different angle or approach. No recycled concepts.`;
}

// ═══════════════════════════════════════════════════════
// LAYER 6 — VALIDATION
// ═══════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateGeneratorInputs(config: {
  contentType: string;
  creativeType: string;
  funnelStage: string;
  hookStyle: string;
  avatarStyle: string;
  generationGoal: string;
  quantity: number;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate all IDs exist in taxonomy
  if (!CONTENT_TYPES[config.contentType]) errors.push(`Invalid content type: ${config.contentType}`);
  if (!CREATIVE_TYPES[config.creativeType]) errors.push(`Invalid creative type: ${config.creativeType}`);
  if (!FUNNEL_STAGES[config.funnelStage]) errors.push(`Invalid funnel stage: ${config.funnelStage}`);
  if (!HOOK_STYLES[config.hookStyle]) errors.push(`Invalid hook style: ${config.hookStyle}`);
  if (!AVATAR_STYLES[config.avatarStyle]) errors.push(`Invalid avatar style: ${config.avatarStyle}`);
  if (!GENERATION_GOALS[config.generationGoal]) errors.push(`Invalid generation goal: ${config.generationGoal}`);
  if (config.quantity < 1 || config.quantity > 10) errors.push('Quantity must be 1-10');

  if (errors.length > 0) return { valid: false, warnings, errors };

  const cr = CREATIVE_TYPES[config.creativeType];
  const fs = FUNNEL_STAGES[config.funnelStage];
  const hs = HOOK_STYLES[config.hookStyle];

  // Funnel fit warnings
  if (!cr.bestFunnelFit.includes(config.funnelStage)) {
    warnings.push(`${cr.label} is not ideal for ${fs.label}. Best fit: ${cr.bestFunnelFit.join(', ').toUpperCase()}. Proceeding with your selection but results may underperform.`);
  }

  // Hook + funnel alignment
  if (config.funnelStage === 'bof' && config.hookStyle === 'curiosity') {
    warnings.push('Curiosity hooks are suboptimal for BOF — audience already knows the product. Consider pattern_interrupt or authority.');
  }
  if (config.funnelStage === 'tof' && config.hookStyle === 'authority') {
    warnings.push('Authority hooks may underperform at TOF where audience prefers native/relatable content. Consider curiosity or relatable.');
  }

  // Avatar + creative type alignment
  if (config.creativeType === 'b_roll' && config.avatarStyle !== 'faceless_product_only') {
    warnings.push('B-Roll creative type is product-only by definition. Switching presenter to faceless/product-only.');
  }
  if (config.creativeType === 'podcast_style' && config.avatarStyle === 'faceless_product_only') {
    warnings.push('Podcast style requires a presenter. Consider expert_authority or podcast_host.');
  }

  // Content type + creative type alignment
  if (config.contentType === 'image' && ['podcast_style', 'routine', 'b_roll'].includes(config.creativeType)) {
    warnings.push(`${cr.label} works best as video. Image format may limit this creative type's effectiveness.`);
  }

  return { valid: true, warnings, errors };
}

// ═══════════════════════════════════════════════════════
// MULTI-IMAGE USAGE STRATEGY
// ═══════════════════════════════════════════════════════

export interface ImageUsagePlan {
  imageCount: number;
  plan: { imageIndex: number; usage: string; timing: string }[];
  promptDirective: string;
}

export function buildProductImagePlan(imageCount: number, creativeType: string, contentType: string): ImageUsagePlan {
  if (imageCount <= 1 || contentType === 'image') {
    return {
      imageCount,
      plan: imageCount > 0 ? [{ imageIndex: 0, usage: 'Hero product shot', timing: 'Throughout' }] : [],
      promptDirective: imageCount > 0 ? 'Use the provided product image as the hero visual reference.' : '',
    };
  }

  // Multi-image plans per creative type
  const plans: Record<string, { imageIndex: number; usage: string; timing: string }[]> = {
    testimonial: [
      { imageIndex: 0, usage: 'Hero product recognition — front-facing hero shot', timing: '0-3s intro + 18-20s close' },
      { imageIndex: 1, usage: 'Product held in hand by presenter', timing: '8-12s demo moment' },
      { imageIndex: Math.min(2, imageCount - 1), usage: 'Product in lifestyle context (counter, shelf, routine)', timing: '5-8s context scene' },
    ],
    b_roll: [
      { imageIndex: 0, usage: 'Opening hero shot — front-facing product reveal', timing: '0-3s' },
      { imageIndex: 1, usage: 'Detail angle — cap, texture, label from side', timing: '3-6s' },
      { imageIndex: Math.min(2, imageCount - 1), usage: 'Product in environment — counter, shelf, bathroom', timing: '6-10s' },
      { imageIndex: Math.min(3, imageCount - 1), usage: 'Usage moment — pouring, opening, applying', timing: '10-15s' },
      { imageIndex: 0, usage: 'Final hero callback — same as opening for brand lock', timing: '18-20s' },
    ],
    product_demo: [
      { imageIndex: 0, usage: 'Product reveal — unboxing or first appearance', timing: '0-5s' },
      { imageIndex: 1, usage: 'Product in hand — showing size, texture, packaging details', timing: '5-10s' },
      { imageIndex: Math.min(2, imageCount - 1), usage: 'Product in use — application, consumption, demo', timing: '10-18s' },
    ],
    before_after: [
      { imageIndex: 0, usage: 'Product identification — what they are using', timing: '0-3s intro' },
      { imageIndex: 1, usage: 'Product in the routine — usage moment', timing: '8-12s' },
      { imageIndex: 0, usage: 'Product as the solution — hero callback', timing: '18-20s results' },
    ],
    routine: [
      { imageIndex: 0, usage: 'Step 1 — product introduction in routine', timing: '0-5s' },
      { imageIndex: 1, usage: 'Step 2 — product application or consumption', timing: '5-10s' },
      { imageIndex: Math.min(2, imageCount - 1), usage: 'Step 3 — product in context with other routine items', timing: '10-15s' },
    ],
    comparison: [
      { imageIndex: 0, usage: 'Your product — hero shot', timing: 'Throughout (winner side)' },
      { imageIndex: 1, usage: 'Detail shot showing differentiator (label, ingredients)', timing: '8-12s comparison moment' },
    ],
  };

  // Default plan for creative types not listed above
  const defaultPlan = [
    { imageIndex: 0, usage: 'Primary hero product shot — front-facing recognition', timing: '0-3s intro + 18-20s close' },
    { imageIndex: 1, usage: 'Product detail or alternate angle', timing: '8-12s mid-section' },
    { imageIndex: Math.min(2, imageCount - 1), usage: 'Product in lifestyle context', timing: '5-8s or 15-17s' },
  ];

  const plan = plans[creativeType] || defaultPlan;
  // Clamp all indices to available image count
  const clampedPlan = plan.map(p => ({ ...p, imageIndex: Math.min(p.imageIndex, imageCount - 1) }));

  const directive = `MULTI-IMAGE PRODUCT USAGE (${imageCount} images provided):
Use ALL provided product images across different scenes — do not repeat only 1 image.
${clampedPlan.map((p, i) => `- Scene ${i + 1} (${p.timing}): Image #${p.imageIndex + 1} — ${p.usage}`).join('\n')}
Maintain consistent branding across all images. Each image shows a different angle or context of the same product.
Do NOT ignore available images. Do NOT use only the first image for every scene.`;

  return { imageCount, plan: clampedPlan, promptDirective: directive };
}

/**
 * Build a format-specific, platform-aware DALL-E render directive for a static ad image.
 * This replaces the generic "create a professional ad" prompt with a structured DR prompt.
 */
/**
 * Build a natural-language image generation prompt optimized for Nano Banana 2,
 * Stability, and Ideogram. Follows the Alex Cooper / fal.ai prompting framework:
 *
 *   Subject → Composition → Action → Environment → Lighting → Style
 *
 * Key rules (from Nano Banana 2 docs + Alex Cooper):
 * - Write natural language sentences, NOT comma-separated keywords
 * - No quality boosters ("masterpiece", "best quality", "trending on ArtStation")
 * - Wrap ALL visible text in "double quotes" with individual style specs
 * - Keep general images to 1-3 sentences; text-heavy ads can be longer
 * - Use camera terminology ("85mm lens", "shallow depth of field")
 */
export function buildImageRenderDirective(pkg: {
  imageFormat?: string;
  headline?: string;
  hookText?: string;
  proofElement?: string;
  productPlacement?: string;
  ctaText?: string;
  ctaPlacement?: string;
  visualComposition?: string;
  offerPlacement?: string;
  colorScheme?: { background?: string; textPrimary?: string; accent?: string };
  textOverlays?: { text: string; position: string; fontSize: string; fontWeight: string; color: string }[];
  angle?: string;
  conceptAngle?: string;
}, options: {
  productName?: string;
  platform?: string;
  funnelStage?: string;
  hasReferenceImage?: boolean;
  engine?: string;
} = {}): string {
  const format = pkg.imageFormat || 'product_highlight';
  const platform = options.platform || 'meta';
  const funnel = options.funnelStage || 'mof';
  const product = options.productName || 'the product';
  const isTikTok = platform === 'tiktok';
  const isIdeogram = options.engine === 'ideogram';

  // ═══════════════════════════════════════════════════════════
  // IDEOGRAM PATH — concept-led visuals, NO product bottle/jar
  // ═══════════════════════════════════════════════════════════
  if (isIdeogram) {
    return buildIdeogramConceptPrompt(pkg, { productName: product, platform, funnelStage: funnel, isTikTok });
  }

  // ═══════════════════════════════════════════════════════════
  // HIGH-PERFORMANCE DIRECT-RESPONSE STATIC
  //
  // TWO MODES:
  //   NANO BANANA (engine=nano-banana): Model-driven composition.
  //     Pass product image as reference. Model decides layout, placement,
  //     hierarchy, spacing. We only give concept + copy + style guidance.
  //
  //   STABILITY / DALLE / OTHER: Background-only generation.
  //     Product composited afterward via the composite pipeline.
  // ═══════════════════════════════════════════════════════════

  const hookText = pkg.hookText || pkg.headline || '';
  const ctaText = pkg.ctaText || (isTikTok ? 'link in bio' : 'Shop Now');
  const accent = pkg.colorScheme?.accent || '#4F46E5';
  const isNanoBanana = options.engine === 'nano-banana';

  const parts: string[] = [];

  if (isNanoBanana) {
    // ═══ NANO BANANA: MODEL-DRIVEN COMPOSITION ═══
    // The model handles layout, placement, hierarchy. We provide:
    // product reference image, concept, copy, style guidance. That's it.
    parts.push(`Create a high-converting Facebook static ad.`);
    parts.push(`Use the provided product image naturally within the design.`);
    parts.push('');
    parts.push('The product must:');
    parts.push('- be clearly visible and recognizable');
    parts.push('- be integrated into the layout naturally (not pasted or floating)');
    parts.push('- match the lighting and perspective of the scene');
    parts.push('- feel like part of a professionally designed ad');
    parts.push('');
    parts.push('Ad style:');
    parts.push('- modern DTC brand aesthetic');
    parts.push('- clean composition with strong visual hierarchy');
    parts.push('- optimized for mobile feed (thumb-stopping)');
    parts.push('- high contrast, conversion-focused');
    parts.push('');
    if (hookText) {
      parts.push(`Hook: "${hookText}" — large bold text, dominant, readable at thumbnail size`);
    }
    if (pkg.proofElement) {
      parts.push(`Proof: "${pkg.proofElement}" — supporting text near the product`);
    }
    parts.push(`CTA: "${ctaText}" — ${isTikTok ? 'casual text at bottom' : `bold button in ${accent} at bottom`}`);
    if (pkg.offerPlacement && pkg.offerPlacement !== 'No offer specified') {
      parts.push(`Offer: "${pkg.offerPlacement}"`);
    }
    parts.push('');
    parts.push('Avoid:');
    parts.push('- floating product cutouts with white box backgrounds');
    parts.push('- awkward or unnatural product placement');
    parts.push('- product covering important text');
    parts.push('- dead center symmetrical composition');
    parts.push('- abstract or artistic compositions that don\'t convert');
  } else {
    // ═══ STABILITY / DALLE / OTHER: BACKGROUND-ONLY GENERATION ═══
    // Product gets composited afterward. This prompt generates the layout without product.
    parts.push(`Create a high-converting ${isTikTok ? 'TikTok' : 'Meta/Facebook'} direct-response ad static.`);
    parts.push('');
    parts.push('TOP SECTION:');
    if (hookText) {
      parts.push(`- "${hookText}" as the dominant headline in large bold sans-serif`);
    } else {
      parts.push('- Large bold hook headline — short, punchy, direct-response');
    }
    parts.push('- Largest text element, readable at mobile thumbnail, high contrast');
    parts.push('');
    parts.push('CENTER SECTION:');
    if (options.hasReferenceImage) {
      parts.push('- Leave clean space for the product photo (will be composited afterward)');
      parts.push('- Do NOT draw any product bottle, jar, or packaging');
    } else {
      parts.push(`- Visual anchor for "${product}"`);
    }
    if (pkg.proofElement) {
      parts.push(`- "${pkg.proofElement}" as supporting proof text`);
    }
    parts.push('');
    parts.push('BOTTOM SECTION:');
    parts.push(`- "${ctaText}" ${isTikTok ? 'as casual text' : `inside bold ${accent} button`}`);
    if (pkg.offerPlacement && pkg.offerPlacement !== 'No offer specified') {
      parts.push(`- "${pkg.offerPlacement}" as urgency badge`);
    }
  }

  parts.push('');

  // ═══ SHARED STYLE (both modes) ═══
  parts.push('STYLE:');
  if (isTikTok) {
    parts.push('- Raw, organic, warm color grade');
  } else {
    if (pkg.colorScheme) {
      const cs = pkg.colorScheme;
      parts.push(`- Colors: ${cs.background || 'white/light'} bg, ${cs.textPrimary || 'dark'} text, ${cs.accent || 'indigo'} accents`);
    } else {
      parts.push('- Clean premium background with bold accent CTA');
    }
    parts.push('- High contrast, mobile-first readability');
  }
  parts.push('');

  // ═══ FINAL RULE ═══
  parts.push('This is a DIRECT-RESPONSE ad — it must convert, not just look good.');

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════
// IDEOGRAM SYSTEM — High-Scale Meta Statics
//
// Core Rule: Ideogram = persuasion + concept + layout, NOT product.
// If a bottle appears → prompt is wrong.
//
// Funnel-stage-aware prompt builder with:
//   TOF: scroll-stop + curiosity (symbolic, disruptive)
//   MOF: belief + trust (educational, ingredient, mechanism)
//   BOF: convert NOW (offer, urgency, guarantee)
//
// Hook system dynamically injected from concept angle.
// Layout rules enforced on every prompt.
// ═══════════════════════════════════════════════════════════

function buildIdeogramConceptPrompt(pkg: {
  imageFormat?: string;
  headline?: string;
  hookText?: string;
  proofElement?: string;
  ctaText?: string;
  offerPlacement?: string;
  colorScheme?: { background?: string; textPrimary?: string; accent?: string };
  visualComposition?: string;
  angle?: string;
  conceptAngle?: string;
}, options: {
  productName: string;
  platform: string;
  funnelStage: string;
  isTikTok: boolean;
}): string {
  const { productName, funnelStage, isTikTok } = options;
  const angle = pkg.angle || pkg.conceptAngle || '';
  const hookText = pkg.hookText || pkg.headline || '';

  // ═══ Detect concept angle → symbolic visual direction ═══
  const angleLower = (angle + ' ' + hookText).toLowerCase();
  let visualDirection = 'symbolic wellness visuals, clean premium feel, subtle supporting imagery';

  if (/sleep|rest|night|insomnia/i.test(angleLower)) {
    visualDirection = 'calming nighttime / rest symbolism — deep blue/indigo gradient, soft moonlight glow, floating stars or gentle clouds. The feeling of deep, restorative sleep';
  } else if (/energy|metabol|boost|active|vitality|stamina/i.test(angleLower)) {
    visualDirection = 'energetic wellness / clean natural support symbolism — warm golden/amber tones, radiating light, dynamic flowing shapes. Leafy or citrus accents';
  } else if (/stress|anxiety|calm|relax|peace|relief/i.test(angleLower)) {
    visualDirection = 'calm relief / grounded lifestyle imagery — soft earth tones, flowing water or smooth stone textures. Botanical elements like lavender or chamomile';
  } else if (/muscle|cramp|recovery|sore|pain|joint/i.test(angleLower)) {
    visualDirection = 'soothing recovery / physical relief — cool teal/mint tones, smooth flowing lines, subtle botanical elements. Clean and clinical but warm';
  } else if (/brain|focus|cognitive|mental|clarity|memory/i.test(angleLower)) {
    visualDirection = 'sharp focus / clarity symbolism — clean geometric patterns, neural-inspired subtle lines, cool blue tones with bright accent points';
  } else if (/heart|cardio|blood|pressure|circulation/i.test(angleLower)) {
    visualDirection = 'vital warmth / circulation symbolism — rich red/burgundy accents with clean white space, flowing organic shapes';
  } else if (/ingredien|natural|organic|herbal|plant|vitamin|mineral|magnesium/i.test(angleLower)) {
    visualDirection = 'natural wellness symbolism — soft botanical textures, green leafy backgrounds, warm earth-tone gradients, clean nature-inspired surfaces. NO capsules, NO pills, NO supplement forms, NO ingredient renders';
  } else if (/offer|deal|discount|sale|bundle|save|free|limited|price/i.test(angleLower)) {
    visualDirection = 'strong direct-response typography with supportive symbolic visuals — urgent color accents, clean background, geometric shapes framing the offer';
  } else if (/review|testimon|proof|star|rating|customer/i.test(angleLower)) {
    visualDirection = 'social proof layout — star ratings, quote-style typography, trust badges. Clean white/light background with subtle golden accents';
  } else if (/before.*after|transform|result|change/i.test(angleLower)) {
    visualDirection = 'transformation symbolism — split showing "before" (muted, heavy, grey) vs "after" (bright, light, energetic). Abstract, not literal';
  } else if (/compare|vs|versus|other|typical|regular/i.test(angleLower)) {
    visualDirection = 'comparison layout — two columns with clear visual hierarchy. Left (competitor) in muted tones, right (ours) in vibrant/premium tones';
  }

  // ═══ Funnel-stage-specific prompt template ═══
  const parts: string[] = [];
  parts.push('Create a high-converting Facebook ad static.');

  if (funnelStage === 'tof') {
    // ═══ TOP OF FUNNEL — stop scroll + spark curiosity ═══
    parts.push('');
    parts.push('Style: premium direct-response, clean layout, high contrast');
    parts.push('');
    parts.push('Visual:');
    parts.push('- Do NOT show any product bottle or packaging');
    parts.push(`- Use symbolic visuals representing: ${visualDirection}`);
    parts.push('- Modern, minimal, scroll-stopping');
    parts.push('');
    parts.push('Text overlay:');
    if (hookText) {
      parts.push(`- "${hookText}" as large bold hook at top`);
    } else {
      parts.push('- Large bold hook at top');
    }
    if (pkg.proofElement) {
      parts.push(`- "${pkg.proofElement}" as supporting curiosity line`);
    } else {
      parts.push('- Supporting curiosity line below');
    }
    parts.push(`- "${pkg.ctaText || 'Learn More'}" as soft CTA at bottom`);
    parts.push('');
    parts.push('Tone: curiosity-driven, slightly disruptive, natural not salesy');

  } else if (funnelStage === 'mof') {
    // ═══ MIDDLE OF FUNNEL — build belief + trust ═══
    parts.push('');
    parts.push('Style: clean, educational direct-response layout');
    parts.push('');
    parts.push('Visual:');
    parts.push('- Do NOT show any product bottle');
    parts.push(`- Use ingredient-based visuals or mechanism explanation: ${visualDirection}`);
    parts.push('- Show how the benefit works visually');
    parts.push('- Clean infographic-style or lifestyle composition');
    parts.push('');
    parts.push('Text overlay:');
    if (hookText) {
      parts.push(`- "${hookText}" as clear benefit headline`);
    } else {
      parts.push('- Clear benefit headline');
    }
    if (pkg.proofElement) {
      parts.push(`- "${pkg.proofElement}" as supporting proof or explanation`);
    } else {
      parts.push('- Supporting proof or explanation');
    }
    parts.push(`- "${pkg.ctaText || 'Shop Now'}" as CTA`);
    parts.push('');
    parts.push('Tone: informative, credible, reassuring');

  } else {
    // ═══ BOTTOM OF FUNNEL — convert NOW ═══
    parts.push('');
    parts.push('Style: strong direct-response, offer-focused');
    parts.push('');
    parts.push('Visual:');
    parts.push('- Do NOT show product bottle');
    parts.push(`- Use clean background with symbolic wellness visuals: ${visualDirection}`);
    parts.push('- Emphasize typography and layout');
    parts.push('');
    parts.push('Text overlay:');
    if (hookText) {
      parts.push(`- "${hookText}" as strong offer headline`);
    } else {
      parts.push('- Strong offer headline');
    }
    if (pkg.proofElement) {
      parts.push(`- "${pkg.proofElement}" as clear benefit`);
    }
    if (pkg.offerPlacement && pkg.offerPlacement !== 'No offer specified') {
      parts.push(`- "${pkg.offerPlacement}" as urgency or incentive`);
    }
    parts.push(`- "${pkg.ctaText || 'Shop Now'}" as CTA button style element`);
    parts.push('');
    parts.push('Tone: confident, direct, conversion-focused');
  }

  // ═══ Layout rules (ALL stages) ═══
  parts.push('');
  parts.push('Layout:');
  parts.push('- Clear hierarchy (hook → support → CTA)');
  parts.push('- Mobile-first (thumb-stopping)');
  parts.push('- Large readable text');
  parts.push('- Minimal clutter');
  parts.push('- One clear message per image');

  // ═══ Color ═══
  if (pkg.colorScheme) {
    const cs = pkg.colorScheme;
    parts.push('');
    parts.push(`Colors: ${cs.background || 'white'} background, ${cs.textPrimary || 'dark'} text, ${cs.accent || 'indigo'} accents.`);
  }

  // ═══ HARD BLOCK — enforced at the end of every prompt ═══
  parts.push('');
  parts.push('IMPORTANT (STRICT — DO NOT VIOLATE):');
  parts.push('Do NOT include ANY of the following in the image:');
  parts.push('- No product bottle, jar, tube, box, or packaging of any kind');
  parts.push('- No capsules, pills, tablets, softgels, or supplement forms');
  parts.push('- No illustrated/animated/3D renders of ingredients or molecules');
  parts.push('- No product photography or product mockups');
  parts.push('- No cartoon or icon versions of the product');
  parts.push('This ad uses ONLY typography, symbolic background visuals (gradients, textures, nature scenes), and layout design.');
  parts.push(`Sell the BENEFIT of "${productName}" through words and mood — not through showing the product or its contents.`);

  return parts.join('\n');
}

// ═══════════════════════════════════════════════
// DURATION BUDGET SYSTEM (script length validation)
// ═══════════════════════════════════════════════
//
// Speech rate: ~2.5 words per second is comfortable, 3.0 wps is fast.
// We use 2.2 wps as a SAFE target (gives buffer for pauses and CTA emphasis).
// The CTA must always fit at the end — protect it first.

export interface DurationBudget {
  duration: number;        // seconds
  minWords: number;        // floor for usable script
  maxWords: number;        // hard ceiling
  targetWords: number;     // ideal length
  ctaReserveSeconds: number; // seconds reserved for CTA at the end
  ctaMaxWords: number;     // max words allowed in CTA
  beats: { name: string; start: number; end: number; maxWords: number }[];
}

export function getDurationBudget(durationSeconds: number): DurationBudget {
  // TIGHT budgets — Sora renders faster than real speech.
  // Using 1.5 wps (not 2.2) to prevent cutoff. Fewer words = more breathing room.
  const budgets: Record<number, DurationBudget> = {
    8: {
      duration: 8, minWords: 8, maxWords: 12, targetWords: 10, ctaReserveSeconds: 2, ctaMaxWords: 4,
      beats: [
        { name: 'Hook', start: 0, end: 2, maxWords: 3 },
        { name: 'Product', start: 2, end: 6, maxWords: 5 },
        { name: 'CTA', start: 6, end: 8, maxWords: 4 },
      ],
    },
    10: {
      duration: 10, minWords: 10, maxWords: 15, targetWords: 12, ctaReserveSeconds: 2.5, ctaMaxWords: 4,
      beats: [
        { name: 'Hook', start: 0, end: 3, maxWords: 4 },
        { name: 'Product/Proof', start: 3, end: 7.5, maxWords: 7 },
        { name: 'CTA', start: 7.5, end: 10, maxWords: 4 },
      ],
    },
    15: {
      duration: 15, minWords: 16, maxWords: 22, targetWords: 18, ctaReserveSeconds: 3, ctaMaxWords: 5,
      beats: [
        { name: 'Hook', start: 0, end: 3, maxWords: 5 },
        { name: 'Problem/Product', start: 3, end: 8, maxWords: 7 },
        { name: 'Proof', start: 8, end: 12, maxWords: 5 },
        { name: 'CTA', start: 12, end: 15, maxWords: 5 },
      ],
    },
    20: {
      duration: 20, minWords: 22, maxWords: 30, targetWords: 25, ctaReserveSeconds: 4, ctaMaxWords: 6,
      beats: [
        { name: 'Hook', start: 0, end: 4, maxWords: 6 },
        { name: 'Problem/Product', start: 4, end: 11, maxWords: 10 },
        { name: 'Proof', start: 11, end: 16, maxWords: 8 },
        { name: 'CTA', start: 16, end: 20, maxWords: 6 },
      ],
    },
  };

  // Find closest budget
  if (budgets[durationSeconds]) return budgets[durationSeconds];
  if (durationSeconds <= 8) return budgets[8];
  if (durationSeconds <= 10) return budgets[10];
  if (durationSeconds <= 15) return budgets[15];
  return budgets[20];
}

/**
 * Strip stage directions in [brackets] before counting spoken words.
 */
function countSpokenWords(script: string): number {
  if (!script) return 0;
  const stripped = script
    .replace(/\[[^\]]*\]/g, ' ')        // Remove [stage directions]
    .replace(/\([^)]*\)/g, ' ')         // Remove (parenthetical asides)
    .replace(/[^\w\s'-]/g, ' ')         // Strip punctuation except apostrophes/hyphens
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return 0;
  return stripped.split(' ').filter(w => w.length > 0).length;
}

/**
 * Estimate spoken duration in seconds at 2.2 words per second (safe pacing).
 */
export function estimateSpokenDuration(script: string): number {
  const words = countSpokenWords(script);
  return Math.round((words / 2.2) * 10) / 10; // 1 decimal place
}

export interface ScriptValidation {
  ok: boolean;
  wordCount: number;
  estimatedSeconds: number;
  budget: DurationBudget;
  reason?: string;
}

/**
 * Validate a script against its target duration.
 * Returns ok=true if it fits within max budget (under min is acceptable — just leaves buffer).
 * Only too-long scripts fail since those are the ones that cause Sora to cut off.
 */
export function validateScriptDuration(script: string, durationSeconds: number): ScriptValidation {
  const budget = getDurationBudget(durationSeconds);
  const wordCount = countSpokenWords(script);
  const estimatedSeconds = estimateSpokenDuration(script);

  if (wordCount === 0) {
    return { ok: false, wordCount, estimatedSeconds, budget, reason: 'Empty script' };
  }
  if (wordCount > budget.maxWords) {
    return { ok: false, wordCount, estimatedSeconds, budget, reason: `Too long: ${wordCount} words exceeds max ${budget.maxWords} for ${durationSeconds}s` };
  }
  if (estimatedSeconds > durationSeconds - 0.5) {
    return { ok: false, wordCount, estimatedSeconds, budget, reason: `Estimated speech ${estimatedSeconds}s exceeds runtime ${durationSeconds}s buffer` };
  }
  // Under-min is just a warning — script will fit with extra room. Not a failure.
  if (wordCount < budget.minWords) {
    return { ok: true, wordCount, estimatedSeconds, budget, reason: `Short: ${wordCount} words (recommended min ${budget.minWords}) — extra buffer time available` };
  }
  return { ok: true, wordCount, estimatedSeconds, budget };
}

/**
 * Auto-compress an overlong script to fit the target duration.
 * Strategy: trim filler words, shorten hook, sample middle sentences, always preserve CTA.
 * Returns the compressed script. If still too long, returns best-effort.
 */
export function compressScriptToFit(script: string, durationSeconds: number): { script: string; iterations: number; finalWordCount: number } {
  const budget = getDurationBudget(durationSeconds);
  // Compression target: maxWords minus a small safety margin (not targetWords — that's too aggressive)
  const compressTarget = Math.max(budget.targetWords, budget.maxWords - 3);
  let current = script;
  let iterations = 0;

  // Pass 1: strip common filler words
  const fillers = ['really', 'just', 'literally', 'actually', 'basically', 'honestly', 'kind of', 'sort of', 'you know', 'I mean', 'pretty much', 'so basically', 'like totally'];
  for (const f of fillers) {
    current = current.replace(new RegExp(`\\b${f}\\b`, 'gi'), '');
  }
  current = current.replace(/\s+/g, ' ').replace(/\s+([.!?,])/g, '$1').trim();
  iterations++;

  if (countSpokenWords(current) <= compressTarget) {
    return { script: current, iterations, finalWordCount: countSpokenWords(current) };
  }

  // Pass 2: split into sentences, keep CTA always, fit body into remaining budget
  const sentences = current.split(/(?<=[.!?])\s+/).filter(s => s.trim());
  if (sentences.length >= 2) {
    iterations++;
    const cta = sentences[sentences.length - 1];
    const ctaWords = countSpokenWords(cta);
    const bodyBudget = compressTarget - ctaWords;

    // Greedy fit: take sentences from start until budget runs out
    let bodyWordCount = 0;
    const keptBody: string[] = [];
    for (let i = 0; i < sentences.length - 1; i++) {
      const s = sentences[i];
      const sw = countSpokenWords(s);
      if (bodyWordCount + sw <= bodyBudget) {
        keptBody.push(s);
        bodyWordCount += sw;
      } else if (keptBody.length === 0 && i === 0) {
        // The hook itself is too long — truncate it word-by-word
        const hookWords = s.replace(/\[[^\]]*\]/g, '').split(/\s+/).filter(w => w.length > 0);
        const trimmedHook = hookWords.slice(0, bodyBudget).join(' ').replace(/[,]+$/, '') + '.';
        keptBody.push(trimmedHook);
        bodyWordCount += bodyBudget;
        break;
      }
    }
    current = [...keptBody, cta].join(' ');
  }

  // Pass 3: if STILL too long, hard-truncate (preserve CTA)
  if (countSpokenWords(current) > budget.maxWords) {
    iterations++;
    const sentences2 = current.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    if (sentences2.length >= 2) {
      const cta = sentences2[sentences2.length - 1];
      const ctaWords = countSpokenWords(cta);
      const remaining = budget.maxWords - ctaWords - 2;
      const beforeCta = sentences2.slice(0, -1).join(' ');
      const words = beforeCta.split(/\s+/);
      const truncated = words.slice(0, remaining).join(' ');
      const lastPunct = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
      const safeBefore = lastPunct > 0 ? truncated.substring(0, lastPunct + 1) : truncated + '.';
      current = `${safeBefore} ${cta}`.trim();
    }
  }

  return { script: current, iterations, finalWordCount: countSpokenWords(current) };
}

/**
 * Build a duration directive block to inject into the AI generation contract.
 * Tells the LLM exactly how many words it can use and how to structure them.
 */
export function buildDurationDirective(durationSeconds: number): string {
  const budget = getDurationBudget(durationSeconds);
  return `═══ STRICT DURATION RULES (${durationSeconds}s video) ═══
TOTAL spoken words: ${budget.minWords}-${budget.maxWords} (target: ${budget.targetWords})
Speech pace: 1.5 words/second (SLOW natural delivery with pauses between sentences)

THIS IS CRITICAL: AI video generators render FASTER than real speech. You must write FEWER words than you think.
A ${durationSeconds}-second video can only fit ${budget.targetWords} spoken words. Count them carefully.

BEAT STRUCTURE (do NOT exceed per-beat word counts):
${budget.beats.map(b => `  ${b.name} (${b.start}-${b.end}s): max ${b.maxWords} words`).join('\n')}

CRITICAL: The CTA at the end MUST fit within ${budget.ctaReserveSeconds}s and ${budget.ctaMaxWords} words.
DO NOT cut off the CTA. The CTA is the LAST thing the viewer sees/hears.
If in doubt, CUT words from the middle. NEVER sacrifice the CTA.

Stage directions in [brackets] do NOT count toward word budget — only spoken dialogue counts.
Write SHORT sentences. 3-6 words each. One thought per sentence. Let pauses do the work.
NO filler words (really, just, literally, actually, basically, so, like).`;
}
