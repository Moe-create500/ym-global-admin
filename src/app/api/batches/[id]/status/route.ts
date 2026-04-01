import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVideoStatus as soraGetStatus, getVideoDownloadUrl, getThumbnailUrl } from '@/lib/sora';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const batch: any = db.prepare('SELECT * FROM creative_batches WHERE id = ?').get(id);
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  const creatives: any[] = db.prepare(
    'SELECT * FROM creatives WHERE batch_id = ? ORDER BY type, batch_index'
  ).all(id);

  // Poll status for any still processing
  for (const c of creatives) {
    if (c.nb_status !== 'processing' || !c.nb_video_id) continue;

    try {
      if (c.template_id === 'sora') {
        const status = await soraGetStatus(c.nb_video_id);
        if (status.status === 'completed') {
          const downloadUrl = await getVideoDownloadUrl(c.nb_video_id);
          const thumbUrl = await getThumbnailUrl(c.nb_video_id);
          db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ?, thumbnail_url = ?, updated_at = datetime('now') WHERE id = ?")
            .run(downloadUrl, thumbUrl, c.id);
          c.nb_status = 'completed';
          c.file_url = downloadUrl;
          c.thumbnail_url = thumbUrl;
        } else if (status.status === 'failed') {
          db.prepare("UPDATE creatives SET nb_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(c.id);
          c.nb_status = 'failed';
        }
      }
      // minimax-image creatives are already 'completed' on insert — no polling needed
    } catch {
      // Ignore polling errors, will retry on next poll
    }
  }

  // Count statuses
  const videos = creatives.filter(c => c.type === 'video');
  const images = creatives.filter(c => c.type === 'image');

  const videoStats = {
    total: videos.length,
    completed: videos.filter(c => c.nb_status === 'completed').length,
    processing: videos.filter(c => c.nb_status === 'processing').length,
    failed: videos.filter(c => c.nb_status === 'failed').length,
  };
  const imageStats = {
    total: images.length,
    completed: images.filter(c => c.nb_status === 'completed').length,
    processing: images.filter(c => c.nb_status === 'processing').length,
    failed: images.filter(c => c.nb_status === 'failed').length,
  };

  // Update batch counts
  db.prepare(`
    UPDATE creative_batches SET
      completed_videos = ?, completed_images = ?,
      failed_count = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(videoStats.completed, imageStats.completed, videoStats.failed + imageStats.failed, id);

  // If all done, update batch status
  const allDone = (videoStats.processing === 0 && imageStats.processing === 0);
  if (allDone && batch.status === 'generating') {
    db.prepare("UPDATE creative_batches SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id);
    batch.status = 'active';
  }

  return NextResponse.json({
    batchId: id,
    status: batch.status,
    videos: videoStats,
    images: imageStats,
    creatives,
  });
}
