import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

// Thumbnail widths we allow (?w=) — anything else serves the original PNG.
// Thumbs are generated once with sharp and cached to disk as webp.
const THUMB_WIDTHS = new Set([150, 300, 600]);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const creative: any = db.prepare('SELECT store_id FROM creatives WHERE id = ?').get(params.id);
  if (!creative) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const filePath = path.join(process.cwd(), 'static-ads', creative.store_id, `${params.id}.png`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Image file not found' }, { status: 404 });
  }

  const w = Number(req.nextUrl.searchParams.get('w') || 0);
  if (THUMB_WIDTHS.has(w)) {
    const thumbDir = path.join(process.cwd(), 'static-ads', creative.store_id, '.thumbs');
    const thumbPath = path.join(thumbDir, `${params.id}-w${w}.webp`);

    if (!fs.existsSync(thumbPath)) {
      fs.mkdirSync(thumbDir, { recursive: true });
      await sharp(filePath).resize({ width: w }).webp({ quality: 78 }).toFile(thumbPath);
    }

    return new NextResponse(new Uint8Array(fs.readFileSync(thumbPath)), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
