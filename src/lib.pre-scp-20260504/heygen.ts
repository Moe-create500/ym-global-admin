/**
 * HeyGen — AI Avatar Video Generation API
 * https://docs.heygen.com/reference/overview
 *
 * Creates talking avatar videos with lip-synced speech from a script.
 * Used in the video ad pipeline for generating the "creator talking" segments.
 */

const BASE_URL = 'https://api.heygen.com';
const API_KEY = () => process.env.HEYGEN_API_KEY || '';

export interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  gender: string;
  preview_image_url: string;
  preview_video_url: string;
}

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  preview_audio: string;
}

export interface HeyGenVideoResult {
  videoId: string;
}

export interface HeyGenVideoStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
}

async function heygenFetch(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: any
): Promise<any> {
  const key = API_KEY();
  if (!key) throw new Error('HEYGEN_API_KEY not set');

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      'X-Api-Key': key,
      'Accept': 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    let errorMessage = `HeyGen API error ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      errorMessage = parsed.error?.message || parsed.message || parsed.error || errorMessage;
    } catch {
      errorMessage = text.substring(0, 200) || errorMessage;
    }
    const err = new Error(errorMessage) as any;
    err.status = res.status;
    err.isQuota = res.status === 429;
    throw err;
  }

  return res.json();
}

/**
 * List all available HeyGen avatars.
 */
export async function listAvatars(): Promise<HeyGenAvatar[]> {
  const data = await heygenFetch('/v2/avatars');
  return (data.data?.avatars || []).map((a: any) => ({
    avatar_id: a.avatar_id,
    avatar_name: a.avatar_name,
    gender: a.gender,
    preview_image_url: a.preview_image_url,
    preview_video_url: a.preview_video_url,
  }));
}

/**
 * List all available HeyGen voices.
 */
export async function listVoices(): Promise<HeyGenVoice[]> {
  const data = await heygenFetch('/v2/voices');
  return (data.data?.voices || []).map((v: any) => ({
    voice_id: v.voice_id,
    name: v.name,
    language: v.language,
    gender: v.gender,
    preview_audio: v.preview_audio,
  }));
}

/**
 * Create an avatar video with the given script.
 * The avatar will lip-sync to the text using the specified voice.
 * Uses green screen background for potential compositing.
 */
export async function createAvatarVideo(
  script: string,
  options: {
    avatarId: string;
    voiceId: string;
    width?: number;
    height?: number;
    backgroundColor?: string;
  }
): Promise<HeyGenVideoResult> {
  const data = await heygenFetch('/v2/video/generate', 'POST', {
    video_inputs: [
      {
        character: {
          type: 'avatar',
          avatar_id: options.avatarId,
          avatar_style: 'normal',
        },
        voice: {
          type: 'text',
          voice_id: options.voiceId,
          input_text: script.substring(0, 5000),
          speed: 1.0,
          emotion: 'Friendly',
        },
        background: {
          type: 'color',
          value: options.backgroundColor || '#00FF00',
        },
      },
    ],
    dimension: {
      width: options.width || 1080,
      height: options.height || 1920,
    },
  });

  return { videoId: data.data?.video_id };
}

/**
 * Poll the status of a HeyGen avatar video generation.
 */
export async function getAvatarVideoStatus(videoId: string): Promise<HeyGenVideoStatus> {
  const data = await heygenFetch(`/v1/video_status.get?video_id=${videoId}`);
  const d = data.data || {};
  return {
    status: d.status === 'completed' ? 'completed'
      : d.status === 'failed' ? 'failed'
      : d.status === 'processing' ? 'processing'
      : 'pending',
    videoUrl: d.video_url || null,
    thumbnailUrl: d.thumbnail_url || null,
    error: d.error || null,
  };
}
