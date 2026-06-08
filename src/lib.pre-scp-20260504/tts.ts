/**
 * Text-to-Speech via OpenAI TTS API
 * Uses the existing OPENAI_API_KEY
 *
 * Voices: alloy, echo, fable, onyx, nova, shimmer
 * Models: tts-1 (fast), tts-1-hd (quality)
 */

const BASE_URL = 'https://api.openai.com/v1';
const API_KEY = () => process.env.OPENAI_API_KEY || '';

export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface TTSResult {
  audioBuffer: Buffer;
  voice: string;
  model: string;
}

/**
 * Generate spoken audio from text.
 * Returns raw audio buffer (MP3).
 */
export async function generateSpeech(
  text: string,
  options: {
    voice?: TTSVoice;
    model?: 'tts-1' | 'tts-1-hd';
    speed?: number; // 0.25 to 4.0
  } = {}
): Promise<TTSResult> {
  const key = API_KEY();
  if (!key) throw new Error('OPENAI_API_KEY not set (needed for TTS)');

  const voice = options.voice || 'nova'; // nova = warm female, good for UGC
  const model = options.model || 'tts-1';
  const speed = options.speed || 1.0;

  const res = await fetch(`${BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      speed,
      response_format: 'mp3',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI TTS error ${res.status}: ${text.substring(0, 200)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    voice,
    model,
  };
}

/**
 * Map avatar style to best TTS voice.
 */
export function getVoiceForAvatar(avatarStyle: string): TTSVoice {
  const voiceMap: Record<string, TTSVoice> = {
    'female_ugc': 'nova',       // warm, natural female
    'male_ugc': 'onyx',         // deep, natural male
    'creator_influencer': 'shimmer', // bright, energetic
    'expert_authority': 'fable',     // authoritative, clear
    'podcast_host': 'echo',          // conversational, smooth
    'faceless_product_only': 'alloy', // neutral, clean
  };
  return voiceMap[avatarStyle] || 'nova';
}
