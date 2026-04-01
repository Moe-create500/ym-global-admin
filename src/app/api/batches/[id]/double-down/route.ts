import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const batch: any = db.prepare('SELECT * FROM creative_batches WHERE id = ?').get(id);
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  // Get creatives from this batch
  const creatives: any[] = db.prepare(
    "SELECT * FROM creatives WHERE batch_id = ? AND nb_status = 'completed' ORDER BY type, batch_index"
  ).all(id);

  // Identify winning angles from batch performance data or just use all angles
  const videoPrompts = batch.video_prompts ? JSON.parse(batch.video_prompts) : [];
  const allAngles = videoPrompts.map((p: any) => p.angle).filter(Boolean);
  const winningAngles = batch.winning_angles ? JSON.parse(batch.winning_angles) : allAngles;

  // Create new batch
  const newId = crypto.randomUUID();
  const last: any = db.prepare(
    'SELECT MAX(batch_number) as max_num FROM creative_batches WHERE store_id = ?'
  ).get(batch.store_id);
  const batchNumber = (last?.max_num || 0) + 1;

  db.prepare(`
    INSERT INTO creative_batches (id, store_id, product_id, batch_number, name, status,
      parent_batch_id, product_context, offer, winning_angles)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    newId, batch.store_id, batch.product_id, batchNumber,
    `Batch #${batchNumber} - Double Down`,
    id,
    batch.product_context,
    batch.offer,
    JSON.stringify(winningAngles)
  );

  return NextResponse.json({
    success: true,
    newBatchId: newId,
    batchNumber,
    winningAngles,
    status: 'pending',
  });
}
