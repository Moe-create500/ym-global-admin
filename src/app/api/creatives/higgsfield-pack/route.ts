import { requireStoreAccess } from '@/lib/auth-tenant';
/**
 * Higgsfield Multi-Scene Pack API
 *
 * POST /api/creatives/higgsfield-pack — Start a multi-scene generation job
 * GET  /api/creatives/higgsfield-pack?jobId=xxx — Poll job status
 *
 * Generates multiple 5-8s Higgsfield clips and stitches them into
 * one continuous video using ffmpeg.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { planScenes, generateScenes, stitchScenes, HIGGSFIELD_STYLES } from '@/lib/higgsfield-scenes';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — scene generation + stitching takes time

function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}
function jsonError(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

// In-memory job tracker
const activeJobs = new Map<string, {
  status: 'planning' | 'generating' | 'stitching' | 'completed' | 'failed';
  style: string;
  scenes: any[];
  videoUrl?: string;
  error?: string;
  progress?: string;
}>();

// Cleanup old jobs
setInterval(() => {
  if (activeJobs.size > 100) {
    const keys = Array.from(activeJobs.keys());
    for (let i = 0; i < keys.length - 50; i++) activeJobs.delete(keys[i]);
  }
}, 120000);

/**
 * GET — Poll job status
 */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');

  // List available styles
  if (req.nextUrl.searchParams.get('styles') === '1') {
    return jsonSuccess({
      styles: HIGGSFIELD_STYLES.map(s => ({
        key: s.key, label: s.label, description: s.description,
        sceneCount: s.sceneCount,
        scenes: s.scenes.map(sc => ({ name: sc.name, durationHint: sc.durationHint })),
      })),
    });
  }

  if (!jobId) return jsonError('MISSING_JOB_ID', 'jobId required');

  const job = activeJobs.get(jobId);
  if (!job) return jsonError('NOT_FOUND', 'Job not found', null, 404);

  return jsonSuccess({
    jobId,
    status: job.status,
    style: job.style,
    scenes: job.scenes,
    videoUrl: job.videoUrl,
    error: job.error,
    progress: job.progress,
  });
}

/**
 * POST — Start multi-scene generation
 */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('INVALID_BODY', 'Invalid JSON', null, 400); }

  const { storeId, productId, productName, productImageUrl, style, conceptAngle, title, script, avatarStyle } = body;
  // ═══ TENANT ACCESS CHECK ═══
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;

  if (!storeId || !productImageUrl) return jsonError('MISSING_FIELDS', 'storeId and productImageUrl required');

  const styleKey = style || 'product_showcase';
  const resolvedStyle = HIGGSFIELD_STYLES.find(s => s.key === styleKey);
  if (!resolvedStyle) return jsonError('INVALID_STYLE', `Unknown style: ${styleKey}. Available: ${HIGGSFIELD_STYLES.map(s => s.key).join(', ')}`);

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

  const jobId = crypto.randomUUID();
  const creativeId = crypto.randomUUID();

  // Save creative immediately
  try {
    db.prepare(`
      INSERT INTO creatives (id, store_id, type, title, description, angle, nb_status, status, template_id, product_id)
      VALUES (?, ?, 'video', ?, ?, ?, 'processing', 'draft', 'higgsfield', ?)
    `).run(creativeId, storeId, title || `${resolvedStyle.label} — ${productName || 'Product'}`, `Higgsfield ${resolvedStyle.label} pack (${resolvedStyle.sceneCount} scenes)`, conceptAngle || null, productId || null);
  } catch {}

  // Mark job as planning
  activeJobs.set(jobId, { status: 'planning', style: styleKey, scenes: [], progress: 'Planning scenes...' });

  // Run generation in background
  processHiggsPack(jobId, creativeId, {
    storeId, productId, productName: productName || 'Product', productImageUrl,
    styleKey, conceptAngle, script, avatarStyle, db,
  });

  return jsonSuccess({ jobId, creativeId, style: styleKey, sceneCount: resolvedStyle.sceneCount });
}

/**
 * Background processing — not awaited by POST handler.
 */
async function processHiggsPack(jobId: string, creativeId: string, opts: {
  storeId: string; productId?: string; productName: string; productImageUrl: string;
  styleKey: string; conceptAngle?: string; script?: string; avatarStyle?: string; db: any;
}) {
  const { storeId, productId, productName, productImageUrl, styleKey, conceptAngle, script, avatarStyle, db } = opts;

  try {
    // Load product foundation (beliefs, unique mechanism, etc.) if available
    let foundation: any = null;
    if (opts.storeId) {
      try {
        const foundRow: any = db.prepare('SELECT * FROM product_foundations WHERE product_id = ?').get(productId || '');
        if (foundRow) {
          foundation = {
            beliefs: JSON.parse(foundRow.beliefs || '[]'),
            uniqueMechanism: foundRow.unique_mechanism,
            avatarSummary: foundRow.avatar_summary,
            offerBrief: foundRow.offer_brief,
          };
          console.log(`[HIGGS-PACK] Loaded foundation: ${foundation.beliefs?.length || 0} beliefs, mechanism: ${foundation.uniqueMechanism?.substring(0, 50) || 'none'}`);
        }
      } catch {}
    }

    // Step 1: Plan scenes (with foundation beliefs injected)
    const scenes = planScenes(styleKey, productName, productImageUrl, conceptAngle, foundation);
    activeJobs.set(jobId, {
      status: 'generating', style: styleKey,
      scenes: scenes.map(s => ({ index: s.index, name: s.name, status: 'queued' })),
      progress: `Generating ${scenes.length} scenes sequentially (each builds on previous)...`,
    });

    // Step 2: Generate scenes sequentially with visual continuity
    // Each scene waits for the previous one, extracts last frame, feeds it to the next
    const completedScenes = await generateScenes(scenes, (updated) => {
      activeJobs.set(jobId, {
        status: 'generating', style: styleKey,
        scenes: updated.map(s => ({ index: s.index, name: s.name, status: s.status })),
        progress: `Scene ${updated.filter(s => s.status === 'completed').length}/${scenes.length} complete...`,
      });
    });

    const successCount = completedScenes.filter(s => s.status === 'completed').length;
    const failCount = completedScenes.filter(s => s.status === 'failed').length;

    if (successCount === 0) {
      activeJobs.set(jobId, { status: 'failed', style: styleKey, scenes: completedScenes, error: 'All scenes failed to generate' });
      try { db.prepare("UPDATE creatives SET nb_status = 'failed' WHERE id = ?").run(creativeId); } catch {}
      return;
    }

    // Step 3: Stitch scenes together
    activeJobs.set(jobId, {
      status: 'stitching', style: styleKey,
      scenes: completedScenes.map(s => ({ index: s.index, name: s.name, status: s.status })),
      progress: `Stitching ${successCount} clips into one continuous video...`,
    });

    let finalVideoUrl = await stitchScenes(completedScenes);

    // Step 5: Add voiceover if script is provided
    if (script && script.trim().length > 5) {
      try {
        activeJobs.set(jobId, {
          status: 'stitching', style: styleKey,
          scenes: completedScenes.map(s => ({ index: s.index, name: s.name, status: s.status })),
          progress: 'Adding voiceover to video...',
        });

        const { addVoiceover } = await import('@/lib/voiceover-mixer');
        // Pass the local file path directly — don't go through HTTP/auth
        const voResult = await addVoiceover(finalVideoUrl, script, { avatarStyle: avatarStyle || 'female_ugc' });
        finalVideoUrl = voResult.videoUrl;
        console.log(`[HIGGS-PACK] Voiceover added: voice=${voResult.voice}`);
      } catch (voErr: any) {
        console.error(`[HIGGS-PACK] Voiceover failed (using silent video):`, voErr.message);
        // Continue with silent video — voiceover failure is non-fatal
      }
    }

    // Step 6: Save to DB
    try {
      db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ?, updated_at = datetime('now') WHERE id = ?")
        .run(finalVideoUrl, creativeId);
    } catch (e: any) {
      console.error('[HIGGS-PACK] DB save failed:', e.message);
    }

    activeJobs.set(jobId, {
      status: 'completed', style: styleKey,
      scenes: completedScenes.map(s => ({ index: s.index, name: s.name, status: s.status })),
      videoUrl: finalVideoUrl,
      progress: `Complete — ${successCount} scenes stitched${script ? ' + voiceover' : ''}${failCount > 0 ? ` (${failCount} scene${failCount > 1 ? 's' : ''} failed)` : ''}`,
    });

    console.log(`[HIGGS-PACK] Job ${jobId.slice(0, 8)} completed: ${successCount}/${completedScenes.length} scenes → ${finalVideoUrl}`);

  } catch (err: any) {
    console.error(`[HIGGS-PACK] Job ${jobId.slice(0, 8)} fatal error:`, err.message);
    activeJobs.set(jobId, {
      status: 'failed', style: styleKey, scenes: [],
      error: err.message?.substring(0, 300),
    });
    try { db.prepare("UPDATE creatives SET nb_status = 'failed' WHERE id = ?").run(creativeId); } catch {}
  }
}
