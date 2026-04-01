import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { textToVideo, imageToVideo, getVideoStatus as nbGetStatus } from '@/lib/nanobanana';
import { createVideo as soraCreate, getVideoStatus as soraGetStatus, getVideoDownloadUrl } from '@/lib/sora';
import { createVideo as veoCreate, getVideoStatus as veoGetStatus } from '@/lib/veo';
import { createVideo as mmCreateVideo, getVideoStatus as mmGetVideoStatus, generateImage as mmGenerateImage } from '@/lib/minimax';
import crypto from 'crypto';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

function getSoraDimensions(size: '1280x720' | '720x1280' | '1920x1080' | '1080x1920') {
  const [width, height] = size.split('x').map((v) => parseInt(v, 10));
  return { width, height };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, type, prompt, imageUrls, title, angle, resolution, duration, engine } = body;
  // engine: 'sora' | 'veo' | 'minimax' | 'minimax-image' | 'nanobanana' (default: 'sora')

  if (!storeId || !prompt || !title) {
    return NextResponse.json({ error: 'storeId, prompt, and title are required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const useEngine = engine || 'sora';

  try {
    if (useEngine === 'sora') {
      const sizeMap: Record<string, '1280x720' | '720x1280' | '1920x1080' | '1080x1920'> = {
        '720p': '1280x720',
        '720p-vertical': '720x1280',
        '1080p': '1920x1080',
        '1080p-vertical': '1080x1920',
      };
      const soraSize = sizeMap[resolution] || '1280x720';
      const soraDuration = duration && duration <= 8 ? '8' : duration && duration <= 16 ? '16' : '20';
      const model = resolution === '1080p' || resolution === '1080p-vertical' ? 'sora-2-pro' : 'sora-2';
      let imageBuffer: Buffer | undefined;

      if (type === 'image-to-video' && imageUrls?.[0]) {
        try {
          const imgRes = await fetch(imageUrls[0]);
          if (imgRes.ok) {
            const imgArrayBuf = await imgRes.arrayBuffer();
            const { width, height } = getSoraDimensions(soraSize);
            imageBuffer = await sharp(Buffer.from(imgArrayBuf))
              .resize(width, height, {
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 },
              })
              .png()
              .toBuffer();
          }
        } catch (err) {
          console.error('Failed to prepare Sora reference image:', err);
        }
      }

      const result = await soraCreate(prompt, {
        model,
        size: soraSize,
        seconds: soraDuration as any,
        ...(imageBuffer ? { imageBuffer, imageMimeType: 'image/png' } : {}),
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'sora')
      `).run(id, storeId, title, prompt, angle || null, result.videoId);

      return NextResponse.json({
        success: true, id, engine: 'sora',
        videoId: result.videoId, model: result.model,
        seconds: result.seconds, size: result.size,
      });

    } else if (useEngine === 'veo') {
      const veoAspect: '16:9' | '9:16' = resolution?.includes('vertical') || resolution === '9:16' ? '9:16' : '16:9';
      const veoRes = resolution === '1080p' || resolution === '1080p-vertical' ? '1080p'
        : resolution === '4k' ? '4k' : '720p';
      const veoDuration = duration && duration <= 4 ? '4' : duration && duration <= 6 ? '6' : '8';
      const veoModel = resolution === '4k' || resolution === '1080p' || resolution === '1080p-vertical'
        ? 'veo-3.1-generate-preview' : (body.veoModel || 'veo-3.1-fast-generate-preview');

      const result = await veoCreate(prompt, {
        model: veoModel as any,
        aspectRatio: veoAspect,
        durationSeconds: veoDuration as any,
        resolution: veoRes as any,
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'veo')
      `).run(id, storeId, title, prompt, angle || null, result.operationName);

      return NextResponse.json({
        success: true, id, engine: 'veo',
        operationName: result.operationName, model: result.model,
      });

    } else if (useEngine === 'minimax') {
      // MiniMax Hailuo — Video generation
      const mmModel = body.mmModel || 'MiniMax-Hailuo-2.3';
      const mmDuration = duration || 6;
      const mmRes = resolution === '720p' || resolution === '720P' ? '720P' : '1080P';

      const result = await mmCreateVideo(prompt, {
        model: mmModel,
        duration: mmDuration,
        resolution: mmRes,
        firstFrameImage: type === 'image-to-video' && imageUrls?.[0] ? imageUrls[0] : undefined,
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description,
          angle, nb_video_id, nb_status, status, template_id)
        VALUES (?, ?, 'video', ?, ?, ?, ?, 'processing', 'draft', 'minimax')
      `).run(id, storeId, title, prompt, angle || null, result.taskId);

      return NextResponse.json({
        success: true, id, engine: 'minimax',
        taskId: result.taskId, model: result.model,
      });

    } else if (useEngine === 'minimax-image') {
      // MiniMax Image-01 — Image generation (synchronous)
      const aspectMap: Record<string, '1:1' | '16:9' | '9:16' | '4:3' | '3:4'> = {
        'square': '1:1', '1:1': '1:1',
        'landscape': '16:9', '16:9': '16:9',
        'portrait': '9:16', '9:16': '9:16',
        '4:3': '4:3', '3:4': '3:4',
      };
      const aspect = aspectMap[resolution] || '16:9';

      const result = await mmGenerateImage(prompt, { aspectRatio: aspect });

      // Image generation is synchronous — store the result immediately
      const imageUrl = result.imageBase64; // Could be base64 or URL depending on API response
      db.prepare(`
        INSERT INTO creatives (id, store_id, type, title, description, file_url,
          angle, nb_status, status, template_id)
        VALUES (?, ?, 'image', ?, ?, ?, ?, 'completed', 'draft', 'minimax-image')
      `).run(id, storeId, title, prompt, imageUrl || null, angle || null);

      return NextResponse.json({
        success: true, id, engine: 'minimax-image',
        model: result.model, imageUrl,
      });

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
          angle, nb_video_id, nb_status, status, template_id)
        VALUES (?, ?, 'video', ?, ?, ?, ?, ?, ?, 'processing', 'draft', 'nanobanana')
      `).run(
        id, storeId, title, prompt,
        result.videoUrl || null, result.thumbnailUrl || null,
        angle || null, result.videoId
      );

      return NextResponse.json({
        success: true, id, engine: 'nanobanana',
        videoId: result.videoId, videoUrl: result.videoUrl,
        thumbnailUrl: result.thumbnailUrl, creditsUsed: result.creditsUsed,
      });
    }
  } catch (err: any) {
    const creativeType = useEngine === 'minimax-image' ? 'image' : 'video';
    db.prepare(`
      INSERT INTO creatives (id, store_id, type, title, description, angle, nb_status, status, template_id)
      VALUES (?, ?, ?, ?, ?, ?, 'failed', 'draft', ?)
    `).run(id, storeId, creativeType, title, prompt, angle || null, useEngine);

    return NextResponse.json({ error: err.message, id }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const db = getDb();
  const creative: any = db.prepare('SELECT * FROM creatives WHERE id = ?').get(id);
  if (!creative) {
    return NextResponse.json({ error: 'Creative not found' }, { status: 404 });
  }

  if (!creative.nb_video_id || creative.nb_status === 'completed' || creative.nb_status === 'failed') {
    return NextResponse.json({ creative });
  }

  const engineType = creative.template_id; // 'sora' | 'veo' | 'minimax' | 'nanobanana'

  try {
    if (engineType === 'sora') {
      const status = await soraGetStatus(creative.nb_video_id);

      if (status.status === 'completed') {
        const downloadUrl = await getVideoDownloadUrl(creative.nb_video_id);
        db.prepare(`
          UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(downloadUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = downloadUrl;
      } else if (status.status === 'failed') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }

      return NextResponse.json({ creative, status: status.status, progress: status.progress });

    } else if (engineType === 'veo') {
      const status = await veoGetStatus(creative.nb_video_id);

      if (status.status === 'completed' && status.videoUrl) {
        db.prepare(`
          UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(status.videoUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = status.videoUrl;
      } else if (status.status === 'failed') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }

      return NextResponse.json({ creative, status: status.status });

    } else if (engineType === 'minimax') {
      const status = await mmGetVideoStatus(creative.nb_video_id);

      if (status.status === 'completed' && status.videoUrl) {
        db.prepare(`
          UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(status.videoUrl, id);
        creative.nb_status = 'completed';
        creative.file_url = status.videoUrl;
      } else if (status.status === 'failed') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }

      return NextResponse.json({ creative, status: status.status, error: status.error });

    } else {
      // NanoBanana
      const status = await nbGetStatus(creative.nb_video_id);

      if (status.status === 'completed') {
        db.prepare(`
          UPDATE creatives SET nb_status = 'completed',
            file_url = COALESCE(?, file_url),
            thumbnail_url = COALESCE(?, thumbnail_url),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(status.videoUrl || null, status.thumbnailUrl || null, id);
        creative.nb_status = 'completed';
        creative.file_url = status.videoUrl || creative.file_url;
        creative.thumbnail_url = status.thumbnailUrl || creative.thumbnail_url;
      } else if (status.status === 'failed') {
        db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
        creative.nb_status = 'failed';
      }

      return NextResponse.json({ creative, status: status.status });
    }
  } catch (err: any) {
    return NextResponse.json({ creative, error: err.message });
  }
}
