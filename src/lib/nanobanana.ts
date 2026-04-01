/**
 * NanoBanana Video — AI Video Generation API
 * https://nanobananavideo.com/documentation.php
 *
 * Generates videos from text prompts or images.
 * Rate limit: 10 generations per 30 minutes.
 */

const BASE_URL = 'https://nanobananavideo.com/api/v1';
const API_KEY = () => process.env.NANOBANANA_API_KEY || '';

interface NBOptions {
  resolution?: '480p' | '720p' | '1080p';
  duration?: number; // 3-12 seconds
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5';
}

export interface NBVideoResult {
  videoId: string;
  videoUrl: string;
  thumbnailUrl: string;
  creditsUsed: number;
}

export interface NBVideoStatus {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
}

async function nbFetch(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any) {
  const key = API_KEY();
  if (!key) throw new Error('NANOBANANA_API_KEY not set');

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      'X-API-Key': key,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `NanoBanana API error ${res.status}`);
  }
  return data;
}

export async function textToVideo(
  prompt: string,
  options: NBOptions = {}
): Promise<NBVideoResult> {
  const data = await nbFetch('/text-to-video.php', 'POST', {
    prompt,
    resolution: options.resolution || '720p',
    duration: options.duration || 5,
    aspect_ratio: options.aspectRatio || '9:16',
  });

  return {
    videoId: data.video_id,
    videoUrl: data.video_url,
    thumbnailUrl: data.thumbnail_url,
    creditsUsed: data.credits_used || 0,
  };
}

export async function imageToVideo(
  imageUrls: string[],
  prompt: string,
  options: NBOptions = {}
): Promise<NBVideoResult> {
  const data = await nbFetch('/image-to-video.php', 'POST', {
    image_urls: imageUrls,
    prompt,
    resolution: options.resolution || '720p',
    duration: options.duration || 5,
    aspect_ratio: options.aspectRatio || '9:16',
  });

  return {
    videoId: data.video_id,
    videoUrl: data.video_url,
    thumbnailUrl: data.thumbnail_url,
    creditsUsed: data.credits_used || 0,
  };
}

export async function getVideoStatus(videoId: string): Promise<NBVideoStatus> {
  const data = await nbFetch(`/video-status.php?video_id=${videoId}`);
  return {
    status: data.status,
    videoUrl: data.video_url || undefined,
    thumbnailUrl: data.thumbnail_url || undefined,
  };
}
