import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runPipeline, PipelineConfig } from '@/lib/video-pipeline';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/creatives/pipeline — Start a new video ad pipeline
 */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { storeId, productId, adScript, avatarId, voiceId, brollCount, offer } = body;

  if (!storeId || !productId || !adScript || !avatarId || !voiceId) {
    return NextResponse.json({ error: 'storeId, productId, adScript, avatarId, and voiceId are required' }, { status: 400 });
  }

  const db = getDb();

  // Load product
  const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }
  if (!product.image_url) {
    return NextResponse.json({ error: 'Product has no image. Add an image first.' }, { status: 400 });
  }

  const pipelineId = crypto.randomUUID();

  // Insert pipeline record
  db.prepare(`
    INSERT INTO video_pipelines (id, store_id, product_id, status, ad_script, avatar_id, voice_id, broll_count)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(pipelineId, storeId, productId, adScript, avatarId, voiceId, brollCount || 10);

  const config: PipelineConfig = {
    storeId,
    productId,
    productImageUrl: product.image_url,
    productTitle: product.title,
    productDescription: product.description || undefined,
    adScript,
    avatarId,
    voiceId,
    offer,
    brollCount: brollCount || 10,
  };

  // Run pipeline async (non-blocking)
  runPipeline(pipelineId, config, db).catch((err) => {
    console.error(`[PIPELINE] Fatal: ${err.message}`);
  });

  return NextResponse.json({ success: true, pipelineId });
}

/**
 * GET /api/creatives/pipeline?id=X — Poll pipeline status
 * GET /api/creatives/pipeline?storeId=X — List pipelines for a store
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const storeId = req.nextUrl.searchParams.get('storeId');

  const db = getDb();

  if (id) {
    const pipeline: any = db.prepare('SELECT * FROM video_pipelines WHERE id = ?').get(id);
    if (!pipeline) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    }

    // Get individual clip statuses
    const clips: any[] = db.prepare(
      'SELECT id, title, nb_status, file_url, template_id FROM creatives WHERE pipeline_id = ? ORDER BY created_at'
    ).all(id);

    return NextResponse.json({
      pipeline: {
        id: pipeline.id,
        status: pipeline.status,
        completedClips: pipeline.completed_clips,
        totalClips: pipeline.total_clips,
        finalVideoUrl: pipeline.final_video_url,
        error: pipeline.error,
        brollPrompts: pipeline.broll_prompts ? JSON.parse(pipeline.broll_prompts) : [],
        createdAt: pipeline.created_at,
      },
      clips,
    });
  }

  if (storeId) {
    const pipelines: any[] = db.prepare(
      'SELECT * FROM video_pipelines WHERE store_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(storeId);

    return NextResponse.json({
      pipelines: pipelines.map((p: any) => ({
        id: p.id,
        status: p.status,
        completedClips: p.completed_clips,
        totalClips: p.total_clips,
        finalVideoUrl: p.final_video_url,
        error: p.error,
        createdAt: p.created_at,
      })),
    });
  }

  return NextResponse.json({ error: 'id or storeId required' }, { status: 400 });
}
