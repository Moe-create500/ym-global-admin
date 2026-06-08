/**
 * ElevenLabs TTS — High-quality voice generation.
 *
 * Default voice: Rachel (clear American English)
 * Model: eleven_turbo_v2 (fast, high quality)
 * Language: en-US locked
 */

const API_KEY = () => process.env.ELEVENLABS_API_KEY || '';
const BASE_URL = 'https://api.elevenlabs.io/v1';

// Pre-selected stable English voices
const VOICES: Record<string, string> = {
  rachel: '21m00Tcm4TlvDq8ikWAM',     // Rachel — clear, warm female
  drew: '29vD33N1CtxCmqQRPOHJ',        // Drew — confident male
  clyde: '2EiwWnXFnvU5JabPnv8n',       // Clyde — deep male
  domi: 'AZnzlk1XvdvUeBnXmlld',        // Domi — young female
  bella: 'EXAVITQu4vr4xnSDxMaL',       // Bella — soft female
  elli: 'MF3mGyEYCl7XYWbV9V6O',        // Elli — young female
  josh: 'TxGEqnHWrfWFTfGW9XjX',        // Josh — deep young male
  sam: 'yoZ06aMxZJJ28mfd3POQ',          // Sam — raspy male
};

export interface ElevenLabsResult {
  audioBuffer: Buffer;
  voice: string;
  model: string;
}

/**
 * Generate speech with ElevenLabs.
 */
export async function generateSpeech(
  text: string,
  options: {
    voice?: string;
    model?: string;
    stability?: number;
    similarityBoost?: number;
    speed?: number;
  } = {}
): Promise<ElevenLabsResult> {
  const key = API_KEY();
  if (!key) throw new Error('ELEVENLABS_API_KEY not set');

  const voiceName = options.voice || 'rachel';
  const voiceId = VOICES[voiceName] || VOICES.rachel;
  const model = options.model || 'eleven_turbo_v2';

  console.log(`[ELEVENLABS] Generating: voice=${voiceName} model=${model} text="${text.substring(0, 80)}..."`);

  const res = await fetch(`${BASE_URL}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text.substring(0, 5000),
      model_id: model,
      voice_settings: {
        stability: options.stability ?? 0.5,
        similarity_boost: options.similarityBoost ?? 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs error ${res.status}: ${errText.substring(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[ELEVENLABS] Generated: ${buf.length} bytes`);

  return { audioBuffer: buf, voice: voiceName, model };
}

/**
 * List available voices (for future UI).
 */
export function getAvailableVoices() {
  return Object.entries(VOICES).map(([name, id]) => ({ name, id }));
}
