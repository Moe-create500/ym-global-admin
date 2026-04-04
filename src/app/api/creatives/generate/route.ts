import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { textToVideo, imageToVideo, getVideoStatus as nbGetStatus } from '@/lib/nanobanana';
import { createVideo as soraCreate, getVideoStatus as soraGetStatus, getVideoDownloadUrl } from '@/lib/sora';
import { createVideo as veoCreate, getVideoStatus as veoGetStatus } from '@/lib/veo';
import { createVideo as mmCreateVideo, getVideoStatus as mmGetVideoStatus, generateImage as mmGenerateImage } from '@/lib/minimax';
import { createVideo as runwayCreate, getVideoStatus as runwayGetStatus } from '@/lib/runway';
import { createVideo as higgsCreate, getVideoStatus as higgsGetStatus } from '@/lib/higgsfield';
import crypto from 'crypto';
import sharp from 'sharp';
import { generateSpeech, getVoiceForAvatar } from '@/lib/tts';
import { muxVideoAudio } from '@/lib/mux';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

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


/**
 * Auto-finalize: when a video completes, generate voiceover + mux automatically.
 * This runs in the background during status polling — does not block the response.
 */
async function autoFinalize(creativeId: string, videoUrl: string, script: string, db: any) {
  // Skip if already finalized or no script
  if (!script || script.length < 20) return;
  // Skip Sora URLs that need auth proxy (can't download server-side)
  if (videoUrl.includes('api.openai.com')) return;

  try {
    console.log(`[AUTO-FINALIZE] Starting for ${creativeId}`);

    // Determine avatar from creative angle or default
    const voice = 'nova'; // warm female UGC default

    // Generate voiceover
    const ttsResult = await generateSpeech(script.substring(0, 4096), { voice, model: 'tts-1-hd', speed: 1.0 });
    const voFilename = `vo_${crypto.randomUUID()}.mp3`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    const voPath = path.join(uploadDir, voFilename);
    await writeFile(voPath, ttsResult.audioBuffer);

    // Mux video + audio
    const muxResult = await muxVideoAudio(videoUrl, voPath);

    // Update creative with final muxed URL
    db.prepare(`
      UPDATE creatives SET
        file_url = ?,
        template_data = json_set(COALESCE(template_data, '{}'), '$.silentVideoUrl', ?, '$.voiceoverUrl', ?, '$.autoFinalized', 'true'),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(muxResult.outputUrl, videoUrl, `/api/products/uploads?file=${voFilename}`, creativeId);

    console.log(`[AUTO-FINALIZE] Complete for ${creativeId} -> ${muxResult.filename}`);
  } catch (err: any) {
    console.error(`[AUTO-FINALIZE] Failed for ${creativeId}: ${err.message}`);
    // Don't fail the creative — silent video is still usable
  }
}

export async function POST(req: NextRequest) {
  // ── Parse body safely ──
  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    return jsonError('INVALID_BODY', 'Request body is not valid JSON', e.message, 400);
  }

  const { storeId, type, prompt, imageUrls, title, angle, resolution, duration, engine, packageId, packageIndex } = body;

  if (!storeId || !prompt || !title) {
    return jsonError('MISSING_FIELDS', 'storeId, prompt, and title are required', null, 400);
  }

  let db: any;
  try {
    db = getDb();
  } catch (e: any) {
    return jsonError('DB_ERROR', 'Database connection failed', e.message, 500);
  }

  const id = crypto.randomUUID();
  const useEngine = engine || 'sora';

  try {
    if (useEngine === 'sora') {
      const sizeMap: Record<string, '1280x720' | '720x1280' | '1920x1080' | '1080x1920'> = {
        '720p': '1280x720', '720p-vertical': '720x1280',
        '1080p': '1920x1080', '1080p-vertical': '1080x1920',
      };
      const soraSize = sizeMap[resolution] || '1280x720';
      const durationNum = parseInt(duration) || 20;
      const soraDuration: '8' | '16' | '20' = durationNum <= 8 ? '8' : durationNum <= 16 ? '16' : '20';
      const model: 'sora-2' | 'sora-2-pro' = 'sora-2-pro';
      let imageBuffer: Buffer | undefined;

      if (type === 'image-to-video' && imageUrls?.length > 0) {
        try {
          const { width, height } = getSoraDimensions(soraSize);

          if (imageUrls.length === 1) {
            // Single image — use as-is, fill the frame
            const imgRes = await fetch(imageUrls[0]);
            if (imgRes.ok) {
              const imgArrayBuf = await imgRes.arrayBuffer();
              imageBuffer = await sharp(Buffer.from(imgArrayBuf))
                .resize(width, height, { fit: 'cover', position: 'centre' })
                .png().toBuffer();
            }
          } else {
            // Multiple images — composite all into one reference frame
            // Layout: hero image on top (~50%), remaining in grid below
            const fetched: Buffer[] = [];
            const fetchTasks = imageUrls.slice(0, 9).map(async (url: string) => {
              try {
                const res = await fetch(url);
                if (res.ok) return Buffer.from(await res.arrayBuffer());
              } catch {}
              return null;
            });
            const results = await Promise.all(fetchTasks);
            for (const buf of results) { if (buf) fetched.push(buf); }

            if (fetched.length === 0) throw new Error('No images could be fetched');

            if (fetched.length === 1) {
              imageBuffer = await sharp(fetched[0])
                .resize(width, height, { fit: 'cover', position: 'centre' })
                .png().toBuffer();
            } else {
              // Hero takes top portion, remaining fill a grid below
              const gap = 4;
              const gridCount = fetched.length - 1;
              const cols = Math.min(gridCount, 3);
              const rows = Math.ceil(gridCount / cols);
              const heroH = Math.round(height * 0.45);
              const gridH = height - heroH - gap;
              const cellW = Math.floor((width - gap * (cols - 1)) / cols);
              const cellH = Math.floor((gridH - gap * (rows - 1)) / rows);

              // Resize hero
              const heroBuf = await sharp(fetched[0])
                .resize(width, heroH, { fit: 'cover', position: 'centre' })
                .png().toBuffer();

              // Resize grid images
              const gridBufs: { input: Buffer; left: number; top: number }[] = [];
              for (let i = 0; i < gridCount; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const resized = await sharp(fetched[i + 1])
                  .resize(cellW, cellH, { fit: 'cover', position: 'centre' })
                  .png().toBuffer();
                gridBufs.push({
                  input: resized,
                  left: col * (cellW + gap),
                  top: heroH + gap + row * (cellH + gap),
                });
              }

              imageBuffer = await sharp({
                create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
              })
                .composite([
                  { input: heroBuf, left: 0, top: 0 },
                  ...gridBufs,
                ])
                .png().toBuffer();
            }
          }
        } catch (err) {
          console.error('Failed to prepare Sora reference image:', err);
        }
      }

      const result = await soraCreate(prompt, {
        model, size: soraSize, seconds: soraDuration,
        ...(imageBuffer ? { imageBuffer, imageMimeType: 'image/png' } : {}),
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'sora', ?, ?)
      `).run(id, storeId, title, prompt, angle || null, result.videoId, packageId || null, packageIndex ?? null);

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

      return jsonSuccess({ id, engine: 'minimax', taskId: result.taskId, model: result.model });

    } else if (useEngine === 'minimax-image') {
      const aspectMap: Record<string, '1:1' | '16:9' | '9:16' | '4:3' | '3:4'> = {
        'square': '1:1', '1:1': '1:1', 'landscape': '16:9', '16:9': '16:9',
        'portrait': '9:16', '9:16': '9:16', '4:3': '4:3', '3:4': '3:4',
      };
      const aspect = aspectMap[resolution] || '16:9';
      const result = await mmGenerateImage(prompt, { aspectRatio: aspect });
      const imageUrl = result.imageBase64;

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description, file_url,
          angle, nb_status, status, template_id, package_id, package_index)
        VALUES (?, ?, 'image', ?, ?, ?, ?, 'completed', 'draft', 'minimax-image', ?, ?)
      `).run(id, storeId, title, prompt, imageUrl || null, angle || null, packageId || null, packageIndex ?? null);

      return jsonSuccess({ id, engine: 'minimax-image', model: result.model, imageUrl });

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

      return jsonSuccess({ id, engine: 'higgsfield', requestId: result.requestId });

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
    if (err.isQuota || err.code === 'insufficient_quota' || err.status === 429) {
      console.error(`[QUOTA] ${useEngine} quota exceeded for store ${storeId} at ${new Date().toISOString()}`);
      return jsonError('QUOTA_EXCEEDED', `${useEngine} generation unavailable — billing limit reached. Please check your API plan or try a different engine.`, { engine: useEngine, id }, 429);
    }
    return jsonError('PROVIDER_ERROR', `${useEngine} API error: ${err.message}`, { engine: useEngine, id }, 500);
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
        db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now') WHERE id = ?").run(downloadUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = downloadUrl;
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
        // Auto-finalize: add voiceover + mux (runs in background)
        autoFinalize(id, status.videoUrl, creative.description, db).catch(() => {});
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
        autoFinalize(id, status.videoUrl, creative.description, db).catch(() => {});
      } else if (status.status === 'failed' || status.status === 'nsfw') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }
      return jsonSuccess({ creative, status: status.status === 'completed' ? 'completed' : status.status === 'failed' || status.status === 'nsfw' ? 'failed' : 'processing', providerError: status.error });

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
