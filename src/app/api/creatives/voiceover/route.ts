import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { generateSpeech, getVoiceForAvatar } from '@/lib/tts';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * POST /api/creatives/voiceover
 * Generate a voiceover from a script and save it.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON' } }, { status: 400 });
  }

  const { creativeId, script, avatarStyle, speed } = body;

  if (!script) {
    return NextResponse.json({ success: false, error: { code: 'MISSING_SCRIPT', message: 'script is required' } }, { status: 400 });
  }

  try {
    const voice = getVoiceForAvatar(avatarStyle || 'female_ugc');
    const result = await generateSpeech(script, {
      voice,
      model: 'tts-1-hd',
      speed: speed || 1.0,
    });

    // Save audio file
    const filename = `vo_${crypto.randomUUID()}.mp3`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), result.audioBuffer);

    const audioUrl = `/api/products/uploads?file=${filename}`;

    // If creativeId provided, update the creative record
    if (creativeId) {
      try {
        const db = getDb();
        db.prepare("UPDATE creatives SET template_data = json_set(COALESCE(template_data, '{}'), '$.voiceoverUrl', ?) WHERE id = ?")
          .run(audioUrl, creativeId);
      } catch {}
    }

    return NextResponse.json({
      success: true,
      audioUrl,
      voice: result.voice,
      model: result.model,
      filename,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: { code: 'TTS_ERROR', message: err.message } }, { status: 500 });
  }
}
