import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createVideo as soraCreate } from '@/lib/sora';
import { chatCompletion, ChatContentPart } from '@/lib/openai-chat';
import crypto from 'crypto';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

/**
 * Enrich a short video concept into a detailed, Sora-ready director's brief
 * using ChatGPT with product images (vision), product description, and winning ad DNA.
 */
async function enrichVideoPrompt(
  concept: { prompt: string; angle: string; headline: string },
  product: { title: string; description: string | null; imageUrls: string[]; priceCents: number },
  winningDna: string,
  offer: string,
): Promise<string> {
  const result = await chatCompletion([
    {
      role: 'system',
      content: `You are a hyper-detailed AI video director. Your job is to take a short video ad concept and transform it into an extremely detailed, frame-by-frame video generation prompt for Sora (AI video generator).

THE VIDEO MUST LOOK 100% REAL — INDISTINGUISHABLE FROM iPHONE FOOTAGE:
- Shot on iPhone 15 Pro — natural handheld shake, NOT robotic smooth
- Real-world lighting: warm golden hour, soft window light, bathroom vanity, ring light — with natural shadows, NOT flat CGI lighting
- Shallow depth of field with real bokeh on background
- Lens imperfections: slight chromatic aberration, natural vignette, minor overexposure on highlights
- Lived-in environment: slightly messy countertop, real bathroom tiles, bedroom clutter, kitchen marble with water drops
- Human skin texture if hands appear: pores, natural skin tone variation, slight shine
- Physical product interaction: fingerprints on bottles, real shadows underneath, slight reflections
- UGC warm color grade — NOT oversaturated or HDR
- AVOID all AI tells: perfect symmetry, plastic textures, impossibly smooth surfaces, floating objects, warped text, morphing shapes, extra fingers

PRODUCT APPEARANCE — CRITICAL:
Study the product images provided. Describe EVERY product's exact packaging in the prompt:
- Exact bottle/container colors, cap colors, label text, branding
- Do NOT invent or change any colors or designs
- Repeat packaging details to reinforce accuracy
- If it's a bundle, describe EACH item individually

CREATOR DELIVERY — CRITICAL:
- This must feel like casual TikTok creator content, not a polished commercial
- The person should speak like they are talking to a friend, not presenting to an audience
- Use lightly imperfect spoken delivery: short pauses, minor restarts, filler words like "okay", "wait", "honestly", "literally", "I mean"
- Keep the energy warm, conversational, and believable
- Avoid hard-selling, announcer tone, polished spokesperson energy, or aggressive urgency
- Body language should be relaxed: natural smile, subtle hand movements, occasional glance off-camera, small framing imperfections
- The person can sound impressed or genuinely into the product, but never like a scripted ad read
- If text appears on screen, keep it minimal and native to TikTok creator content, not brand-commercial graphics

FORMAT:
- 20 seconds EXACTLY, vertical 9:16 (720x1280)
- The product image is the first frame — describe what happens AFTER frame 1
- 1200-1800 characters of ultra-specific visual direction
- Describe second-by-second in blocks: 0-3s (SCROLL-STOPPER), 3-7s (REAL-LIFE CONTEXT), 7-13s (PRODUCT MOMENT), 13-17s (PERSONAL REACTION), 17-20s (NATURAL CLOSE)
- The video MUST have a natural conclusion at exactly 20 seconds — NOT cut off mid-action
- End with a clear closing moment: person finishing a thought, holding the product casually, setting it down naturally, or giving a small satisfied nod
- Include specific environment details that make it feel real
- Describe camera angles, movements, and transitions for EACH time block

Return ONLY the enriched prompt as PLAIN TEXT — no JSON, no markdown, no bold, no headers, no HTML. Just a continuous paragraph of visual direction between 1200 and 1800 characters. Be dense and specific — every word matters.`,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text' as const,
          text: `═══ VIDEO CONCEPT TO EXPAND ═══
Angle: ${concept.angle}
Headline: ${concept.headline}
Concept: ${concept.prompt}
${offer ? `Offer: ${offer}` : ''}

═══ PRODUCT ═══
Name: ${product.title}
${product.description ? `Description: ${product.description}` : ''}
Price: $${(product.priceCents / 100).toFixed(2)}

Below are ${product.imageUrls.length} product image(s). Study them to understand the EXACT appearance of every bottle/container — colors, labels, text, caps, branding. Your prompt must describe these precisely.

═══ WINNING AD DNA (what's converting — replicate this energy) ═══
${winningDna || 'No DNA analysis available — use best practices for UGC health/beauty ads.'}

Take this concept and write an extremely detailed, second-by-second director's brief that Sora can use to generate a photorealistic video. Include the person's exact appearance, expressions, camera angles, lighting, product interactions, sparse on-screen text, and environment details. Make it feel like a real iPhone TikTok creator clip, not AI-generated and not like a polished brand ad. The speech should sound natural, slightly imperfect, and conversational.`,
        },
        ...product.imageUrls.map((url): ChatContentPart => ({
          type: 'image_url' as const,
          image_url: { url, detail: 'high' },
        })),
      ],
    },
  ]);

  // Clean up: strip any HTML, markdown formatting, and control characters
  let cleaned = result.content
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .replace(/\*\*/g, '')     // Strip bold markdown
    .replace(/#{1,6}\s/g, '') // Strip markdown headers
    .replace(/[\r\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Strip control chars
    .trim();

  // Sora has a prompt length limit — cap at 2000 chars
  if (cleaned.length > 2000) {
    cleaned = cleaned.substring(0, 1997) + '...';
  }

  return cleaned;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const db = getDb();

  const batch: any = db.prepare('SELECT * FROM creative_batches WHERE id = ?').get(id);
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  // Use overrides from request body or saved prompts
  const videoPrompts = body.videoPrompts || (batch.video_prompts ? JSON.parse(batch.video_prompts) : []);
  const imagePrompts = body.imagePrompts || (batch.image_prompts ? JSON.parse(batch.image_prompts) : []);

  if (videoPrompts.length === 0 && imagePrompts.length === 0) {
    return NextResponse.json({ error: 'No prompts available. Generate prompts first.' }, { status: 400 });
  }

  // Save any overrides back to batch
  if (body.videoPrompts) {
    db.prepare('UPDATE creative_batches SET video_prompts = ? WHERE id = ?').run(JSON.stringify(body.videoPrompts), id);
  }
  if (body.imagePrompts) {
    db.prepare('UPDATE creative_batches SET image_prompts = ? WHERE id = ?').run(JSON.stringify(body.imagePrompts), id);
  }

  // ── Load full product context ──
  let productImageUrl: string | null = null;
  let productTitle = '';
  let productDescription: string | null = null;
  let productPriceCents = 0;
  let allProductImages: string[] = [];

  if (batch.product_id) {
    const prod: any = db.prepare('SELECT * FROM products WHERE id = ?').get(batch.product_id);
    if (prod) {
      productTitle = prod.title;
      productDescription = prod.description;
      productPriceCents = prod.price_cents;
      productImageUrl = prod.image_url;

      // Gather all product images
      if (prod.images) {
        try { allProductImages = JSON.parse(prod.images); } catch {}
      }
      if (prod.image_url && !allProductImages.includes(prod.image_url)) {
        allProductImages.unshift(prod.image_url);
      }
    }
  }
  if (!productImageUrl && batch.product_context) {
    const ctx = JSON.parse(batch.product_context);
    productImageUrl = ctx.imageUrl || null;
    productTitle = ctx.title || '';
    productPriceCents = ctx.priceCents || 0;
  }

  // ── Load winning ad DNA analyses ──
  let winningDna = '';
  if (batch.store_id) {
    const dnaAds: any[] = db.prepare(`
      SELECT ad_name, video_analysis,
        SUM(purchases) as purchases,
        ROUND(CAST(SUM(purchase_value_cents) AS REAL) / SUM(spend_cents), 2) as roas
      FROM ad_spend
      WHERE store_id = ? AND video_analysis IS NOT NULL AND ad_id IS NOT NULL
      GROUP BY ad_id
      ORDER BY roas DESC
      LIMIT 5
    `).all(batch.store_id);

    if (dnaAds.length > 0) {
      winningDna = dnaAds.map((ad, i) =>
        `── Winner #${i + 1}: ${ad.ad_name} (ROAS ${ad.roas}x, ${ad.purchases} purchases) ──\n${ad.video_analysis}`
      ).join('\n\n');
    }
  }

  const offer = batch.offer || '';

  db.prepare("UPDATE creative_batches SET status = 'generating', updated_at = datetime('now') WHERE id = ?").run(id);

  const creatives: any[] = [];
  const insertStmt = db.prepare(`
    INSERT INTO creatives (id, store_id, type, title, description, angle,
      nb_video_id, nb_status, status, template_id, batch_id, batch_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'draft', ?, ?, ?)
  `);

  // ── Enrich all video prompts via ChatGPT (with product images + DNA) ──
  // Run enrichment in parallel for speed
  const enrichedPrompts: string[] = [];
  if (videoPrompts.length > 0 && allProductImages.length > 0) {
    const enrichTasks = videoPrompts.slice(0, 5).map((p: any) =>
      enrichVideoPrompt(
        { prompt: p.prompt, angle: p.angle || '', headline: p.headline || '' },
        { title: productTitle, description: productDescription, imageUrls: allProductImages, priceCents: productPriceCents },
        winningDna,
        offer,
      ).catch(() => p.prompt) // Fallback to original if enrichment fails
    );
    const results = await Promise.all(enrichTasks);
    enrichedPrompts.push(...results);
  } else {
    // No product images — use original prompts
    enrichedPrompts.push(...videoPrompts.slice(0, 5).map((p: any) => p.prompt));
  }

  // ── Resize product image to 720x1280 for Sora input_reference ──
  let productImageBuffer: Buffer | undefined;
  if (productImageUrl) {
    try {
      const imgRes = await fetch(productImageUrl);
      if (imgRes.ok) {
        const imgArrayBuf = await imgRes.arrayBuffer();
        productImageBuffer = await sharp(Buffer.from(imgArrayBuf))
          .resize(720, 1280, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          })
          .png()
          .toBuffer();
      }
    } catch (e) {
      console.error('Failed to resize product image for Sora:', e);
    }
  }

  // ── Fire off video generations with enriched prompts ──
  const videoTasks = videoPrompts.slice(0, 5).map(async (p: any, idx: number) => {
    const creativeId = crypto.randomUUID();
    const finalPrompt = enrichedPrompts[idx] || p.prompt;
    try {
      const result = await soraCreate(finalPrompt, {
        model: 'sora-2-pro',
        size: '720x1280',
        seconds: '20',
        ...(productImageBuffer
          ? { imageBuffer: productImageBuffer, imageMimeType: 'image/png' }
          : {}),
      });
      insertStmt.run(
        creativeId, batch.store_id, 'video',
        p.headline || `Video ${idx + 1}`, finalPrompt, p.angle || null,
        result.videoId, 'sora', id, idx
      );
      return { id: creativeId, type: 'video', engine: 'sora', videoId: result.videoId, batchIndex: idx, status: 'processing' };
    } catch (err: any) {
      insertStmt.run(
        creativeId, batch.store_id, 'video',
        p.headline || `Video ${idx + 1}`, finalPrompt, p.angle || null,
        null, 'sora', id, idx
      );
      db.prepare("UPDATE creatives SET nb_status = 'failed' WHERE id = ?").run(creativeId);
      return { id: creativeId, type: 'video', engine: 'sora', batchIndex: idx, status: 'failed', error: err.message };
    }
  });

  // Images removed — focusing on video generation only
  const allResults = await Promise.allSettled([...videoTasks]);

  for (const r of allResults) {
    if (r.status === 'fulfilled') {
      creatives.push(r.value);
    }
  }

  // Update batch counts
  const failedCount = creatives.filter(c => c.status === 'failed').length;

  db.prepare(`
    UPDATE creative_batches SET
      total_videos = ?, total_images = 0,
      failed_count = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(videoPrompts.length, failedCount, id);

  return NextResponse.json({ success: true, batchId: id, creatives });
}
