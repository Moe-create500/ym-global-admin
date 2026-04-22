import { requireStoreAccess } from '@/lib/auth-tenant';
/**
 * Product Foundations API
 *
 * GET  /api/creatives/foundations?productId=xxx  — Get foundation for a product
 * POST /api/creatives/foundations                — Save/update foundation
 *
 * Stores per-product: necessary beliefs, avatar summary, offer brief,
 * unique mechanism, and research notes. Used by the creative generator
 * to craft argument-driven ads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}
function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) return jsonError('MISSING_PRODUCT', 'productId required');

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', e.message, 500); }

  const row: any = db.prepare('SELECT * FROM product_foundations WHERE product_id = ?').get(productId);
  if (!row) return jsonSuccess({ foundation: null });

  // Parse beliefs JSON
  let beliefs: string[] = [];
  try { beliefs = JSON.parse(row.beliefs || '[]'); } catch { beliefs = []; }

  return jsonSuccess({
    foundation: {
      ...row,
      beliefs,
    },
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('INVALID_BODY', 'Invalid JSON', 400); }

  const { storeId, productId, beliefs, avatarSummary, offerBrief, uniqueMechanism, researchNotes } = body;
  // ═══ TENANT ACCESS CHECK ═══
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;

  if (!storeId || !productId) return jsonError('MISSING_FIELDS', 'storeId and productId required');

  let db: any;
  try { db = getDb(); } catch (e: any) { return jsonError('DB_ERROR', e.message, 500); }

  const beliefsJson = JSON.stringify(beliefs || []);

  // Upsert — update if exists, insert if not
  const existing: any = db.prepare('SELECT id FROM product_foundations WHERE product_id = ?').get(productId);

  if (existing) {
    db.prepare(`
      UPDATE product_foundations SET beliefs = ?, avatar_summary = ?, offer_brief = ?,
        unique_mechanism = ?, research_notes = ?, updated_at = datetime('now')
      WHERE product_id = ?
    `).run(beliefsJson, avatarSummary || null, offerBrief || null, uniqueMechanism || null, researchNotes || null, productId);
  } else {
    db.prepare(`
      INSERT INTO product_foundations (id, store_id, product_id, beliefs, avatar_summary, offer_brief, unique_mechanism, research_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), storeId, productId, beliefsJson, avatarSummary || null, offerBrief || null, uniqueMechanism || null, researchNotes || null);
  }

  const saved: any = db.prepare('SELECT * FROM product_foundations WHERE product_id = ?').get(productId);
  return jsonSuccess({ foundation: { ...saved, beliefs: JSON.parse(saved.beliefs || '[]') } });
}
