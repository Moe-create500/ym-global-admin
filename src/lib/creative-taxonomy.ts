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
      'Bold, high-contrast headline readable in thumbnail size.',
      'Product must be clearly visible and identifiable.',
      'Simple composition — one focal point, not cluttered.',
      'Lifestyle > studio for TOF. Product hero > lifestyle for BOF.',
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
export function buildFastContract(intent: CreativeIntent, contentType: string, quantity: number, funnelStage?: string): string {
  const playbook = META_PERFORMANCE_KB.funnelPlaybook[(funnelStage || 'tof') as keyof typeof META_PERFORMANCE_KB.funnelPlaybook];
  const videoOutputSpec = `Each video package JSON: { "title": "max 60 chars", "angle": "5-10 words", "hook": "exact opening 1-3s word-for-word", "script": "15-30s with [directions]", "sceneStructure": "second-by-second", "visualDirection": "camera, lighting, setting", "brollDirection": "3-5 shots", "presenterBehavior": "delivery style", "pacingNotes": "edit rhythm", "cta": "exact CTA", "adCopy": "Facebook text 3-8 sentences", "headline": "max 40 chars", "variants": ["3 one-line variations"] }`;
  const imageOutputSpec = `Each image package JSON: { "title": "max 60 chars", "angle": "5-10 words", "headline": "max 8 words", "subheadline": "max 15 words", "conceptAngle": "why it works", "visualComposition": "layout spec", "offerPlacement": "where offer goes", "ctaDirection": "CTA style", "adCopy": "Facebook text 3-8 sentences", "variants": ["3 one-line variations"] }`;

  // Compact creative + funnel definition (strip useCase/antiPatterns to save tokens)
  const cr = CREATIVE_TYPES[Object.keys(CREATIVE_TYPES).find(k => intent.creativeDefinition.includes(CREATIVE_TYPES[k].label)) || 'testimonial'];
  const compactCreative = `TYPE: ${cr.label}. ${cr.definition} Requirements: ${cr.outputRequirements}`;

  return `Elite creative director for supplements & beauty on Meta. ${contentType === 'video' ? '9:16 vertical video, 15-30s.' : 'Static image 1080x1080 or 4:5.'}

${compactCreative}

${intent.funnelDefinition}

${intent.hookDefinition}

PRESENTER: ${intent.presenterDefinition.split('\n').slice(0, 2).join('. ')}

${intent.formatRealismDirectives}

PLATFORM: ${intent.platformDirectives.split('\n').slice(0, 3).join('. ')}

RULES: NO music/soundtrack — voice + room tone only. Show ONLY the exact product specified — no generics.
${contentType === 'video' ? `SCRIPT BEATS: Hook (0-3s) scroll-stop → Problem+Product (3-10s) → Proof (10-18s) → CTA (18-20s).` : ''}

POLICY: No "cure/treat/prevent". Use "supports/helps/promotes". No fake reviews.

${intent.accountOptimizationNotes}

OUTPUT: ${contentType === 'video' ? videoOutputSpec : imageOutputSpec}
Return: { "packages": [${quantity} objects] }. Each unique angle.`;
}

export function buildGenerationContract(intent: CreativeIntent, contentType: string, quantity: number): string {
  const videoOutputSpec = `For EACH video package, return exactly this JSON structure:
{
  "title": "max 60 chars — descriptive creative title",
  "angle": "core marketing angle in 5-10 words",
  "hook": "EXACT opening line/moment word-for-word (first 1-3 seconds). This is the most important element.",
  "script": "Full 15-30s script with [speaker directions]. Include exact dialogue. Must reflect the presenter style and hook style defined above.",
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
  "title": "max 60 chars — descriptive creative title",
  "angle": "core marketing angle in 5-10 words",
  "headline": "Bold headline for the image, max 8 words. Must stop the scroll at thumbnail size.",
  "subheadline": "Supporting line, max 15 words.",
  "conceptAngle": "Why this concept works for this funnel stage and audience.",
  "visualComposition": "Exact layout: what goes where, colors, typography, imagery placement. Specify 1:1 or 4:5 ratio. Must comply with <20% text rule.",
  "placementNotes": "How this image works in Feed vs Stories. Any placement-specific considerations.",
  "offerPlacement": "Where and how the offer/price/discount appears. Font size, position, treatment.",
  "ctaDirection": "CTA button text and visual style. Must match funnel stage CTA rules.",
  "adCopy": "Facebook primary text (3-8 sentences). Must match copy density rules.",
  "variants": ["3-5 one-line descriptions of variations, each specifying WHAT changes."]
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
 * Build a platform-aware, funnel-aware image render prompt from a creative package.
 */
export function buildImageRenderDirective(
  pkg: {
    title?: string;
    angle?: string;
    imageFormat?: string;
    headline?: string;
    subheadline?: string;
    hookText?: string;
    proofElement?: string;
    productPlacement?: string;
    conceptAngle?: string;
    visualComposition?: string;
    textOverlays?: { text: string; position: string; fontSize: string; fontWeight: string; color: string }[];
    offerPlacement?: string;
  },
  opts: {
    productName?: string;
    platform?: string;
    funnelStage?: string;
    hasReferenceImage?: boolean;
  }
): string {
  const parts: string[] = [];

  // Platform-specific aspect ratio / format guidance
  const platform = opts.platform || 'meta';
  const funnelStage = opts.funnelStage || 'mof';
  const format = pkg.imageFormat || 'product_highlight';

  if (platform === 'tiktok') {
    parts.push('Create a vertical (9:16) social media ad image optimized for TikTok.');
  } else if (platform === 'google') {
    parts.push('Create a display ad image suitable for Google Ads.');
  } else {
    parts.push('Create a high-converting social media ad image optimized for Meta (Facebook/Instagram).');
  }

  // Product name
  if (opts.productName) {
    parts.push(`Product: ${opts.productName}.`);
  }

  // Creative angle
  if (pkg.angle) {
    parts.push(`Creative angle: ${pkg.angle}.`);
  }
  if (pkg.conceptAngle && pkg.conceptAngle !== pkg.angle) {
    parts.push(`Concept: ${pkg.conceptAngle}.`);
  }

  // Headline and hook
  if (pkg.headline) {
    parts.push(`Headline text overlay: "${pkg.headline}".`);
  }
  if (pkg.subheadline) {
    parts.push(`Subheadline: "${pkg.subheadline}".`);
  }
  if (pkg.hookText) {
    parts.push(`Hook text: "${pkg.hookText}".`);
  }

  // Visual composition
  if (pkg.visualComposition) {
    parts.push(`Visual composition: ${pkg.visualComposition}.`);
  }
  if (pkg.productPlacement) {
    parts.push(`Product placement: ${pkg.productPlacement}.`);
  }

  // Proof element
  if (pkg.proofElement) {
    parts.push(`Include proof element: ${pkg.proofElement}.`);
  }

  // Offer placement
  if (pkg.offerPlacement) {
    parts.push(`Offer/CTA placement: ${pkg.offerPlacement}.`);
  }

  // Text overlays
  if (pkg.textOverlays && pkg.textOverlays.length > 0) {
    const overlayDesc = pkg.textOverlays.map(
      o => `"${o.text}" at ${o.position} (${o.fontSize}, ${o.fontWeight}, ${o.color})`
    ).join('; ');
    parts.push(`Text overlays: ${overlayDesc}.`);
  }

  // Reference image guidance
  if (opts.hasReferenceImage) {
    parts.push('Use the provided product reference image as the hero visual. Maintain exact product appearance, colors, and packaging.');
  }

  // Funnel stage guidance
  if (funnelStage === 'tof') {
    parts.push('This is a top-of-funnel awareness ad — focus on attention-grabbing visuals and bold messaging.');
  } else if (funnelStage === 'bof') {
    parts.push('This is a bottom-of-funnel conversion ad — focus on urgency, social proof, and clear CTA.');
  } else {
    parts.push('This is a mid-funnel consideration ad — balance product education with persuasive visuals.');
  }

  // Format-specific guidance
  const formatGuide: Record<string, string> = {
    product_highlight: 'Hero product shot — clean background, product is the star. Professional product photography style.',
    testimonial: 'Testimonial-style image with text overlay suggesting customer endorsement.',
    social_proof: 'Social proof image — include elements like star ratings, review quotes, or user count.',
    offer_stack: 'Offer stack — feature the deal/discount prominently with product.',
    comparison: 'Side-by-side comparison layout — your product vs alternatives.',
    before_after: 'Before/after transformation layout showing the product benefit.',
    problem_solution: 'Problem → Solution visual — left side shows pain point, right side shows product as solution.',
    hook_viral: 'Scroll-stopping viral hook — bold, unexpected visual that demands attention.',
    pattern_interrupt: 'Pattern interrupt — unusual composition that breaks feed scroll.',
    authority_claim: 'Authority/expert endorsement style with credibility markers.',
    myth_busting: 'Myth-busting layout — crossed-out misconception with truth revealed.',
    review_stack: 'Review stack layout — multiple mini-reviews arranged around the product.',
  };

  if (formatGuide[format]) {
    parts.push(formatGuide[format]);
  }

  parts.push('Photo-realistic, high quality, professional advertising standard. Clean typography if text is included.');

  return parts.join('\n\n');
}
