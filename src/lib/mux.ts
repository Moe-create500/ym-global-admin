/**
 * Video + Audio Muxing & Timeline Editing via FFmpeg
 * - muxVideoAudio: Combines a silent video with a voiceover MP3
 * - editTimeline: Interleaves avatar + B-roll clips into a single video
 */

import { execFile } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface MuxResult {
  outputPath: string;
  outputUrl: string;
  filename: string;
}

/**
 * Download a file from URL to a local temp path.
 */
export async function downloadToTemp(url: string, ext: string, headers?: Record<string, string>): Promise<string> {
  const tmpDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `tmp_${crypto.randomUUID()}.${ext}`);

  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(tmpFile, buffer);
  return tmpFile;
}

/**
 * Combine video + audio using FFmpeg.
 * Video is the visual track, audio is the voiceover.
 * Output duration matches the shorter of the two.
 */
export async function muxVideoAudio(
  videoUrl: string,
  audioPath: string,
  fetchHeaders?: Record<string, string>,
): Promise<MuxResult> {
  const tmpDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(tmpDir, { recursive: true });

  // Download video
  const videoPath = await downloadToTemp(videoUrl, 'mp4', fetchHeaders);
  const outputFilename = `final_${crypto.randomUUID()}.mp4`;
  const outputPath = path.join(tmpDir, outputFilename);

  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y',                    // overwrite
      '-i', videoPath,         // video input
      '-i', audioPath,         // audio input
      '-c:v', 'copy',         // copy video stream (no re-encode)
      '-af', 'volume=1.8',    // boost audio volume 80%
      '-c:a', 'aac',          // encode audio to AAC
      '-b:a', '256k',         // audio bitrate (HD quality)
      '-shortest',            // match shorter duration
      '-movflags', '+faststart', // web-optimized
      outputPath,
    ], { timeout: 60000 }, async (error, stdout, stderr) => {
      // Clean up temp video file
      try { await unlink(videoPath); } catch {}

      if (error) {
        reject(new Error(`FFmpeg failed: ${error.message}`));
        return;
      }

      resolve({
        outputPath,
        outputUrl: `/api/products/uploads?file=${outputFilename}`,
        filename: outputFilename,
      });
    });
  });
}

/**
 * Edit a timeline of avatar + B-roll clips into a single video.
 * Interleaves avatar segments (3s each) with B-roll clips (5s each).
 * Avatar audio plays continuously as voiceover across all cuts.
 */
export async function editTimeline(
  avatarVideoUrl: string,
  brollVideoUrls: string[],
  options?: {
    avatarSegmentSec?: number;
    brollSegmentSec?: number;
  }
): Promise<MuxResult> {
  const tmpDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(tmpDir, { recursive: true });

  const avatarSec = options?.avatarSegmentSec || 3;
  const brollSec = options?.brollSegmentSec || 5;
  const n = brollVideoUrls.length;

  // Download all clips
  console.log(`[TIMELINE] Downloading avatar + ${n} B-roll clips...`);
  const avatarPath = await downloadToTemp(avatarVideoUrl, 'mp4');
  const brollPaths: string[] = [];
  for (const url of brollVideoUrls) {
    try {
      const p = await downloadToTemp(url, 'mp4');
      brollPaths.push(p);
    } catch (err) {
      console.error(`[TIMELINE] Failed to download B-roll: ${err}`);
    }
  }

  if (brollPaths.length < 2) {
    // Clean up
    try { await unlink(avatarPath); } catch {}
    for (const p of brollPaths) { try { await unlink(p); } catch {} }
    throw new Error(`Not enough B-roll clips downloaded (got ${brollPaths.length}, need at least 2)`);
  }

  const outputFilename = `pipeline_${crypto.randomUUID()}.mp4`;
  const outputPath = path.join(tmpDir, outputFilename);

  // Build FFmpeg concat file approach:
  // 1. Trim avatar into segments
  // 2. Use B-roll clips as-is (already ~5s)
  // 3. Write concat list
  // 4. Concat visual track
  // 5. Overlay continuous avatar audio

  const segmentFiles: string[] = [];

  try {
    // Step 1: Trim avatar into segments
    const avatarSegments = Math.min(n + 1, Math.floor(60 / avatarSec)); // cap at reasonable count
    for (let i = 0; i < avatarSegments; i++) {
      const segFile = path.join(tmpDir, `tmp_avseg_${crypto.randomUUID()}.mp4`);
      const startTime = i * avatarSec;
      await new Promise<void>((resolve, reject) => {
        execFile('ffmpeg', [
          '-y', '-i', avatarPath,
          '-ss', String(startTime), '-t', String(avatarSec),
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-an', // strip audio for visual-only segments
          '-movflags', '+faststart',
          segFile,
        ], { timeout: 30000 }, (err) => err ? reject(err) : resolve());
      });
      segmentFiles.push(segFile);
    }

    // Step 2: Scale B-roll clips
    const scaledBrolls: string[] = [];
    for (const bp of brollPaths) {
      const scaledFile = path.join(tmpDir, `tmp_brscaled_${crypto.randomUUID()}.mp4`);
      await new Promise<void>((resolve, reject) => {
        execFile('ffmpeg', [
          '-y', '-i', bp,
          '-t', String(brollSec), // trim to brollSec
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-an', // strip audio
          '-movflags', '+faststart',
          scaledFile,
        ], { timeout: 30000 }, (err) => err ? reject(err) : resolve());
      });
      scaledBrolls.push(scaledFile);
      segmentFiles.push(scaledFile);
    }

    // Step 3: Build concat list (interleave: avatar, broll, avatar, broll, ..., avatar)
    const concatListFile = path.join(tmpDir, `tmp_concat_${crypto.randomUUID()}.txt`);
    const concatLines: string[] = [];
    const actualBrolls = Math.min(scaledBrolls.length, avatarSegments - 1);

    for (let i = 0; i < actualBrolls; i++) {
      // Avatar segment, then B-roll
      if (i < avatarSegments) concatLines.push(`file '${segmentFiles[i]}'`);
      concatLines.push(`file '${scaledBrolls[i]}'`);
    }
    // Final avatar segment (closing)
    if (actualBrolls < avatarSegments) {
      concatLines.push(`file '${segmentFiles[actualBrolls]}'`);
    }

    await writeFile(concatListFile, concatLines.join('\n'));
    segmentFiles.push(concatListFile);

    // Step 4: Concat visual segments
    const visualFile = path.join(tmpDir, `tmp_visual_${crypto.randomUUID()}.mp4`);
    segmentFiles.push(visualFile);

    await new Promise<void>((resolve, reject) => {
      execFile('ffmpeg', [
        '-y', '-f', 'concat', '-safe', '0', '-i', concatListFile,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-movflags', '+faststart',
        visualFile,
      ], { timeout: 60000 }, (err) => err ? reject(err) : resolve());
    });

    // Step 5: Extract avatar audio and combine with visual
    await new Promise<void>((resolve, reject) => {
      execFile('ffmpeg', [
        '-y',
        '-i', visualFile,    // visual track
        '-i', avatarPath,    // avatar video (for audio)
        '-map', '0:v',       // take video from visual concat
        '-map', '1:a',       // take audio from avatar
        '-c:v', 'copy',      // no re-encode on video
        '-c:a', 'aac', '-b:a', '192k',
        '-af', 'volume=1.5', // boost voice slightly
        '-shortest',         // end when visual track ends
        '-movflags', '+faststart',
        outputPath,
      ], { timeout: 60000 }, (err) => err ? reject(err) : resolve());
    });

    console.log(`[TIMELINE] Final video created: ${outputFilename}`);

    return {
      outputPath,
      outputUrl: `/api/products/uploads?file=${outputFilename}`,
      filename: outputFilename,
    };
  } finally {
    // Clean up all temp files
    for (const f of segmentFiles) { try { await unlink(f); } catch {} }
    try { await unlink(avatarPath); } catch {}
    for (const p of brollPaths) { try { await unlink(p); } catch {} }
  }
}
