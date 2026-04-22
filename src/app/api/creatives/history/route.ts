import { requireStoreAccess } from '@/lib/auth-tenant';
/**
 * Past Generations History / Library API
 *
 * GET /api/creatives/history?storeId=xxx&...filters
 *
 * Returns past generations, rendered creatives, and winners
 * with full filtering and search support.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}
function jsonError(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const storeId = sp.get('storeId');
  if (!storeId) return jsonError('MISSING_STORE', 'storeId is required');
  // ═══ TENANT ACCESS CHECK ═══
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', 'Database failed', e.message, 500); }

  // Filters
  const contentType = sp.get('contentType');
  const creativeType = sp.get('creativeType');
  const funnelStage = sp.get('funnelStage');
  const provider = sp.get('provider');
  const aspectRatio = sp.get('aspectRatio');
  const winnerOnly = sp.get('winnerOnly') === '1';
  const launchedOnly = sp.get('launchedOnly') === '1';
  const search = sp.get('search');
  const limit = parseInt(sp.get('limit') || '100');
  const offset = parseInt(sp.get('offset') || '0');

  try {
    // ── 1. Past generation packages ──
    let pkgWhere = 'cp.store_id = ?';
    const pkgParams: any[] = [storeId];

    if (contentType) { pkgWhere += ' AND cp.content_type = ?'; pkgParams.push(contentType); }
    if (creativeType) { pkgWhere += ' AND cp.creative_type = ?'; pkgParams.push(creativeType); }
    if (funnelStage) { pkgWhere += ' AND cp.funnel_stage = ?'; pkgParams.push(funnelStage); }
    if (search) { pkgWhere += ' AND (cp.packages LIKE ? OR cp.offer LIKE ?)'; pkgParams.push(`%${search}%`, `%${search}%`); }

    const packages: any[] = db.prepare(`
      SELECT cp.*, p.title as product_title
      FROM creative_packages cp
      LEFT JOIN products p ON p.id = cp.product_id
      WHERE ${pkgWhere}
      ORDER BY cp.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...pkgParams, limit, offset);

    // Parse JSON fields
    for (const pkg of packages) {
      try { pkg.packages = pkg.packages ? JSON.parse(pkg.packages) : []; } catch { pkg.packages = []; }
      try { pkg.strategy = pkg.strategy ? JSON.parse(pkg.strategy) : null; } catch { pkg.strategy = null; }
    }

    // ── 2. Rendered creatives ──
    let crWhere = 'c.store_id = ?';
    const crParams: any[] = [storeId];

    if (contentType) {
      if (contentType === 'video') { crWhere += " AND c.type = 'video'"; }
      else { crWhere += " AND c.type = 'image'"; }
    }
    if (provider) { crWhere += ' AND c.template_id = ?'; crParams.push(provider); }
    if (aspectRatio) { crWhere += ' AND c.format = ?'; crParams.push(aspectRatio); }
    if (launchedOnly) { crWhere += ' AND c.fb_video_id IS NOT NULL'; }
    if (search) { crWhere += ' AND (c.title LIKE ? OR c.description LIKE ? OR c.angle LIKE ?)'; crParams.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    const creatives: any[] = db.prepare(`
      SELECT c.*, s.name as store_name, p.title as product_title
      FROM creatives c
      JOIN stores s ON s.id = c.store_id
      LEFT JOIN products p ON p.id = c.product_id
      WHERE ${crWhere}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...crParams, limit, offset);

    // ── 3. Winners for this store ──
    const winners: any[] = db.prepare(
      'SELECT id, creative_id, package_id, title, content_type, creative_type, funnel_stage FROM winner_references WHERE store_id = ? ORDER BY created_at DESC'
    ).all(storeId);

    // Build a set of winner creative IDs and package IDs for badge matching
    const winnerCreativeIds = new Set(winners.filter(w => w.creative_id).map(w => w.creative_id));
    const winnerPackageIds = new Set(winners.filter(w => w.package_id).map(w => w.package_id));

    // Mark creatives that are winners
    for (const c of creatives) {
      c.isWinner = winnerCreativeIds.has(c.id);
    }

    // Mark packages that have winner references
    for (const pkg of packages) {
      pkg.hasWinner = winnerPackageIds.has(pkg.id);
    }

    // Filter to winners only if requested
    const finalCreatives = winnerOnly ? creatives.filter(c => c.isWinner) : creatives;
    const finalPackages = winnerOnly ? packages.filter(p => p.hasWinner) : packages;

    // ── 4. Counts for filter UI ──
    const totalPackages: any = db.prepare('SELECT COUNT(*) as count FROM creative_packages WHERE store_id = ?').get(storeId);
    const totalCreatives: any = db.prepare('SELECT COUNT(*) as count FROM creatives WHERE store_id = ?').get(storeId);

    return jsonSuccess({
      packages: finalPackages,
      creatives: finalCreatives,
      winners,
      counts: {
        totalPackages: totalPackages?.count || 0,
        totalCreatives: totalCreatives?.count || 0,
        totalWinners: winners.length,
      },
    });
  } catch (e: any) {
    return jsonError('QUERY_ERROR', 'Failed to query history', e.message, 500);
  }
}
