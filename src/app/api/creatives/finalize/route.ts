import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { generateSpeech, getVoiceForAvatar } from '@/lib/tts';
import { muxVideoAudio } from '@/lib/mux';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/creatives/finalize
 *
 * Takes a completed silent video creative, generates voiceover from its script,
 * muxes them together with FFmpeg, and saves the final video with audio.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON' } }, { status: 400 });
  }

  const { creativeId, script, avatarStyle, speed } = body;

  if (!creativeId) {
    return NextResponse.json({ success: false, error: { code: 'MISSING_ID', message: 'creativeId is required' } }, { status: 400 });
  }

  const db = getDb();
  const creative: any = db.prepare('SELECT * FROM creatives WHERE id = ?').get(creativeId);

  if (!creative) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Creative not found' } }, { status: 404 });
  }

  if (creative.nb_status !== 'completed' || !creative.file_url) {
    return NextResponse.json({ success: false, error: { code: 'NOT_READY', message: 'Video not yet completed. Wait for video generation to finish.' } }, { status: 400 });
  }

  // Use provided script or extract from creative description
  const voiceScript = script || creative.description || '';
  if (!voiceScript.trim()) {
    return NextResponse.json({ success: false, error: { code: 'NO_SCRIPT', message: 'No script available for voiceover.' } }, { status: 400 });
  }

  const voice = getVoiceForAvatar(avatarStyle || 'female_ugc');

  try {
    console.log(`[FINALIZE] Starting for creative ${creativeId}, voice=${voice}, scriptLen=${voiceScript.length}`);

    // Step 1: Generate voiceover
    console.log('[FINALIZE] Generating voiceover...');
    const ttsResult = await generateSpeech(voiceScript, {
      voice,
      model: 'tts-1-hd',
      speed: speed || 1.0,
    });

    // Save voiceover file
    const voFilename = `vo_${crypto.randomUUID()}.mp3`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    const voPath = path.join(uploadDir, voFilename);
    await writeFile(voPath, ttsResult.audioBuffer);
    console.log(`[FINALIZE] Voiceover saved: ${voFilename}, ${ttsResult.audioBuffer.length} bytes`);

    // Step 2: Mux video + audio
    console.log('[FINALIZE] Muxing video + audio...');
    const muxResult = await muxVideoAudio(creative.file_url, voPath);
    console.log(`[FINALIZE] Muxed: ${muxResult.filename}`);

    // Step 3: Update creative record with final muxed URL
    db.prepare(`
      UPDATE creatives SET
        file_url = ?,
        template_data = json_set(COALESCE(template_data, '{}'), '$.silentVideoUrl', ?, '$.voiceoverUrl', ?, '$.muxedAt', ?),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      muxResult.outputUrl,
      creative.file_url, // preserve original silent video URL
      `/api/products/uploads?file=${voFilename}`,
      new Date().toISOString(),
      creativeId
    );

    console.log(`[FINALIZE] Complete! Creative ${creativeId} now has audio.`);

    return NextResponse.json({
      success: true,
      finalVideoUrl: muxResult.outputUrl,
      voiceoverUrl: `/api/products/uploads?file=${voFilename}`,
      silentVideoUrl: creative.file_url,
      voice: ttsResult.voice,
    });
  } catch (err: any) {
    console.error(`[FINALIZE] Error: ${err.message}`);
    return NextResponse.json({ success: false, error: { code: 'FINALIZE_ERROR', message: err.message } }, { status: 500 });
  }
}
