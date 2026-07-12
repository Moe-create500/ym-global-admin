import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { parseKalodataXlsx, importVideos, poolStats } from '@/lib/video-pool';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET ?storeId= → pool stats + recent videos
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  const db = getDb();
  const stats = poolStats(db, storeId);
  const recent: any[] = db.prepare(
    "SELECT id, caption, author, revenue, status FROM video_ads_pool WHERE store_id = ? ORDER BY revenue DESC LIMIT 15"
  ).all(storeId);
  return NextResponse.json({ stats, recent });
}

// POST multipart: file (Kalodata xlsx) + storeId → import into the pool
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'multipart form-data expected' }, { status: 400 });
  const storeId = String(form.get('storeId') || '');
  const file = form.get('file') as File | null;
  if (!storeId || !file) return NextResponse.json({ error: 'storeId and file required' }, { status: 400 });

  const tmpPath = path.join(os.tmpdir(), `kalodata-${crypto.randomUUID()}.xlsx`);
  try {
    fs.writeFileSync(tmpPath, Buffer.from(await file.arrayBuffer()));
    const rows = await parseKalodataXlsx(tmpPath);
    if (!rows.length) return NextResponse.json({ error: 'No TikTok video rows found in the file' }, { status: 400 });
    const db = getDb();
    const r = importVideos(db, storeId, rows);
    return NextResponse.json({ success: true, parsed: rows.length, ...r, stats: poolStats(db, storeId) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}
