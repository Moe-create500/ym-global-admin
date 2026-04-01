import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { chatCompletion } from '@/lib/openai-chat';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const batch: any = db.prepare('SELECT * FROM creative_batches WHERE id = ?').get(id);
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  // Build context
  const productCtx = batch.product_context ? JSON.parse(batch.product_context) : null;
  const offer = batch.offer || '';

  const productInfo = productCtx
    ? `Product: ${productCtx.title}\nPrice: $${(productCtx.priceCents / 100).toFixed(2)}${productCtx.imageUrl ? `\nProduct Image URL: ${productCtx.imageUrl}` : ''}${offer ? `\nOffer: ${offer}` : ''}`
    : `Product details not specified.${offer ? `\nOffer: ${offer}` : ''}`;

  // Pull full product details including description
  let productDescription = '';
  if (batch.product_id) {
    const prod: any = db.prepare('SELECT * FROM products WHERE id = ?').get(batch.product_id);
    if (prod) {
      productDescription = `\nProduct Details:
- Full Name: ${prod.title}
- SKU: ${prod.sku || 'N/A'}
- Category: ${prod.category || 'N/A'}
- Weight: ${prod.weight_grams ? prod.weight_grams + 'g' : 'N/A'}
- Variant: ${prod.variant_title || 'N/A'}${prod.description ? `\n- Description: ${prod.description}` : ''}`;
    }
  }

  const anglesInfo = `\nAnalyze the winning ads below and EXTRACT the angles/concepts that are actually converting. Do NOT guess — base your 5 prompts on the REAL patterns you see in the data. Each prompt should double down on a different winning concept you identify.`;

  // ──────────────────────────────────────────────
  // PULL ACTUAL WINNING ADS FROM AD PERFORMANCE DATA
  // ──────────────────────────────────────────────
  let winningAdsContext = '';
  if (batch.store_id) {
    const winningAds: any[] = db.prepare(`
      SELECT
        ad_id,
        ad_name,
        ad_headline,
        ad_body,
        ad_cta,
        MAX(video_analysis) as video_analysis,
        MAX(creative_url) as creative_url,
        SUM(spend_cents) as total_spend,
        SUM(impressions) as total_impressions,
        SUM(clicks) as total_clicks,
        SUM(purchases) as total_purchases,
        SUM(purchase_value_cents) as total_revenue,
        CASE WHEN SUM(spend_cents) > 0 THEN ROUND(CAST(SUM(purchase_value_cents) AS REAL) / SUM(spend_cents), 2) ELSE 0 END as roas,
        CASE WHEN SUM(clicks) > 0 THEN ROUND(CAST(SUM(clicks) AS REAL) / SUM(impressions) * 100, 2) ELSE 0 END as ctr,
        CASE WHEN SUM(purchases) > 0 THEN ROUND(CAST(SUM(spend_cents) AS REAL) / SUM(purchases) / 100, 2) ELSE 0 END as cpa
      FROM ad_spend
      WHERE store_id = ? AND ad_id IS NOT NULL AND spend_cents > 0
      GROUP BY ad_id
      HAVING total_purchases > 0
      ORDER BY roas DESC
      LIMIT 15
    `).all(batch.store_id);

    if (winningAds.length > 0) {
      winningAdsContext = `\n\n═══ YOUR TOP PERFORMING ADS (REAL DATA — STUDY THESE CAREFULLY) ═══

These are your actual best-converting Facebook ads ranked by ROAS. Study the patterns — the headlines, the copy style, the emotional triggers, the CTAs, the angles. Your new prompts should capture the same energy, tone, and persuasion techniques.

`;
      let hasVideoAnalysis = false;
      for (let i = 0; i < winningAds.length; i++) {
        const ad = winningAds[i];
        winningAdsContext += `── Winner #${i + 1} ──
Ad Name: ${ad.ad_name || 'N/A'}
ROAS: ${ad.roas}x | Purchases: ${ad.total_purchases} | Spend: $${(ad.total_spend / 100).toFixed(2)} | Revenue: $${(ad.total_revenue / 100).toFixed(2)}
CTR: ${ad.ctr}% | CPA: $${ad.cpa}
Headline: ${ad.ad_headline || '(none)'}
CTA Button: ${ad.ad_cta || '(none)'}
Ad Copy:
${ad.ad_body || '(no copy available)'}
`;

        // Include Twelve Labs video analysis if available
        if (ad.video_analysis) {
          hasVideoAnalysis = true;
          winningAdsContext += `
🎬 VIDEO CREATIVE DNA (Twelve Labs AI Analysis):
${ad.video_analysis}
`;
        }
        winningAdsContext += '\n';
      }

      winningAdsContext += `═══ KEY PATTERNS TO REPLICATE ═══
Analyze the winning ads above and ensure your new prompts:
1. Use the SAME tone and copy style (casual vs authoritative, emoji usage, formatting)
2. Hit the SAME emotional triggers (fear of missing out, social proof, comparison, parental concern)
3. Use similar headline patterns (questions, statements, comparisons)
4. Match the CTA approach (urgency, scarcity, benefit-driven)
5. Mirror the ad structure (problem-agitate-solve, comparison, testimonial, listicle)
6. The adCopy you write should feel like it came from the same brand — same voice, same energy
`;
      if (hasVideoAnalysis) {
        winningAdsContext += `
7. CRITICAL — VIDEO DNA: Some winning ads include detailed video analysis from Twelve Labs. These breakdowns show the EXACT hook style, pacing, camera angles, transitions, content creator energy, and emotional arc that made those ads convert. Your video prompts MUST replicate these specific creative elements — the same hook type, same pacing style, same energy level, same camera work.
`;
      }
    }
  }

  // If doubling down, get parent batch's winning data
  let parentContext = '';
  if (batch.parent_batch_id) {
    const parent: any = db.prepare('SELECT * FROM creative_batches WHERE id = ?').get(batch.parent_batch_id);
    if (parent?.video_prompts) {
      const parentVideoPrompts = JSON.parse(parent.video_prompts);
      const parentImagePrompts = parent.image_prompts ? JSON.parse(parent.image_prompts) : [];
      parentContext = `\n\n═══ PREVIOUS BATCH PROMPTS (DOUBLE DOWN — ITERATE ON THESE) ═══
These prompts were used in the previous batch. Create NEW variations that push the same angles further — same energy but fresh creative.

Video prompts from previous batch:
${parentVideoPrompts.map((p: any, i: number) => `${i + 1}. [${p.angle}] "${p.headline}" — ${p.prompt.substring(0, 150)}...`).join('\n')}

Image prompts from previous batch:
${parentImagePrompts.map((p: any, i: number) => `${i + 1}. [${p.angle}] "${p.headline}" — ${p.prompt.substring(0, 150)}...`).join('\n')}
`;
    }
  }

  db.prepare("UPDATE creative_batches SET status = 'generating_prompts', updated_at = datetime('now') WHERE id = ?").run(id);

  try {
    const result = await chatCompletion([
      {
        role: 'system',
        content: `You are an elite e-commerce creative director who reverse-engineers winning Facebook/Meta ads and converts their persuasion into videos that feel like authentic TikTok creator content — casual, believable, and native to the platform rather than polished commercials.

YOUR JOB: Study the winning ad data, extract the COMPLETE creative blueprint (not just copy — the WHOLE vibe), and write Sora video prompts that preserve what converts while making the final videos feel human, unscripted, and creator-led.

FORMAT: All content is VERTICAL 9:16 (720x1280) for Instagram Reels, TikTok, Facebook Stories.

PRODUCT IMAGE AS FIRST FRAME: The actual product photo is fed to Sora as the first frame (input_reference). Sora will SEE the product — describe what HAPPENS around it.

═══ CREATIVE DIRECTION RULES ═══

1. THE HOOK (First 1-3 seconds — MOST IMPORTANT):
   Every winning ad stops the scroll in the first second. Your prompt MUST describe a specific, vivid hook:
   - A creator turning to camera mid-thought saying "okay wait"
   - A product already in hand during a casual selfie shot
   - A quick real-life moment that feels caught, not staged
   - A simple text overlay that feels native to TikTok, not a brand graphic
   - Someone reacting naturally after using the product
   Describe the EXACT visual that makes someone stop scrolling.

2. THE CONTENT CREATOR / PERSON:
   Every video needs a REAL person. Describe them in detail:
   - Demographics: age range, appearance, energy level
   - Personality: relatable creator, low-pressure recommender, casually obsessed user, honest tester
   - Energy: conversational, believable, slightly imperfect, warm
   - Speaking style: talking directly to camera like a friend on TikTok, not like a spokesperson
   - Expressions: genuine reaction, relief, curiosity, quiet excitement — describe the micro-expressions
   - Body language: relaxed, casual hand motions, small posture shifts, natural pauses

3. THE EMOTIONAL ARC (20-second story — must feel COMPLETE, not cut off):
   Second 0-3: HOOK — stop the scroll with a natural creator moment
   Second 3-7: CONTEXT — a relatable real-life reason they brought the product up
   Second 7-13: PRODUCT MOMENT — showcase the product naturally while talking through it
   Second 13-17: REACTION — show why they like it or what surprised them
   Second 17-20: NATURAL CLOSE — finish the thought casually. The video MUST end naturally at 20s — NOT mid-sentence or mid-action.

4. CAMERA & MOVEMENT:
   - Handheld/selfie-mode feel — slight shake, natural imperfect framing
   - Creator-style cuts between face, product in hand, and real environment
   - Close-ups of product in hand, being opened, being used
   - Framing should feel native and casual, not overproduced
   - Avoid camera moves that feel commercial or cinematic-for-the-sake-of-it

5. LIGHTING & SETTING:
   - Natural light ONLY — window light, golden hour, overcast daylight
   - Real locations: messy kitchen counter, bathroom mirror, living room couch, park bench
   - NOT clean/perfect — slightly lived-in, authentic, relatable

6. PACING & TRANSITIONS:
   - Natural creator pacing, not hard-sell ad pacing
   - Smooth single-take or simple jump cuts for testimonial/UGC angles
   - Small pauses and breathing room are good
   - Avoid overly aggressive transitions unless the winning DNA clearly depends on them

7. HUMAN DELIVERY:
   - The spoken delivery should sound lightly unscripted
   - Allow filler words like "okay", "wait", "honestly", "literally", "I mean"
   - Allow one small restart or self-correction
   - Short, casual sentences are better than polished ad copy
   - Never sound like an announcer, spokesperson, or direct-response voiceover

8. COPY THE WINNERS' CREATIVE DNA:
   - If winning ads use comparison format (Brand A vs Brand B), create comparison-style video scenes
   - If winning ads use emotional mom stories, create emotional mom video scenes
   - If winning ads use ✔️ listicle format, describe text overlays appearing with checkmarks
   - If winning ads use question hooks, have the content creator ask the question to camera
   - MATCH the persuasion architecture that's converting, but express it through creator-native behavior instead of polished ad performance

9. AD COPY (adCopy field):
   - Must mirror the EXACT tone, structure, emoji usage, and persuasion style of the winning ads
   - Same formatting (bullet points, line breaks, emoji patterns)
   - Same length and level of detail
   - Same CTA style
   - Same voice — if winners are casual and emoji-heavy, be casual and emoji-heavy

Return JSON with one array:
- "videoPrompts": array of 5 objects

Each object must have:
- "prompt": (300-500 words) A complete 20-second creative brief describing the EXACT scene second-by-second — the person, their energy, the hook, the action sequence, camera movement, lighting, setting, pacing, transitions, sparse creator-native text overlays, and emotional arc. Must include a NATURAL ENDING at 20s (not cut off). This is a DIRECTOR'S VISION, not a storyboard outline.
- "angle": The marketing angle (must map to what's working in the winning ads)
- "headline": Short punchy headline (max 40 chars) — modeled after winning ad headline patterns
- "adCopy": Full ad copy (3-10 sentences with formatting, emojis, bullets matching the winning ads' style exactly)`,
      },
      {
        role: 'user',
        content: `Generate 5 vertical Reels VIDEO concepts for this product.

${productInfo}${productDescription}
${anglesInfo}${winningAdsContext}${parentContext}

YOUR TASK — BE A CREATIVE DIRECTOR:
1. FIRST: Analyze all the winning ads above. Identify the TOP 5 CONCEPTS/ANGLES that are actually driving conversions (look at ROAS, purchases, CTR, copy style, video DNA). Name each angle clearly (e.g. "Mom testimonial comparing brands", "Urgency countdown with ingredient callout", "Before/after transformation").
2. For each video prompt: Double down on ONE winning concept. Describe a COMPLETE 20-second scene — the content creator (who they are, their vibe, their energy), the hook (first 1-3 seconds), the relatable context, the product moment, the reaction, and a natural closing. The video must feel COMPLETE at 20 seconds — not cut off. Include camera angles, lighting, pacing, transitions, and any text overlays.
3. The product photo is the first frame — describe what happens NEXT.
4. The creator in the video must sound human and casual, like a TikTok influencer talking to a friend. Use slightly imperfect spoken delivery, light filler words, and relaxed body language. Do NOT make the person sound like an ad, presenter, or spokesperson.
5. The adCopy MUST feel identical in voice to the winning ads — same emoji usage, same formatting, same energy. Copy the exact persuasion patterns that are converting.
6. Each concept doubles down on a DIFFERENT winning pattern from the data — don't make up angles, extract them from what's already working.
7. All content is VERTICAL 9:16 for Reels/TikTok.
8. Keep on-screen text minimal and native. Avoid polished commercial supers unless the winning ads clearly rely on them.
9. Make the video prompts so vivid and detailed that anyone reading them can picture the exact video in their head — the person's face, their pauses, their excitement, the camera movements, the transitions, everything.
10. In the "angle" field, clearly name the winning concept you're doubling down on AND reference which winning ad(s) inspired it.
${offer ? `11. Include the offer "${offer}" in every ad copy.` : ''}`,
      },
    ]);

    const parsed = JSON.parse(result.content);
    const videoPrompts = parsed.videoPrompts || [];
    const imagePrompts = parsed.imagePrompts || [];

    db.prepare(`
      UPDATE creative_batches SET
        video_prompts = ?, image_prompts = ?,
        status = 'prompts_ready', updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(videoPrompts), JSON.stringify(imagePrompts), id);

    return NextResponse.json({
      success: true,
      videoPrompts,
      imagePrompts,
      usage: result.usage,
    });
  } catch (err: any) {
    db.prepare("UPDATE creative_batches SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
