/**
 * Voiceover Mixer
 *
 * Takes a silent video + script text → generates TTS voiceover → mixes
 * the audio onto the video using ffmpeg → returns the final video URL.
 *
 * Flow:
 * 1. Generate TTS audio from the script (OpenAI TTS)
 * 2. Download the silent video
 * 3. Mix audio + video with ffmpeg (audio fits within video duration)
 * 4. Save to /public/uploads and return URL
 */

import { generateSpeech, getVoiceForAvatar, type TTSVoice } from './tts';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface VoiceoverResult {
  videoUrl: string;
  voice: string;
  durationSeconds: number;
}

/**
 * Add voiceover to a video.
 *
 * @param videoUrl — URL or local path of the silent video
 * @param script — the spoken text for the voiceover
 * @param options — voice, speed, avatar style
 */
export async function addVoiceover(
  videoUrl: string,
  script: string,
  options: {
    voice?: TTSVoice;
    avatarStyle?: string;
    speed?: number;
  } = {}
): Promise<VoiceoverResult> {
  if (!script || script.trim().length === 0) {
    throw new Error('No script provided for voiceover');
  }

  // Clean script — remove stage directions in [brackets], keep only spoken words
  const spokenText = script
    .replace(/\[.*?\]/g, '')           // remove [stage directions]
    .replace(/\(.*?\)/g, '')           // remove (parentheticals)
    .replace(/Scene \d+.*?:/gi, '')    // remove "Scene 1:" labels
    .replace(/\n{2,}/g, '\n')          // collapse double newlines
    .replace(/\s{2,}/g, ' ')           // collapse double spaces
    .trim();

  if (spokenText.length < 5) {
    throw new Error('Script has no spoken content after cleaning');
  }

  // Pick voice
  const voice = options.voice || (options.avatarStyle ? getVoiceForAvatar(options.avatarStyle) : 'nova');
  // Speed — slightly slower for ad delivery (0.9 = natural, unhurried pace)
  const speed = options.speed || 0.9;

  const tmpDir = path.join(process.cwd(), 'tmp', `vo-${crypto.randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Step 1: Generate TTS audio
    console.log(`[VOICEOVER] Generating TTS: voice=${voice}, speed=${speed}, text=${spokenText.substring(0, 60)}...`);
    const tts = await generateSpeech(spokenText, { voice, speed, model: 'tts-1-hd' });
    const audioPath = path.join(tmpDir, 'voiceover.mp3');
    writeFileSync(audioPath, tts.audioBuffer);

    // Step 2: Get the video file
    const videoPath = path.join(tmpDir, 'video.mp4');
    if (videoUrl.startsWith('http')) {
      // Remote URL — download
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error(`Failed to download video: ${res.status}`);
      writeFileSync(videoPath, Buffer.from(await res.arrayBuffer()));
    } else {
      // Local path — read directly from disk (never go through HTTP/auth)
      let localPath: string;
      if (videoUrl.includes('/api/products/uploads') || videoUrl.includes('file=')) {
        // Extract filename from URL-style path: /api/products/uploads?file=xyz.mp4
        const match = videoUrl.match(/file=([^&]+)/);
        const filename = match ? match[1] : videoUrl.split('/').pop() || '';
        localPath = path.join(process.cwd(), 'public', 'uploads', filename);
      } else if (videoUrl.startsWith('/')) {
        localPath = path.join(process.cwd(), 'public', videoUrl);
      } else {
        localPath = videoUrl; // absolute path
      }
      console.log(`[VOICEOVER] Reading video from disk: ${localPath}`);
      const { copyFileSync } = require('fs');
      copyFileSync(localPath, videoPath);
    }

    // Step 3: Get video duration
    const durationStr = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    const videoDuration = parseFloat(durationStr) || 20;

    // Step 4: Mix audio onto video with ffmpeg
    // - Audio starts at 0.3s (tiny delay for visual hook)
    // - Audio fades out 0.5s before video ends (clean ending)
    // - If audio is longer than video, it gets cut
    const outputFilename = `voiced_${crypto.randomUUID()}.mp4`;
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const outputPath = path.join(uploadsDir, outputFilename);

    console.log(`[VOICEOVER] Mixing: video=${videoDuration.toFixed(1)}s, adding voiceover...`);

    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${audioPath}" ` +
      `-filter_complex "[1:a]adelay=300|300,afade=t=out:st=${Math.max(0, videoDuration - 1)}:d=0.5[a]" ` +
      `-map 0:v -map "[a]" ` +
      `-c:v copy -c:a aac -b:a 128k ` +
      `-shortest -movflags +faststart "${outputPath}"`,
      { timeout: 30000, stdio: 'pipe' }
    );

    console.log(`[VOICEOVER] Complete: ${outputPath}`);

    // Cleanup temp files
    try { unlinkSync(videoPath); } catch {}
    try { unlinkSync(audioPath); } catch {}
    try { execSync(`rmdir "${tmpDir}" 2>/dev/null`, { stdio: 'pipe' }); } catch {}

    return {
      videoUrl: `/api/products/uploads?file=${outputFilename}`,
      voice,
      durationSeconds: videoDuration,
    };
  } catch (err: any) {
    // Cleanup on error
    try { execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' }); } catch {}
    throw err;
  }
}
