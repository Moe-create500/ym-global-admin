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

  // ═══ Cover image flow (trace logs — user's explicit selection must survive) ═══
  // Priority: body.coverImageUrl (explicit) > first valid imageUrls (legacy)
  const resolvedCover: string =
    (typeof coverImageUrl === 'string' && coverImageUrl.startsWith('https://')) ? coverImageUrl :
    (Array.isArray(imageUrls) && imageUrls.find((u: any) => typeof u === 'string' && u.startsWith('https://'))) || '';
  console.log(`[COVER-TRACE] userSelectedCover=${userSelectedCover === true}`);
  console.log(`[COVER-TRACE] body.coverImageUrl=${coverImageUrl ? String(coverImageUrl).substring(0, 120) : '(absent)'}`);
  console.log(`[COVER-TRACE] body.imageUrls[0]=${imageUrls?.[0] ? String(imageUrls[0]).substring(0, 120) : '(absent)'}`);
  console.log(`[COVER-TRACE] resolvedCover=${resolvedCover ? resolvedCover.substring(0, 120) : '(none)'}`);

  // Generate a vision description of the user-selected cover and inject it into the prompt
  // so the text-to-video engine renders a product that matches THAT specific image.
  // Skip for Seedance — it uses reference-to-video with actual photos instead.
  let prompt = originalPrompt;
  if (resolvedCover && engine !== 'seedance') {
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
      // Seedance 2.0 — ByteDance via fal.ai. Supports 4-15s, 720p
      const seedDuration = Math.max(4, Math.min(15, parseInt(duration) || 8));
      const seedAspect = dimension === '16:9' ? '16:9' : dimension === '1:1' ? '1:1' : '9:16';

      // Collect all valid product image URLs for reference-to-video
      const refImages: string[] = [];
      if (resolvedCover && resolvedCover.startsWith('https://')) refImages.push(resolvedCover);
      if (Array.isArray(imageUrls)) {
        for (const u of imageUrls) {
          if (typeof u === 'string' && u.startsWith('https://') && !refImages.includes(u)) refImages.push(u);
        }
      }

      let result;
      if (refImages.length > 0) {
        // Reference-to-video: submit actual product photos so the model
        // renders the REAL product — no text description workaround needed.
        const refLabels = refImages.map((_, i) => `@Image${i + 1}`).join(', ');
        const cinematicPrompt = `${originalPrompt}\n\nProduct reference images: ${refLabels} — show this EXACT product naturally in the scene, match packaging, colors, and branding precisely.\n\nTECHNICAL: ${seedDuration}-second video. Aspect ratio ${seedAspect}. Photorealistic, natural lighting. Normal conversational pacing — NOT slow motion. UGC authentic feel.`;
        console.log(`[SEEDANCE-R2V] Reference-to-video: ${refImages.length} product images, prompt=${cinematicPrompt.length} chars`);
        result = await seedanceR2V(cinematicPrompt, refImages, {
          duration: seedDuration, aspectRatio: seedAspect, resolution: '720p', generateAudio: false,
        });
      } else {
        // No product images — fall back to text-to-video
        const cinematicPrompt = `${prompt}\n\nTECHNICAL: ${seedDuration}-second video. Aspect ratio ${seedAspect}. Photorealistic, natural lighting. Normal conversational pacing — NOT slow motion. UGC authentic feel.`;
        console.log(`[SEEDANCE-T2V] Text-to-video (no product images): prompt=${cinematicPrompt.length} chars`);
        result = await seedanceT2V(cinematicPrompt, {
          duration: seedDuration, aspectRatio: seedAspect, generateAudio: false,
        });
      }

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'seedance', ?, ?)
      `).run(id, storeId, title, prompt, angle || null, result.requestId, packageId || null, packageIndex ?? null);
      try { if (persistedFormat) db.prepare('UPDATE creatives SET format = ? WHERE id = ?').run(persistedFormat, id); } catch {}

      return jsonSuccess({ id, engine: 'seedance', requestId: result.requestId, model: result.model });

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
      const endpoint = creative.type === 'video' && creative.file_url ? 'bytedance/seedance-2.0/image-to-video' : 'bytedance/seedance-2.0/text-to-video';
      const status = await seedanceGetStatus(creative.nb_video_id, endpoint);
      if (status.status === 'COMPLETED' && status.videoUrl) {
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
