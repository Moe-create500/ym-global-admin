/**
 * Scene Clip Library — Commit 1.
 *
 * Persists each per-scene MP4 that Seedance R2V produces to local storage
 * with metadata + thumbnail, so individual clips can be searched/reused
 * later (instead of being discarded after the stitch step). Best-effort:
 * any failure is logged and swallowed — the render pipeline never blocks
 * on a save.
 *
 * Schema migration lives HERE, not in src/lib/db.ts:
 *   - db.ts is owned by ym-global-admin (CLAUDE.md "READ-ONLY") and
 *     is NOT in deploy-creative.sh's rsync allowlist.
 *   - CREATE TABLE IF NOT EXISTS is idempotent — running it lazily on
 *     first persistSceneClip() call achieves the same end state without
 *     touching db.ts.
 *   - migrationApplied guard avoids re-running the CREATEs on every call
 *     (one-time cost per process, ~1ms when it does run).
 *
 * Storage layout (on server):
 *   /home/ubuntu/ym-global/storage/scene-clips/<creativeId>/<sceneIndex>.mp4
 *   /home/ubuntu/ym-global/storage/scene-clips/<creativeId>/thumbs/<sceneIndex>.jpg
 *
 * Disk growth: ~5-8 MB per clip × ~5-8 scenes per render ≈ 30-50 MB/render.
 * No eviction in v1; will need an LRU/size-based sweep once the library
 * grows past a few hundred renders. Flag in the commit message.
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '@/lib/db';

/** Lazy-migration guard. Set true once CREATE TABLE has been issued in this
 * process. Idempotent CREATEs are cheap but skipping them avoids the
 * sqlite roundtrip on every save. */
let migrationApplied = false;

function ensureSchema(db: ReturnType<typeof getDb>): void {
  if (migrationApplied) return;
  db.exec(`CREATE TABLE IF NOT EXISTS scene_clips (
    id              TEXT PRIMARY KEY,
    creative_id     TEXT NOT NULL,
    scene_index     INTEGER NOT NULL,
    video_url       TEXT,
    local_path      TEXT NOT NULL,
    thumbnail_path  TEXT,
    duration_seconds INTEGER,
    product_id      TEXT,
    product_title   TEXT,
    style           TEXT,
    ad_type         TEXT,
    visual_prompt   TEXT,
    spoken_script   TEXT,
    request_id      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scene_clips_creative ON scene_clips(creative_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scene_clips_product ON scene_clips(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scene_clips_style ON scene_clips(style)`);
  migrationApplied = true;
}

export interface PersistSceneClipOptions {
  /** The parent creative's id. When undefined, save is skipped (no orphan rows). */
  creativeId: string | undefined;
  sceneIndex: number;
  /** Fal CDN URL — will be downloaded once to local storage. May expire later. */
  videoUrl: string;
  visualPrompt?: string;
  spokenScript?: string;
  duration?: number;
  productId?: string | null;
  productTitle?: string;
  /** Composite style key: 'ugc' | 'animated/claymation' | 'animated/pixar_3d' |
   *  'animated/3d_motion_graphics' | 'animated/scientific_explainer' | 'b_roll' | 'scene' */
  style?: string;
  adType?: string;
  requestId?: string;
}

/**
 * Best-effort persistence of a single scene clip + thumbnail + DB row.
 *
 * NEVER throws. Any failure (network, disk, ffmpeg, sqlite) is logged via
 * console.error and the function returns. The render pipeline must treat
 * this as fire-and-await with no error surface.
 */
export async function persistSceneClip(opts: PersistSceneClipOptions): Promise<void> {
  if (!opts.creativeId) {
    console.log('[SCENE-CLIP-SAVE] skipped — no creativeId');
    return;
  }
  try {
    const db = getDb();
    ensureSchema(db);

    // Storage paths (server: /home/ubuntu/ym-global/storage/...).
    const baseDir = path.join(process.cwd(), 'storage', 'scene-clips', opts.creativeId);
    const thumbsDir = path.join(baseDir, 'thumbs');
    const localPath = path.join(baseDir, `${opts.sceneIndex}.mp4`);
    const thumbPath = path.join(thumbsDir, `${opts.sceneIndex}.jpg`);
    mkdirSync(thumbsDir, { recursive: true });

    // 1) Download MP4 from Fal CDN to permanent local storage.
    const res = await fetch(opts.videoUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      throw new Error(`download HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(localPath, buf);

    // 2) Extract a thumbnail at the 1s mark. Mirror scene-stitch.ts's
    //    execSync pattern: ffmpeg, stdio:'pipe' to suppress noise, fixed
    //    timeout. Thumbnail failure is best-effort — we still INSERT the
    //    row with thumbnail_path=null in that case.
    let savedThumbPath: string | null = null;
    try {
      execSync(
        `ffmpeg -y -i "${localPath}" -ss 00:00:01 -vframes 1 -q:v 3 "${thumbPath}"`,
        { timeout: 15_000, stdio: 'pipe' },
      );
      savedThumbPath = thumbPath;
    } catch (thumbErr: any) {
      console.error(`[SCENE-CLIP-SAVE] thumbnail extraction failed for ${opts.creativeId}/${opts.sceneIndex}: ${thumbErr?.message || thumbErr}`);
    }

    // 3) INSERT row. Soft FK on creative_id — no REFERENCES constraint
    //    (the parent creative row may be written concurrently by the
    //    route handler and isn't guaranteed to exist yet).
    db.prepare(`INSERT INTO scene_clips (
      id, creative_id, scene_index, video_url, local_path, thumbnail_path,
      duration_seconds, product_id, product_title, style, ad_type,
      visual_prompt, spoken_script, request_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(),
      opts.creativeId,
      opts.sceneIndex,
      opts.videoUrl,
      localPath,
      savedThumbPath,
      opts.duration ?? null,
      opts.productId ?? null,
      opts.productTitle ?? null,
      opts.style ?? null,
      opts.adType ?? null,
      opts.visualPrompt ?? null,
      opts.spokenScript ?? null,
      opts.requestId ?? null,
    );

    console.log(`[SCENE-CLIP-SAVE] persisted ${opts.creativeId}/scene-${opts.sceneIndex} (${buf.length} bytes${savedThumbPath ? ' + thumb' : ''})`);
  } catch (err: any) {
    console.error(`[SCENE-CLIP-SAVE] failed for ${opts.creativeId}/scene-${opts.sceneIndex}: ${err?.message || err}`);
    // Swallow — best-effort persistence, never block the render.
  }
}
