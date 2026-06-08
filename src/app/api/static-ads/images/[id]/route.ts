import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const creative: any = db.prepare('SELECT store_id FROM creatives WHERE id = ?').get(params.id);
  if (!creative) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const filePath = path.join(process.cwd(), 'static-ads', creative.store_id, `${params.id}.png`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Image file not found' }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
