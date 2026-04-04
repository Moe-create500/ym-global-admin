import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOrCreateIndex, indexVideoByUrl, indexVideoFromBuffer, waitForTask, analyzeVideo } from '@/lib/twelvelabs';
import { getVideoSourceUrl, getPages } from '@/lib/facebook';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes — video download + Twelve Labs indexing + analysis

/**
 * POST /api/creatives/analyze
 * Analyze a video ad's creative DNA using Twelve Labs Pegasus.
 *
 * Supports three modes:
 * 1. JSON body: { adId, storeId } — auto-fetches video from Facebook via stored video_source_url or fb_video_id
 * 2. JSON body: { videoUrl, adId?, storeId } — downloads video from URL
 * 3. FormData: videoFile (File), adId?, storeId — direct file upload
 */
export async function POST(req: NextRequest) {
  const db = getDb();
  const contentType = req.headers.get('content-type') || '';

  let videoUrl: string | null = null;
  let adId: string | null = null;
  let storeId: string | null = null;
  let videoBuffer: Buffer | null = null;
  let videoFilename = 'video.mp4';
  let videoMime = 'video/mp4';

  if (contentType.includes('multipart/form-data')) {
    // File upload mode
    const formData = await req.formData();
    const file = formData.get('videoFile') as File | null;
    adId = formData.get('adId') as string | null;
    storeId = formData.get('storeId') as string | null;

    if (!file || !storeId) {
      return NextResponse.json({ error: 'videoFile and storeId required' }, { status: 400 });
    }

    videoBuffer = Buffer.from(await file.arrayBuffer());
    videoFilename = file.name || 'video.mp4';
    videoMime = file.type || 'video/mp4';
    videoUrl = `upload://${videoFilename}`;
  } else {
    // JSON mode — either explicit videoUrl or auto-resolve from adId
    const body = await req.json();
    videoUrl = body.videoUrl || null;
    adId = body.adId || null;
    storeId = body.storeId;

    if (!storeId) {
      return NextResponse.json({ error: 'storeId required' }, { status: 400 });
    }

    // Auto-resolve video URL from Facebook if only adId provided
    if (!videoUrl && adId) {
      const adRow: any = db.prepare(
        'SELECT video_source_url, fb_video_id, creative_url FROM ad_spend WHERE ad_id = ? AND store_id = ? LIMIT 1'
      ).get(adId, storeId);

      if (adRow?.video_source_url) {
        videoUrl = adRow.video_source_url;
      } else if (adRow?.fb_video_id) {
        // Fetch from Facebook API on the fly using page tokens
        const profile: any = db.prepare(
          'SELECT access_token FROM fb_profiles WHERE store_id = ? AND is_active = 1 LIMIT 1'
        ).get(storeId);
        if (profile?.access_token) {
          // Try page tokens — source field requires page-level access
          const pages = await getPages(profile.access_token);
          for (const page of pages) {
            if (!page.access_token) continue;
            const sourceUrl = await getVideoSourceUrl(adRow.fb_video_id, page.access_token);
            if (sourceUrl) {
              videoUrl = sourceUrl;
              // Cache it for next time
              db.prepare('UPDATE ad_spend SET video_source_url = ? WHERE ad_id = ? AND store_id = ?')
                .run(sourceUrl, adId, storeId);
              break;
            }
          }
        }
      }

      // Fallback: try creative_url if it looks like a video file
      if (!videoUrl && adRow?.creative_url) {
        const cu = adRow.creative_url.toLowerCase();
        if (cu.includes('video') || cu.endsWith('.mp4') || cu.endsWith('.mov') || cu.endsWith('.webm') || cu.includes('/v/') || cu.includes('fbcdn.net/v/')) {
          videoUrl = adRow.creative_url;
        }
      }

      if (!videoUrl) {
        return NextResponse.json({
          error: 'Could not auto-resolve video URL. Upload the video file manually using the upload button below.',
          needsUpload: true,
        }, { status: 400 });
      }
    }

    if (!videoUrl) {
      return NextResponse.json({ error: 'videoUrl or adId required' }, { status: 400 });
    }
  }

  const analysisId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO video_analyses (id, store_id, ad_id, video_url, status)
    VALUES (?, ?, ?, ?, 'indexing')
  `).run(analysisId, storeId, adId, videoUrl);

  try {
    // Step 1: Get or create Twelve Labs index
    const indexId = await getOrCreateIndex('ad-creatives');
    db.prepare("UPDATE video_analyses SET tl_index_id = ? WHERE id = ?").run(indexId, analysisId);

    // Step 2: Upload video
    let taskId: string;
    if (videoBuffer) {
      // Direct file upload
      const result = await indexVideoFromBuffer(indexId, videoBuffer, videoFilename, videoMime);
      taskId = result.taskId;
    } else {
      // Download from URL and upload
      const result = await indexVideoByUrl(indexId, videoUrl!);
      taskId = result.taskId;
    }

    // Step 3: Wait for indexing
    const videoId = await waitForTask(taskId, 300000); // 5 min timeout
    db.prepare("UPDATE video_analyses SET tl_video_id = ?, status = 'analyzing' WHERE id = ?").run(videoId, analysisId);

    // Step 4: Analyze the video
    const result = await analyzeVideo(videoId);

    // Save analysis
    db.prepare(`
      UPDATE video_analyses SET analysis = ?, status = 'completed', updated_at = datetime('now')
      WHERE id = ?
    `).run(result.analysis, analysisId);

    // Also save to ad_spend if adId provided
    if (adId) {
      db.prepare(`
        UPDATE ad_spend SET video_analysis = ?, tl_video_id = ?
        WHERE ad_id = ? AND store_id = ?
      `).run(result.analysis, videoId, adId, storeId);
    }

    return NextResponse.json({
      success: true,
      analysisId,
      videoId,
      analysis: result.analysis,
    });
  } catch (err: any) {
    db.prepare("UPDATE video_analyses SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(analysisId);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/creatives/analyze?storeId=...&id=...
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get('storeId');
  const id = searchParams.get('id');

  const db = getDb();

  if (id) {
    const row = db.prepare('SELECT * FROM video_analyses WHERE id = ?').get(id);
    return NextResponse.json(row || { error: 'Not found' });
  }

  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  const rows = db.prepare(
    'SELECT * FROM video_analyses WHERE store_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(storeId);

  return NextResponse.json({ analyses: rows });
}
