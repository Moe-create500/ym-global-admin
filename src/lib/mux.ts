/**
 * Video + Audio Muxing via FFmpeg
 * Combines a silent video with a voiceover MP3 into a final video with audio.
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
async function downloadToTemp(url: string, ext: string, headers?: Record<string, string>): Promise<string> {
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
