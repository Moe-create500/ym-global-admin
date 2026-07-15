import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { parseKalodataXlsx, importVideos, importVideoLinks, poolStats } from '@/lib/video-pool';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET ?storeId=&productId= → pool stats (product-aware) + recent videos
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const productId = req.nextUrl.searchParams.get('productId') || null;
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  const db = getDb();
  const stats = poolStats(db, storeId, productId);
  const recent: any[] = productId
    ? db.prepare("SELECT id, caption, author, revenue, status, product_id FROM video_ads_pool WHERE store_id = ? AND (product_id = ? OR product_id IS NULL) ORDER BY revenue DESC LIMIT 15").all(storeId, productId)
    : db.prepare("SELECT id, caption, author, revenue, status, product_id FROM video_ads_pool WHERE store_id = ? ORDER BY revenue DESC LIMIT 15").all(storeId);
  return NextResponse.json({ stats, recent });
}

// POST multipart: file (Kalodata xlsx) + storeId [+ productId] → import
// POST json: { storeId, productId?, links: ["https://tiktok.com/@x/video/…"] } → import pasted links
export async function POST(req: NextRequest) {
  const db = getDb();
  const ctype = req.headers.get('content-type') || '';

  if (ctype.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    const { storeId, productId, links } = body || {};
    if (!storeId || !Array.isArray(links) || !links.length) {
      return NextResponse.json({ error: 'storeId and a non-empty links array required' }, { status: 400 });
    }
    const r = importVideoLinks(db, storeId, productId || null, links.slice(0, 100));
    return NextResponse.json({ success: true, parsed: links.length, ...r, stats: poolStats(db, storeId, productId || null) });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'multipart form-data or JSON expected' }, { status: 400 });
  const storeId = String(form.get('storeId') || '');
  const productId = String(form.get('productId') || '') || null;
  const file = form.get('file') as File | null;
  if (!storeId || !file) return NextResponse.json({ error: 'storeId and file required' }, { status: 400 });

  const tmpPath = path.join(os.tmpdir(), `kalodata-${crypto.randomUUID()}.xlsx`);
  try {
    fs.writeFileSync(tmpPath, Buffer.from(await file.arrayBuffer()));
    const rows = await parseKalodataXlsx(tmpPath);
    if (!rows.length) return NextResponse.json({ error: 'No TikTok video rows found in the file' }, { status: 400 });
    const r = importVideos(db, storeId, productId, rows);
    return NextResponse.json({ success: true, parsed: rows.length, ...r, stats: poolStats(db, storeId, productId) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}
