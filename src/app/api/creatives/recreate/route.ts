import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { chatCompletion, ChatContentPart } from '@/lib/openai-chat';
import { createVideo as soraCreate } from '@/lib/sora';
import { createVideo as veoCreate } from '@/lib/veo';
import { createVideo as mmCreateVideo } from '@/lib/minimax';
import crypto from 'crypto';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/creatives/recreate
 * Takes a winning ad's Twelve Labs DNA analysis, transforms it via ChatGPT
 * into a video generation prompt, and generates a new video with a different product.
 */
export async function POST(req: NextRequest) {
  const { storeId, adId, productId, engine = 'veo', duration: requestedDuration } = await req.json();

  if (!storeId || !adId || !productId) {
    return NextResponse.json({ error: 'storeId, adId, and productId required' }, { status: 400 });
  }

  const db = getDb();

  // Load DNA analysis from ad_spend
  const adRow: any = db.prepare(
    'SELECT ad_id, ad_name, video_analysis FROM ad_spend WHERE ad_id = ? AND store_id = ? AND video_analysis IS NOT NULL LIMIT 1'
  ).get(adId, storeId);

  if (!adRow?.video_analysis) {
    return NextResponse.json({ error: 'No video DNA analysis found for this ad. Analyze the video first.' }, { status: 400 });
  }

  // Load product
  const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }
  if (!product.image_url) {
    return NextResponse.json({ error: 'Product has no image. Add an image first.' }, { status: 400 });
  }

  // Parse all product images
  let allProductImages: string[] = [];
  if (product.images) {
    try { allProductImages = JSON.parse(product.images); } catch {}
  }
  if (product.image_url && !allProductImages.includes(product.image_url)) {
    allProductImages.unshift(product.image_url);
  }

  // Engine duration limits
  const durationLimits: Record<string, { min: number; max: number; allowed: number[] }> = {
    veo: { min: 4, max: 8, allowed: [4, 6, 8] },
    sora: { min: 8, max: 20, allowed: [8, 16, 20] },
    minimax: { min: 5, max: 10, allowed: [5, 6, 7, 8, 9, 10] },
  };
  const limits = durationLimits[engine] || durationLimits.veo;

  try {
    // Step 1: ChatGPT transforms DNA → video generation prompt
    const result = await chatCompletion([
      {
        role: 'system',
        content: `You are an expert at converting detailed video ad DNA analyses into AI video generation prompts.

YOUR TASK: Read the DNA analysis of a winning ad, then write a video generation prompt that recreates the EXACT same creative DNA — same hook type, same pacing, same camera work, same transitions, same emotional arc, same energy level — but featuring a DIFFERENT product.

THE VIDEO MUST LOOK 100% REAL — NOT AI-GENERATED:
Your prompt must produce a video that is indistinguishable from real iPhone/DSLR footage. This is the #1 priority.

REALISM RULES — include these cues in EVERY prompt:
- Shot on iPhone 15 Pro or Canon R5 — specify the camera in the prompt
- Natural, imperfect handheld camera movement — slight shake, not robotic smooth pans
- Real-world lighting: warm golden hour sunlight, soft window light, bathroom vanity lighting, or ring light with natural shadows — NOT flat, even, CGI-style lighting
- Shallow depth of field with natural bokeh on background elements
- Subtle lens imperfections: minor chromatic aberration, natural vignette, slight overexposure on highlights
- Real environment with lived-in details: slightly messy countertop, real bathroom tiles, bedroom nightstand clutter, kitchen marble counter with water drops
- Human skin texture if hands appear: visible pores, natural skin tone variation, slight shine
- Product interactions look physical: fingerprints on bottles, slight reflections on glossy surfaces, real shadows underneath products
- Natural audio environment cues: describe ambient sound (room tone, faint music from another room)
- UGC aesthetic: slightly warm color grade, NOT oversaturated or HDR-looking
- Avoid ANY of these AI tells: perfectly symmetrical compositions, plastic-looking textures, impossibly smooth surfaces, floating objects, warped text, extra fingers, morphing shapes, unnaturally perfect lighting

CREATIVE DNA RULES:
1. Keep the EXACT same creative structure (hook → problem → solution → payoff)
2. Match the same pacing and edit rhythm described in the DNA
3. Use the same camera angles and movements
4. Replicate the same lighting and color tone
5. Match the content creator energy and speaking style
6. Keep the same text overlay style and positioning
7. Reproduce the same emotional arc timing
8. SWAP the product — describe the NEW product being held, shown, and featured
9. The prompt should be 300-500 words describing a complete scene — be VERY specific about physical details
10. Format: vertical 9:16 for Reels/TikTok

CRITICAL — PRODUCT APPEARANCE ACCURACY:
- Study the provided product images and description VERY carefully
- In your prompt, describe EVERY product's exact packaging: bottle color, cap color, label design, text on labels, and branding
- Do NOT invent or change packaging colors/designs — describe them EXACTLY as shown in the images
- If the description says "black bottles" do NOT make them orange, pink, clear, or any other color
- Repeat the exact packaging details multiple times in the prompt to reinforce accuracy
- If the product is a bundle with multiple items, describe EACH item's appearance individually and explicitly state they share the same branding style

Duration must be between ${limits.min} and ${limits.max} seconds. Pick the closest to the original video's length.

Return JSON only:
{
  "prompt": "detailed scene description...",
  "duration": <integer seconds>,
  "title": "short title max 50 chars"
}`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text' as const,
            text: `═══ WINNING AD DNA ANALYSIS ═══
${adRow.video_analysis}

═══ NEW PRODUCT TO FEATURE ═══
Product: ${product.title}
${product.description ? `Description: ${product.description}\n` : ''}Price: $${(product.price_cents / 100).toFixed(2)}
Category: ${product.category || 'N/A'}
SKU: ${product.sku || 'N/A'}

Below are ${allProductImages.length} product image(s). Study ALL of them carefully to understand the product's EXACT appearance — bottle/container colors, cap colors, label colors, text on labels, branding style, and overall look.

IMPORTANT: In your video prompt, describe every product's packaging in EXPLICIT detail (e.g. "a matte black canister with black lid and white text reading PureBite"). Do NOT generalize or guess colors — match exactly what you see in the images. If multiple products appear, describe EACH one's exact packaging individually and emphasize they share the same branding.

Transform this DNA into a video generation prompt that recreates the same ad but with "${product.title}" as the featured product. The primary product image will be provided as the first frame — describe what happens around it and after it.`,
          },
          ...allProductImages.map((url: string): ChatContentPart => ({
            type: 'image_url' as const,
            image_url: { url, detail: 'high' },
          })),
        ],
      },
    ]);

    const parsed = JSON.parse(result.content);
    const prompt = parsed.prompt;
    // Use user-selected duration, fall back to ChatGPT suggestion
    const rawDuration = requestedDuration ? parseInt(requestedDuration) : (parseInt(parsed.duration) || limits.max);
    // Snap to nearest allowed duration
    const duration = limits.allowed.reduce((prev, curr) =>
      Math.abs(curr - rawDuration) < Math.abs(prev - rawDuration) ? curr : prev
    );
    const title = parsed.title || `${product.title} - DNA Recreate`;

    // Step 2: Generate video with selected engine
    const creativeId = crypto.randomUUID();
    let nbVideoId = '';
    let templateId = engine;

    if (engine === 'veo') {
      const veoResult = await veoCreate(prompt, {
        aspectRatio: '9:16',
        durationSeconds: String(duration) as '4' | '6' | '8',
        resolution: '720p',
        imageUrl: product.image_url,
      });
      nbVideoId = veoResult.operationName;
    } else if (engine === 'sora') {
      // Sora requires input_reference image to exactly match video dimensions (720x1280)
      // Download product image and resize to 720x1280 using sharp
      let imageBuffer: Buffer | undefined;
      try {
        const imgRes = await fetch(product.image_url);
        if (imgRes.ok) {
          const imgArrayBuf = await imgRes.arrayBuffer();
          imageBuffer = await sharp(Buffer.from(imgArrayBuf))
            .resize(720, 1280, {
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .png()
            .toBuffer();
        }
      } catch (e) {
        // If resize fails, proceed without image — prompt-only generation
        console.error('Failed to resize product image for Sora:', e);
      }

      const soraResult = await soraCreate(prompt, {
        model: 'sora-2',
        size: '720x1280',
        seconds: String(duration) as '8' | '16' | '20',
        ...(imageBuffer ? { imageBuffer, imageMimeType: 'image/png' } : {}),
      });
      nbVideoId = soraResult.videoId;
    } else if (engine === 'minimax') {
      const mmResult = await mmCreateVideo(prompt, {
        firstFrameImage: product.image_url,
        duration,
      });
      nbVideoId = mmResult.taskId;
    } else {
      return NextResponse.json({ error: `Unsupported engine: ${engine}` }, { status: 400 });
    }

    // Step 3: Save creative
    db.prepare(`
      INSERT INTO creatives (id, store_id, product_id, type, title, description, angle, nb_video_id, nb_status, status, template_id, created_at, updated_at)
      VALUES (?, ?, ?, 'video', ?, ?, 'dna-recreate', ?, 'processing', 'draft', ?, datetime('now'), datetime('now'))
    `).run(creativeId, storeId, productId, title, prompt, nbVideoId, templateId);

    return NextResponse.json({
      success: true,
      creativeId,
      engine,
      duration,
      title,
      prompt,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
