import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Stitches per-scene video URLs into a single mp4 using ffmpeg concat demuxer.
 *
 * Engine-agnostic: works for any sequence of mp4 URLs. Used by both
 * animated (I2V from storyboard frames) and live-action scene-based (T2V/I2V
 * direct) pipelines. Re-encodes audio to AAC to normalize across clips so
 * codec mismatches between fal.media outputs don't break stream-copy concat.
 *
 * Single-scene short-circuit: returns the input URL directly without
 * downloading, concatenating, or re-encoding. Saves ~30s-2min on the common
 * case of a 1-scene render.
 *
 * Timeout scales with scene count: 60s base + 15s per scene. At 6 scenes =
 * 150s; at 15 scenes = 285s. Conservative upper bound for slow EC2.
 *
 * Output filename: `{prefix}_{creativeId}.mp4`. Prefix lets callers tag the
 * file by pipeline (animated, live_action, etc) for debugging — DB-row
 * correlation comes from the creativeId portion.
 *
 * Extracted from animated-pipeline.ts during Step 5A (commit history will
 * name it). Was a private function there before live-action scene-based
 * needed the same behavior.
 */
export async function stitchScenes(
  sceneVideoUrls: string[],
  creativeId: string,
  prefix: string = 'scenes',
): Promise<string> {
  if (sceneVideoUrls.length === 0) {
    throw new Error('stitchScenes: no scene URLs to stitch');
  }
  if (sceneVideoUrls.length === 1) {
    return sceneVideoUrls[0];
  }

  const tag = `[${prefix.toUpperCase()}-STITCH]`;
  const tmpDir = path.join(process.cwd(), 'tmp', `stitch-${crypto.randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    const clipPaths: string[] = [];
    for (let i = 0; i < sceneVideoUrls.length; i++) {
      const url = sceneVideoUrls[i];
      const clipPath = path.join(tmpDir, `scene_${i}.mp4`);
      console.log(`${tag} Downloading scene ${i + 1}/${sceneVideoUrls.length}...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to download scene ${i + 1} (HTTP ${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(clipPath, buf);
      clipPaths.push(clipPath);
    }

    const concatPath = path.join(tmpDir, 'concat.txt');
    const concatContent = clipPaths.map(p => `file '${p}'`).join('\n');
    writeFileSync(concatPath, concatContent);

    const outputFilename = `${prefix}_${creativeId}.mp4`;
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const outputPath = path.join(uploadsDir, outputFilename);

    console.log(`${tag} Concatenating ${clipPaths.length} clips → ${outputFilename}`);
    const stitchTimeoutMs = 60_000 + (sceneVideoUrls.length * 15_000);
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
      { timeout: stitchTimeoutMs, stdio: 'pipe' }
    );

    console.log(`${tag} Output: ${outputPath}`);

    for (const p of clipPaths) { try { unlinkSync(p); } catch {} }
    try { unlinkSync(concatPath); } catch {}

    return `/api/products/uploads?file=${outputFilename}`;
  } catch (err: any) {
    try { execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' }); } catch {}
    throw err;
  }
}
