import { requireStoreAccess, assertBillingReady } from '@/lib/auth-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { textToVideo, imageToVideo, getVideoStatus as nbGetStatus } from '@/lib/nanobanana';
import { createVideo as soraCreate, getVideoStatus as soraGetStatus, getVideoDownloadUrl } from '@/lib/sora';
import { createVideo as veoCreate, getVideoStatus as veoGetStatus } from '@/lib/veo';
import { createVideo as mmCreateVideo, getVideoStatus as mmGetVideoStatus, generateImage as mmGenerateImage } from '@/lib/minimax';
import { createVideo as runwayCreate, getVideoStatus as runwayGetStatus } from '@/lib/runway';
import { createVideo as higgsCreate, getVideoStatus as higgsGetStatus } from '@/lib/higgsfield';
import { createTextToVideo as seedanceT2V, createImageToVideo as seedanceI2V, createReferenceToVideo as seedanceR2V, getVideoStatus as seedanceGetStatus, waitForVideo as seedanceWait } from '@/lib/seedance';
import { generateImage as dalleGenerateImage } from '@/lib/dalle';
import { generateImage as geminiGenerateImage } from '@/lib/gemini-image';
import { generateImage as ideogramGenerateImage } from '@/lib/ideogram';
import { generateImage as nanoBananaGenerateImage, editImage as nanoBananaEditImage } from '@/lib/nano-banana-image';
import { selectProvider } from '@/lib/provider-router';
import { describeProductImage } from '@/lib/vision';
import { processVoicePipeline, buildLanguageEnforcement, extractSpokenScript, chunkScriptForSeedance, VOICE_CONFIG } from '@/lib/voice-pipeline';
import { logUsage } from '@/lib/usage-tracking';
import crypto from 'crypto';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

// ═══ Response helpers ═══

function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

function jsonError(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

function getSoraDimensions(size: '1280x720' | '720x1280' | '1920x1080' | '1080x1920') {
  const [width, height] = size.split('x').map((v) => parseInt(v, 10));
  return { width, height };
}

export async function POST(req: NextRequest) {
  // ── Parse body safely ──
  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    return jsonError('INVALID_BODY', 'Request body is not valid JSON', e.message, 400);
  }

  const { storeId, type, prompt: originalPrompt, imageUrls, title, angle, resolution, duration, engine, packageId, packageIndex, dimension, creativeType, coverImageUrl, userSelectedCover } = body;
  // ═══ TENANT ACCESS CHECK ═══
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;
  // ═══ BILLING ENFORCEMENT — non-internal clients must have payment method ═══
  if (storeId && _auth.authorized) {
    const billing = assertBillingReady(storeId, _auth.role);
    if (!billing.allowed) {
      return NextResponse.json({ success: false, error: { code: 'BILLING_REQUIRED', message: billing.reason } }, { status: 402 });
    }
  }


  // ═══ Cover image flow (trace logs — user's explicit selection must survive) ═══
  // Priority: body.coverImageUrl (explicit) > first valid imageUrls (legacy)
  // Accepts https:// URLs AND local /api/ paths (uploaded product images)
  const isValidUrl = (u: any): boolean => typeof u === 'string' && (u.startsWith('https://') || u.startsWith('/api/') || u.startsWith('http://'));
  const resolvedCover: string =
    (isValidUrl(coverImageUrl)) ? coverImageUrl :
    (Array.isArray(imageUrls) && imageUrls.find((u: any) => isValidUrl(u))) || '';
  console.log(`[COVER-TRACE] userSelectedCover=${userSelectedCover === true}`);
  console.log(`[COVER-TRACE] body.coverImageUrl=${coverImageUrl ? String(coverImageUrl).substring(0, 120) : '(absent)'}`);
  console.log(`[COVER-TRACE] body.imageUrls[0]=${imageUrls?.[0] ? String(imageUrls[0]).substring(0, 120) : '(absent)'}`);
  console.log(`[COVER-TRACE] resolvedCover=${resolvedCover ? resolvedCover.substring(0, 120) : '(none)'}`);

  // Generate a vision description of the user-selected cover and inject it into the prompt
  // so the text-to-video engine renders a product that matches THAT specific image.
  // Only runs when a cover is provided. If vision fails, generation proceeds without the
  // description (with a warning log) rather than blocking the user.
  let prompt = originalPrompt;
  if (resolvedCover) {
    const isVideoType = type !== 'text-to-image' && !['dalle', 'gemini-image', 'minimax-image', 'stability', 'ideogram'].includes(type || '');
    if (isVideoType) {
      try {
        const productName = (title || '').replace(/\s+–\s+V\d+.*$/, '').trim();
        const visualDesc = await describeProductImage(resolvedCover, productName);
        if (visualDesc) {
          console.log(`[COVER-TRACE] Vision description generated (${visualDesc.length} chars)`);
          prompt = `PRODUCT VISUAL (from selected cover image — match this exactly):\n${visualDesc}\n\n${originalPrompt}`;
        } else {
          console.log(`[COVER-TRACE] Vision returned null — falling back to text-only prompt`);
        }
      } catch (e: any) {
        console.error(`[COVER-TRACE] Vision threw: ${e.message} — falling back to text-only prompt`);
      }
    }
  }

  if (!storeId || !prompt || !title) {
    return jsonError('MISSING_FIELDS', 'storeId, prompt, and title are required', null, 400);
  }

  const persistedFormat = dimension || resolution || null;

  let db: any;
  try {
    db = getDb();
  } catch (e: any) {
    return jsonError('DB_ERROR', 'Database connection failed', e.message, 500);
  }

  const id = crypto.randomUUID();
  // Use provider router when no explicit engine is passed
  let useEngine = engine;
  if (!useEngine) {
    const isVideo = !['dalle', 'gemini-image', 'minimax-image', 'stability', 'ideogram'].includes(type || '');
    const hasProductImgs = (imageUrls?.some((u: string) => u.startsWith('https://'))) || !!resolvedCover;
    const routerResult = selectProvider({
      contentType: isVideo ? 'video' : 'image',
      creativeType: creativeType || 'testimonial',
      duration: parseInt(duration) || 20,
      aspectRatio: dimension || resolution,
      hasProductImages: !!hasProductImgs,
    });
    useEngine = routerResult.provider;
    console.log(`[GENERATE] Router selected: ${useEngine} | ${routerResult.reason}`);
  }

  try {
    if (useEngine === 'sora') {
      const sizeMap: Record<string, '1280x720' | '720x1280' | '1920x1080' | '1080x1920'> = {
        '720p': '1280x720', '720p-vertical': '720x1280',
        '1080p': '1920x1080', '1080p-vertical': '1080x1920',
      };
      const soraSize = sizeMap[resolution] || '1280x720';
      const durationNum = parseInt(duration) || 20;
      const soraDuration: '8' | '16' | '20' = durationNum <= 8 ? '8' : durationNum <= 16 ? '16' : '20';
      const model = resolution === '1080p' || resolution === '1080p-vertical' ? 'sora-2-pro' : 'sora-2';
      let imageBuffer: Buffer | undefined;

      if (type === 'image-to-video' && imageUrls?.[0] && imageUrls[0].startsWith('https://')) {
        try {
          const imgRes = await fetch(imageUrls[0]);
          if (imgRes.ok) {
            const imgArrayBuf = await imgRes.arrayBuffer();
            const { width, height } = getSoraDimensions(soraSize);
            // Use 'cover' to fill the frame with the product image (no letterboxing)
            // Then composite onto a neutral background so the product fills the frame
            imageBuffer = await sharp(Buffer.from(imgArrayBuf))
              .resize(width, height, { fit: 'cover', position: 'centre' })
              .png().toBuffer();
          }
        } catch (err) {
          console.error('Failed to prepare Sora reference image:', err);
        }
      }

      console.log(`[COVER-TRACE][SORA] prompt length=${prompt.length}, imageBuffer=${!!imageBuffer}`);
      const result = await soraCreate(prompt, {
        model, size: soraSize, seconds: soraDuration,
        ...(imageBuffer ? { imageBuffer, imageMimeType: 'image/png' } : {}),
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'sora', ?, ?)
      `).run(id, storeId, title, prompt, angle || null, result.videoId, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      logUsage({ storeId, provider: 'sora', operationType: 'video', units: parseInt(duration) || 20, jobId: id, metadata: { model: result.model, resolution } });
      return jsonSuccess({ id, engine: 'sora', videoId: result.videoId, model: result.model, seconds: result.seconds, size: result.size });

    } else if (useEngine === 'veo') {
      const veoAspect: '16:9' | '9:16' = resolution?.includes('vertical') || resolution === '9:16' ? '9:16' : '16:9';
      const veoRes = resolution === '1080p' || resolution === '1080p-vertical' ? '1080p' : resolution === '4k' ? '4k' : '720p';
      const veoDuration = duration && duration <= 4 ? '4' : duration && duration <= 6 ? '6' : '8';
      const veoModel = resolution === '4k' || resolution === '1080p' || resolution === '1080p-vertical'
        ? 'veo-3.1-generate-preview' : (body.veoModel || 'veo-3.1-fast-generate-preview');

      const result = await veoCreate(prompt, {
        model: veoModel as any, aspectRatio: veoAspect,
        durationSeconds: veoDuration as any, resolution: veoRes as any,
        ...(type === 'image-to-video' && imageUrls?.[0] ? { imageUrl: imageUrls[0] } : {}),
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'veo', ?, ?)
      `).run(id, storeId, title, prompt, angle || null, result.operationName, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      logUsage({ storeId, provider: 'veo', operationType: 'video', units: parseInt(duration) || 8, jobId: id, metadata: { model: result.model } });
      return jsonSuccess({ id, engine: 'veo', operationName: result.operationName, model: result.model });

    } else if (useEngine === 'minimax') {
      const mmModel = body.mmModel || 'MiniMax-Hailuo-2.3';
      const mmDuration = duration || 6;
      const mmRes = resolution === '720p' || resolution === '720P' ? '720P' : '1080P';

      const result = await mmCreateVideo(prompt, {
        model: mmModel, duration: mmDuration, resolution: mmRes,
        firstFrameImage: type === 'image-to-video' && imageUrls?.[0] ? imageUrls[0] : undefined,
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'minimax', ?, ?)
      `).run(id, storeId, title, prompt, angle || null, result.taskId, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      return jsonSuccess({ id, engine: 'minimax', taskId: result.taskId, model: result.model });

    } else if (useEngine === 'dalle') {
      // OpenAI Image — uses gpt-image-1 with product reference if available, falls back to dall-e-3
      const sizeMap: Record<string, '1024x1024' | '1024x1792' | '1792x1024'> = {
        '1:1': '1024x1024', 'square': '1024x1024', '4:5': '1024x1024',
        '9:16': '1024x1792', 'portrait': '1024x1792',
        '16:9': '1792x1024', 'landscape': '1792x1024',
      };
      const size = sizeMap[resolution] || '1024x1024';
      // Pass the first public product image as reference for exact branding
      const refImage = imageUrls?.find((u: string) => u.startsWith('https://')) || undefined;
      const result = await dalleGenerateImage(prompt, { size, quality: refImage ? 'auto' : 'standard', style: 'natural', referenceImageUrl: refImage });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description, file_url,
          angle, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'image', ?, ?, ?, ?, 'completed', 'draft', 'dalle', ?, ?)
      `).run(id, storeId, title, prompt, result.imageUrl, angle || null, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      return jsonSuccess({ id, engine: 'dalle', model: result.model, imageUrl: result.imageUrl });

    } else if (useEngine === 'gemini-image') {
      // Gemini Flash Image — native image generation with optional product reference
      const refImage = imageUrls?.find((u: string) => u.startsWith('https://')) || undefined;
      const result = await geminiGenerateImage(prompt, { model: 'gemini-2.5-flash-image', referenceImageUrl: refImage });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description, file_url,
          angle, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'image', ?, ?, ?, ?, 'completed', 'draft', 'gemini-image', ?, ?)
      `).run(id, storeId, title, prompt, result.imageUrl, angle || null, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      return jsonSuccess({ id, engine: 'gemini-image', model: result.model, imageUrl: result.imageUrl });

    } else if (useEngine === 'minimax-image') {
      const aspectMap: Record<string, '1:1' | '16:9' | '9:16' | '4:3' | '3:4'> = {
        'square': '1:1', '1:1': '1:1', 'landscape': '16:9', '16:9': '16:9',
        'portrait': '9:16', '9:16': '9:16', '4:3': '4:3', '3:4': '3:4',
      };
      const aspect = aspectMap[resolution] || '16:9';
      const result = await mmGenerateImage(prompt, { aspectRatio: aspect });
      const imageUrl = result.imageUrl;

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description, file_url,
          angle, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'image', ?, ?, ?, ?, 'completed', 'draft', 'minimax-image', ?, ?)
      `).run(id, storeId, title, prompt, imageUrl || null, angle || null, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      return jsonSuccess({ id, engine: 'minimax-image', model: result.model, imageUrl });

    } else if (useEngine === 'ideogram') {
      const arMap: Record<string, '1:1' | '4:5' | '9:16' | '16:9'> = {
        'square': '1:1', '1:1': '1:1', '4:5': '4:5', 'portrait': '4:5',
        '9:16': '9:16', '16:9': '16:9', 'landscape': '16:9',
      };
      const result = await ideogramGenerateImage(prompt, { aspectRatio: arMap[resolution] || '4:5' });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description, file_url,
          angle, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'image', ?, ?, ?, ?, 'completed', 'draft', 'ideogram', ?, ?)
      `).run(id, storeId, title, prompt, result.imageUrl, angle || null, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      return jsonSuccess({ id, engine: 'ideogram', model: result.model, imageUrl: result.imageUrl });

    } else if (useEngine === 'nano-banana') {
      const refImage = imageUrls?.find((u: string) => u.startsWith('https://')) || undefined;
      const arMap: Record<string, string> = { '1:1': '1:1', '4:5': '4:5', '9:16': '9:16', '16:9': '16:9', 'square': '1:1', 'portrait': '4:5' };
      let result;
      if (refImage) {
        result = await nanoBananaEditImage(prompt, [refImage], { aspectRatio: arMap[resolution] || '4:5', resolution: '2K' });
      } else {
        result = await nanoBananaGenerateImage(prompt, { aspectRatio: arMap[resolution] || '4:5', resolution: '2K' });
      }

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description, file_url,
          angle, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'image', ?, ?, ?, ?, 'completed', 'draft', 'nano-banana', ?, ?)
      `).run(id, storeId, title, prompt, result.imageUrl, angle || null, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      return jsonSuccess({ id, engine: 'nano-banana', model: result.model, imageUrl: result.imageUrl });

    } else if (useEngine === 'runway') {
      // Runway Gen-4 — image-to-video
      if (!imageUrls?.[0]) {
        return jsonError('MISSING_IMAGE', 'Runway requires a product image. Select a product with images first.', null, 400);
      }
      const runwayDuration: 5 | 10 = (parseInt(duration) || 10) <= 5 ? 5 : 10;

      const result = await runwayCreate(prompt, imageUrls[0], {
        duration: runwayDuration,
        ratio: '720:1280', // vertical 9:16
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'runway', ?, ?)
      `).run(id, storeId, title, prompt, angle || null, result.taskId, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      return jsonSuccess({ id, engine: 'runway', taskId: result.taskId });

    } else if (useEngine === 'higgsfield') {
      // Higgsfield DOP Turbo — image-to-video
      if (!imageUrls?.[0]) {
        return jsonError('MISSING_IMAGE', 'Higgsfield requires a product image. Select a product with images first.', null, 400);
      }

      const result = await higgsCreate(prompt, imageUrls[0]);

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'higgsfield', ?, ?)
      `).run(id, storeId, title, prompt, angle || null, result.requestId, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      return jsonSuccess({ id, engine: 'higgsfield', requestId: result.requestId });

    } else if (useEngine === 'seedance') {
      // ═══ SEEDANCE — single full-duration render (4-15s) ═══
      // Seedance handles up to 15s natively. No scene splitting needed.
      // Clean prompt: visual directions + natural dialogue (separated).
      // Product image via I2V starting frame when available.
      const { parsePromptIntoScenes, renderScene, buildCaptions } = await import('@/lib/seedance-pipeline');

      const seedDuration = Math.max(4, Math.min(15, parseInt(duration) || 8));
      const seedAspect = dimension === '16:9' ? '16:9' : dimension === '1:1' ? '1:1' : '9:16';

      // Resolve product image for I2V mode
      // Use ANY available image: imageUrls[0], resolvedCover, or coverImageUrl
      // Do NOT gate on type === 'image-to-video' — the frontend may send 'text-to-video'
      // even when a cover image is selected.
      let resolvedImageUrl: string | null = null;
      const rawImageUrl = imageUrls?.[0] || resolvedCover || null;
      if (rawImageUrl) {
        if (rawImageUrl.startsWith('https://') || rawImageUrl.startsWith('http://')) {
          // Validate the URL is accessible before passing to Seedance
          try {
            const headRes = await fetch(rawImageUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
            if (headRes.ok) {
              resolvedImageUrl = rawImageUrl;
              console.log(`[SEEDANCE] Product image validated (HTTP ${headRes.status}): ${rawImageUrl.substring(0, 80)}...`);
            } else {
              console.error(`[SEEDANCE] Product image URL returned HTTP ${headRes.status}: ${rawImageUrl.substring(0, 80)}`);
            }
          } catch (fetchErr: any) {
            console.error(`[SEEDANCE] Product image URL unreachable: ${fetchErr.message}`);
          }
        } else if (rawImageUrl.startsWith('/api/products/uploads?file=') || rawImageUrl.startsWith('/api/')) {
          try {
            const { readFile: rf } = await import('fs/promises');
            const pathMod = await import('path');
            const filename = new URL(rawImageUrl, 'http://localhost').searchParams.get('file');
            if (filename) {
              const filePath = pathMod.join(process.cwd(), 'public', 'uploads', filename);
              const buf = await rf(filePath);
              const ext = filename.split('.').pop()?.toLowerCase() || 'png';
              const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
              resolvedImageUrl = `data:${mime};base64,${buf.toString('base64')}`;
              console.log(`[SEEDANCE] Product image loaded from disk: ${filename} (${buf.length} bytes)`);
            }
          } catch (e: any) {
            console.error(`[SEEDANCE] Local file resolve failed: ${e.message}`);
          }
        }
      }

      // Product reference enforcement
      const hasProductImage = !!resolvedImageUrl;
      console.log(`[SEEDANCE] Product image selected: ${rawImageUrl ? 'true' : 'false'}`);
      console.log(`[SEEDANCE] Product image resolved: ${hasProductImage}`);
      if (rawImageUrl && !resolvedImageUrl) {
        // Product was selected but couldn't be resolved — fail the job
        return jsonError('PRODUCT_RESOLVE_FAILED', 'Selected product image could not be loaded. Please try a different image.', { imageUrl: rawImageUrl }, 400);
      }

      // Get product description for visual context
      let productDesc: string | undefined;
      if (resolvedCover) {
        try {
          const productName = (title || '').replace(/\s+–\s+V\d+.*$/, '').trim();
          productDesc = await describeProductImage(resolvedCover, productName) || undefined;
        } catch {}
      }

      // Parse prompt into visual + dialogue (one scene, full duration)
      const scenes = parsePromptIntoScenes(originalPrompt, seedDuration, hasProductImage);
      // Merge all scenes into one full-duration scene for single Seedance render
      const mergedScene = {
        sceneIndex: 0,
        spokenScript: scenes.map(s => s.spokenScript).join(' '),
        visualPrompt: scenes[0]?.visualPrompt || 'UGC selfie video. Person talking to camera in natural light.',
        duration: seedDuration,
        productVisible: hasProductImage,
        productInHand: hasProductImage,
        productNearFace: false,
      };

      console.log(`[SEEDANCE] Duration: ${seedDuration}s (full, no scene split)`);
      console.log(`[SEEDANCE] Mode: ${hasProductImage ? 'I2V (product as starting frame)' : 'T2V (no product image)'}`);
      console.log(`[SEEDANCE] Visual: "${mergedScene.visualPrompt.substring(0, 80)}..."`);
      console.log(`[SEEDANCE] Spoken: "${mergedScene.spokenScript.substring(0, 80)}..."`);
      console.log(`[SEEDANCE] Product visible: ${mergedScene.productVisible}, attached: ${hasProductImage}`);

      // Render single full-duration scene
      const job = await renderScene({
        scene: mergedScene,
        productImageUrl: resolvedImageUrl,
        productDescription: productDesc,
        aspectRatio: seedAspect,
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'seedance', ?, ?)
      `).run(id, storeId, title, prompt, angle || null, job.requestId, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      // Save spoken script + captions
      const spokenScript = mergedScene.spokenScript;
      try {
        db.prepare('UPDATE creatives SET template_data = ? WHERE id = ?').run(
          JSON.stringify({
            voiceoverScript: spokenScript,
            voiceoverPending: false,
            seedanceTier: hasProductImage ? 'image-to-video' : 'text-to-video',
            captionText: spokenScript,
            captionSource: 'spoken_script',
            productAttached: hasProductImage,
          }),
          id,
        );
      } catch {}

      logUsage({ storeId, provider: 'seedance', operationType: 'video', units: seedDuration, jobId: id, metadata: { tier: hasProductImage ? 'i2v' : 't2v', resolution: '480p' } });
      return jsonSuccess({ id, engine: 'seedance', requestId: job.requestId, model: job.model, tier: hasProductImage ? 'image-to-video' : 'text-to-video' });

    } else {
      // NanoBanana
      let result;
      if (type === 'image-to-video' && imageUrls?.length > 0) {
        result = await imageToVideo(imageUrls, prompt, { resolution, duration });
      } else {
        result = await textToVideo(prompt, { resolution, duration });
      }

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description, file_url, thumbnail_url,
          angle, nb_video_id, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'video', ?, ?, ?, ?, ?, ?, 'processing', 'draft', 'nanobanana', ?, ?)
      `).run(id, storeId, title, prompt, result.videoUrl || null, result.thumbnailUrl || null,
        angle || null, result.videoId, packageId || null, packageIndex ?? null);

      logUsage({ storeId, provider: 'nano-banana', operationType: 'video', units: parseInt(duration) || 10, jobId: id, metadata: { resolution } });
      return jsonSuccess({ id, engine: 'nanobanana', videoId: result.videoId, videoUrl: result.videoUrl, thumbnailUrl: result.thumbnailUrl, creditsUsed: result.creditsUsed });
    }
  } catch (err: any) {
    // Save failed creative — wrapped in its own try/catch so a DB error here doesn't crash
    try {
      const creativeType = useEngine === 'minimax-image' ? 'image' : 'video';
      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description, angle, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, ?, ?, ?, ?, 'failed', 'draft', ?, ?, ?)
      `).run(id, storeId, creativeType, title, prompt, angle || null, useEngine, packageId || null, packageIndex ?? null);
    } catch {}

    // Detect quota/billing errors specifically
    const isQuota = err.isQuota || err.code === 'insufficient_quota' || err.status === 429
      || (err.message && (err.message.includes('quota') || err.message.includes('depleted') || err.message.includes('billing')));
    if (isQuota) {
      const alternatives: Record<string, string> = {
        sora: 'Try MiniMax (up to 6s) or Runway (up to 10s)',
        veo: 'Try MiniMax (up to 6s) or Sora (up to 20s)',
        minimax: 'Try Veo (up to 8s) or Sora (up to 20s)',
        runway: 'Try MiniMax (up to 6s) or Sora (up to 20s)',
      };
      const alt = alternatives[useEngine] || 'Try a different engine';
      console.error(`[QUOTA] ${useEngine} quota exceeded for store ${storeId}`);
      return jsonError('QUOTA_EXCEEDED', `${useEngine} credits depleted. ${alt}. Top up at your provider's billing page.`, { engine: useEngine, id }, 429);
    }
    return jsonError('PROVIDER_ERROR', `${useEngine} error: ${err.message?.substring(0, 200)}`, { engine: useEngine, id }, 500);
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return jsonError('MISSING_ID', 'id query parameter is required', null, 400);
  }

  let db: any;
  try {
    db = getDb();
  } catch (e: any) {
    return jsonError('DB_ERROR', 'Database connection failed', e.message, 500);
  }

  const creative: any = db.prepare('SELECT * FROM creatives WHERE id = ?').get(id);
  if (!creative) {
    return jsonError('NOT_FOUND', 'Creative not found', null, 404);
  }

  if (!creative.nb_video_id || creative.nb_status === 'completed' || creative.nb_status === 'failed') {
    return jsonSuccess({ creative });
  }

  const engineType = creative.template_id;

  try {
    if (engineType === 'sora') {
      const status = await soraGetStatus(creative.nb_video_id);
      if (status.status === 'completed') {
        const downloadUrl = await getVideoDownloadUrl(creative.nb_video_id);

        // Strip audio from Sora video — Sora generates glitchy background sounds
        let finalUrl = downloadUrl;
        try {
          const { execSync } = await import('child_process');
          const { writeFileSync, mkdirSync, unlinkSync } = await import('fs');
          const path = await import('path');
          const tmpDir = path.join(process.cwd(), 'tmp');
          mkdirSync(tmpDir, { recursive: true });
          const tmpIn = path.join(tmpDir, `sora_${id}.mp4`);
          const outName = `sora_silent_${id}.mp4`;
          const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
          mkdirSync(uploadsDir, { recursive: true });
          const tmpOut = path.join(uploadsDir, outName);

          // Download from Sora (needs auth header)
          const key = process.env.OPENAI_API_KEY || '';
          const dlRes = await fetch(downloadUrl, { headers: { 'Authorization': `Bearer ${key}` } });
          if (dlRes.ok) {
            writeFileSync(tmpIn, Buffer.from(await dlRes.arrayBuffer()));
            // Remove audio track entirely
            execSync(`ffmpeg -y -i "${tmpIn}" -an -c:v copy "${tmpOut}"`, { timeout: 30000, stdio: 'pipe' });
            finalUrl = `/api/products/uploads?file=${outName}`;
            console.log(`[SORA] Stripped audio from video ${id}`);
            try { unlinkSync(tmpIn); } catch {}
          }
        } catch (e: any) {
          console.error(`[SORA] Audio strip failed (using original):`, e.message);
        }

        db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now') WHERE id = ?").run(finalUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = finalUrl;
      } else if (status.status === 'failed') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }
      return jsonSuccess({ creative, status: status.status, progress: status.progress });

    } else if (engineType === 'veo') {
      const status = await veoGetStatus(creative.nb_video_id);
      if (status.status === 'completed' && status.videoUrl) {
        db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now') WHERE id = ?").run(status.videoUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = status.videoUrl;
      } else if (status.status === 'failed') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }
      return jsonSuccess({ creative, status: status.status });

    } else if (engineType === 'minimax') {
      const status = await mmGetVideoStatus(creative.nb_video_id);
      if (status.status === 'completed' && status.videoUrl) {
        db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now') WHERE id = ?").run(status.videoUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = status.videoUrl;
      } else if (status.status === 'failed') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }
      return jsonSuccess({ creative, status: status.status, providerError: status.error });

    } else if (engineType === 'runway') {
      const status = await runwayGetStatus(creative.nb_video_id);
      if (status.status === 'SUCCEEDED' && status.videoUrl) {
        db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now') WHERE id = ?").run(status.videoUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = status.videoUrl;
      } else if (status.status === 'FAILED') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }
      return jsonSuccess({ creative, status: status.status === 'SUCCEEDED' ? 'completed' : status.status === 'FAILED' ? 'failed' : 'processing', progress: status.progress, providerError: status.error });

    } else if (engineType === 'higgsfield') {
      const status = await higgsGetStatus(creative.nb_video_id);
      if (status.status === 'completed' && status.videoUrl) {
        db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now') WHERE id = ?").run(status.videoUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = status.videoUrl;
      } else if (status.status === 'failed' || status.status === 'nsfw') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }
      return jsonSuccess({ creative, status: status.status === 'completed' ? 'completed' : status.status === 'failed' || status.status === 'nsfw' ? 'failed' : 'processing', providerError: status.error });

    } else if (engineType === 'seedance') {
      // ═══ SEEDANCE NATIVE — no external TTS, no ffmpeg mux ═══
      // Seedance handles speech + lip sync + timing natively (generate_audio: true).
      // Output is used directly. No audio replacement.
      const status = await seedanceGetStatus(creative.nb_video_id);
      if (status.status === 'COMPLETED' && status.videoUrl) {
        const templateData = creative.template_data ? JSON.parse(creative.template_data) : null;

        console.log(`[SEEDANCE] Job ${id} completed`);
        console.log(`[SEEDANCE] Native audio used: true`);
        console.log(`[SEEDANCE] External TTS used: false`);
        console.log(`[SEEDANCE] Video URL: ${status.videoUrl.substring(0, 80)}...`);

        // Mark complete — captions from spoken script, not provider transcript
        db.prepare('UPDATE creatives SET template_data = ? WHERE id = ?').run(
          JSON.stringify({
            ...templateData,
            voiceoverPending: false,
            voiceoverApplied: false,
            voiceProvider: 'seedance-native',
            captionText: templateData?.captionText || templateData?.voiceoverScript || '',
            captionSource: 'spoken_script',
          }), id
        );

        db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now') WHERE id = ?").run(status.videoUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = status.videoUrl;
      } else if (status.status === 'FAILED') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }
      return jsonSuccess({ creative, status: status.status === 'COMPLETED' ? 'completed' : status.status === 'FAILED' ? 'failed' : 'processing', providerError: status.error });

    } else {
      // NanoBanana
      const status = await nbGetStatus(creative.nb_video_id);
      if (status.status === 'completed') {
        db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = COALESCE(?, file_url), thumbnail_url = COALESCE(?, thumbnail_url), updated_at = datetime('now') WHERE id = ?")
          .run(status.videoUrl || null, status.thumbnailUrl || null, id);
        creative.nb_status = 'completed';
        creative.file_url = status.videoUrl || creative.file_url;
        creative.thumbnail_url = status.thumbnailUrl || creative.thumbnail_url;
      } else if (status.status === 'failed') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }
      return jsonSuccess({ creative, status: status.status });
    }
  } catch (err: any) {
    return jsonError('POLL_ERROR', `Failed to poll ${engineType} status: ${err.message}`, { creative }, 500);
  }
}
