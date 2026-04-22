import { requireStoreAccess } from '@/lib/auth-tenant';
/**
 * Setup Templates API
 *
 * GET    /api/creatives/templates?storeId=xxx  — List templates
 * POST   /api/creatives/templates              — Save a template
 * DELETE /api/creatives/templates?id=xxx       — Remove a template
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
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

  try {
    const templates: any[] = db.prepare(
      'SELECT * FROM setup_templates WHERE store_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(storeId);
    return jsonSuccess({ templates });
  } catch (e: any) {
    return jsonError('QUERY_ERROR', 'Failed to list templates', e.message, 500);
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('INVALID_BODY', 'Invalid JSON', null, 400); }

  const { storeId, name, config, winnerReferenceId } = body;
  if (!storeId || !name) return jsonError('MISSING_FIELDS', 'storeId and name required');

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

  const id = crypto.randomUUID();

  try {
    db.prepare(`
      INSERT INTO setup_templates (id, store_id, name, content_type, creative_type, funnel_stage,
        hook_style, avatar_style, platform, duration, aspect_ratio, provider, winner_reference_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, storeId, name,
      config?.contentType || null,
      config?.creativeType || null,
      config?.funnelStage || null,
      config?.hookStyle || null,
      config?.avatarStyle || null,
      config?.platformTarget || config?.platform || 'meta',
      config?.videoDuration || config?.duration || null,
      config?.dimension || config?.aspectRatio || null,
      config?.provider || null,
      winnerReferenceId || null,
    );

    const saved = db.prepare('SELECT * FROM setup_templates WHERE id = ?').get(id);
    return jsonSuccess({ template: saved }, 201);
  } catch (e: any) {
    return jsonError('SAVE_ERROR', 'Failed to save template', e.message, 500);
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return jsonError('MISSING_ID', 'id is required');

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

  try {
    const result = db.prepare('DELETE FROM setup_templates WHERE id = ?').run(id);
    if (result.changes === 0) return jsonError('NOT_FOUND', 'Template not found', null, 404);
    return jsonSuccess({ deleted: true });
  } catch (e: any) {
    return jsonError('DELETE_ERROR', 'Failed to delete', e.message, 500);
  }
}
