import { requireStoreAccess } from '@/lib/auth-tenant';
/**
 * Winner References API
 *
 * GET  /api/creatives/winners?storeId=xxx          — List all winners for a store
 * GET  /api/creatives/winners?storeId=xxx&match=1&contentType=...&creativeType=...  — Find best match
 * POST /api/creatives/winners                       — Save a winner reference
 * DELETE /api/creatives/winners?id=xxx              — Remove a winner reference
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { extractDNA, findBestReference, calculateSimilarity } from '@/lib/winner-matching';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}
function jsonError(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  // ═══ TENANT ACCESS CHECK ═══
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;

  if (!storeId) return jsonError('MISSING_STORE', 'storeId is required');

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

  // Match mode: find best reference for a setup
  if (req.nextUrl.searchParams.get('match') === '1') {
    const config = {
      contentType: req.nextUrl.searchParams.get('contentType') || undefined,
      creativeType: req.nextUrl.searchParams.get('creativeType') || undefined,
      funnelStage: req.nextUrl.searchParams.get('funnelStage') || undefined,
      hookStyle: req.nextUrl.searchParams.get('hookStyle') || undefined,
      avatarStyle: req.nextUrl.searchParams.get('avatarStyle') || undefined,
      platform: req.nextUrl.searchParams.get('platform') || undefined,
      duration: req.nextUrl.searchParams.get('duration') ? parseInt(req.nextUrl.searchParams.get('duration')!) : undefined,
      aspectRatio: req.nextUrl.searchParams.get('aspectRatio') || undefined,
    };

    const best = findBestReference(db, storeId, config);
    return jsonSuccess({ match: best, hasMatch: !!best });
  }

  // List all winners
  try {
    const winners: any[] = db.prepare(
      'SELECT * FROM winner_references WHERE store_id = ? ORDER BY created_at DESC LIMIT 100'
    ).all(storeId);

    return jsonSuccess({ winners });
  } catch (e: any) {
    return jsonError('QUERY_ERROR', 'Failed to list winners', e.message, 500);
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('INVALID_BODY', 'Invalid JSON', null, 400); }

  const { storeId, creativeId, packageId, packageIndex, pkg, config, userNotes, winningTags } = body;
  if (!storeId) return jsonError('MISSING_STORE', 'storeId is required');
  if (!pkg && !creativeId) return jsonError('MISSING_DATA', 'pkg or creativeId required');

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

  const id = crypto.randomUUID();

  // Extract deep structural DNA from the package
  const dna = pkg ? extractDNA(pkg) : {
    hookPattern: '', hookType: '', scriptRhythm: '', pacingNotes: '', sentenceStructure: '',
    sceneTiming: '', ctaStructure: '', ctaStyle: '', proofStyle: '',
    visualComposition: '', visualDirection: '', brollDirection: '',
    productFraming: '', avatarType: '', energyTone: '', editingFeel: '', format: '',
  };

  // If we have a creativeId, pull extra info from the creatives table
  let creative: any = null;
  if (creativeId) {
    creative = db.prepare('SELECT * FROM creatives WHERE id = ?').get(creativeId);
  }

  // Check for performance data if there's a linked ad
  let perfRoas: number | null = null;
  let perfCtr: number | null = null;
  let perfAdId: string | null = null;
  if (creative?.fb_video_id || creative?.file_url) {
    const adRow: any = db.prepare(
      'SELECT ad_id, roas, ctr FROM ad_spend WHERE store_id = ? AND (creative_url = ? OR fb_video_id = ?) LIMIT 1'
    ).get(storeId, creative?.file_url || '', creative?.fb_video_id || '');
    if (adRow) {
      perfAdId = adRow.ad_id;
      perfRoas = adRow.roas;
      perfCtr = adRow.ctr;
    }
  }

  try {
    db.prepare(`
      INSERT INTO winner_references (
        id, store_id, creative_id, package_id, package_index, product_id,
        content_type, creative_type, funnel_stage, hook_style, avatar_style,
        platform, duration, aspect_ratio, provider,
        title, concept, script, primary_text, headline, cta, render_prompt,
        hook_pattern, script_rhythm, pacing_notes, sentence_structure,
        cta_structure, proof_style, visual_composition, product_framing,
        energy_tone, editing_feel, structure_notes, product_placement,
        winning_tags, user_notes, is_launched,
        performance_ad_id, performance_roas, performance_ctr
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?
      )
    `).run(
      id, storeId, creativeId || null, packageId || null, packageIndex ?? null,
      config?.productId || creative?.product_id || null,
      config?.contentType || creative?.type || pkg?.contentType || 'video',
      config?.creativeType || pkg?.creativeType || null,
      config?.funnelStage || pkg?.funnelStage || null,
      config?.hookStyle || pkg?.hookStyle || null,
      config?.avatarStyle || pkg?.avatarStyle || null,
      config?.platform || config?.platformTarget || 'meta',
      config?.videoDuration || config?.duration || creative?.duration_seconds || null,
      config?.dimension || config?.aspectRatio || creative?.format || null,
      creative?.template_id || config?.provider || null,
      pkg?.title || creative?.title || null,
      pkg?.angle || pkg?.conceptAngle || null,
      pkg?.script || creative?.description || null,
      pkg?.adCopy || pkg?.primary_text || null,
      pkg?.headline || null,
      pkg?.cta || pkg?.ctaText || pkg?.ctaDirection || null,
      creative?.description || pkg?.renderPrompt || null,
      dna.hookPattern, dna.scriptRhythm, dna.pacingNotes, dna.sentenceStructure,
      dna.ctaStructure, dna.proofStyle, dna.visualComposition || dna.visualDirection, dna.productFraming,
      dna.energyTone, dna.editingFeel,
      pkg?.sceneStructure || dna.sceneTiming || null,
      pkg?.productPlacement || pkg?.product_placement || dna.productFraming || null,
      winningTags ? JSON.stringify(winningTags) : null,
      userNotes || null,
      creative?.fb_video_id ? 1 : 0,
      perfAdId, perfRoas, perfCtr,
    );

    const saved = db.prepare('SELECT * FROM winner_references WHERE id = ?').get(id);
    return jsonSuccess({ winner: saved }, 201);
  } catch (e: any) {
    return jsonError('SAVE_ERROR', 'Failed to save winner', e.message, 500);
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return jsonError('MISSING_ID', 'id is required');

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

  try {
    const result = db.prepare('DELETE FROM winner_references WHERE id = ?').run(id);
    if (result.changes === 0) return jsonError('NOT_FOUND', 'Winner not found', null, 404);
    return jsonSuccess({ deleted: true });
  } catch (e: any) {
    return jsonError('DELETE_ERROR', 'Failed to delete', e.message, 500);
  }
}
