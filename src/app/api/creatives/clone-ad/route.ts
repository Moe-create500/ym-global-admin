import { requireStoreAccess } from '@/lib/auth-tenant';
/**
 * POST /api/creatives/clone-ad
 *
 * Clone Ad Pipeline:
 *   1. Download reference video from URL
 *   2. Extract 5 key frames via ffmpeg
 *   3. Analyze each frame with Gemini Vision
 *   4. Generate Seedance 2.0 optimized prompts (6-part structure)
 *   5. Return creative packages ready for the existing generation pipeline
 *
 * Input:  { storeId, referenceUrl, productId?, productName?, coverImageUrl?, quantity? }
 * Output: { success, packages, sceneBreakdown, referenceAnalysis }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { describeProductImage } from '@/lib/vision';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';

function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}
function jsonError(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

// ═══ Frame extraction via ffmpeg ═══

async function downloadVideo(url: string, destPath: string): Promise<void> {
  console.log(`[CLONE] Downloading video: ${url.substring(0, 120)}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download video: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
  console.log(`[CLONE] Downloaded ${buf.length} bytes`);
}

function getVideoDuration(videoPath: string): number {
  try {
    const raw = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    return parseFloat(raw) || 10;
  } catch {
    return 10;
  }
}

function extractFrames(videoPath: string, outDir: string, count: number = 5): string[] {
  const duration = getVideoDuration(videoPath);
  const framePaths: string[] = [];
  // Extract evenly spaced frames (skip first 0.3s to avoid black)
  for (let i = 0; i < count; i++) {
    const ts = Math.max(0.3, (duration * (i + 0.5)) / count);
    const framePath = path.join(outDir, `frame_${i}.jpg`);
    try {
      execSync(
        `ffmpeg -y -ss ${ts.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`,
        { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' }
      );
      framePaths.push(framePath);
    } catch (e: any) {
      console.error(`[CLONE] Frame extraction at ${ts.toFixed(2)}s failed: ${e.message?.substring(0, 100)}`);
    }
  }
  console.log(`[CLONE] Extracted ${framePaths.length}/${count} frames from ${duration.toFixed(1)}s video`);
  return framePaths;
}

// ═══ Frame analysis via Gemini Vision ═══

async function analyzeFrame(
  frameBase64: string, mimeType: string,
  frameIndex: number, totalFrames: number, timestampLabel: string
): Promise<string> {
  const key = GEMINI_KEY();
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const prompt = `You are analyzing frame ${frameIndex + 1}/${totalFrames} (at ~${timestampLabel}) of a product advertisement video for the purpose of recreating it.

Describe this frame concisely using this EXACT structure:
CAMERA: [shot type + camera movement if apparent — e.g. "close-up, slow dolly in" or "medium shot, static"]
SUBJECT: [what/who is in frame — specific visual details: clothing, skin tone, hair, product shape/color/label]
ACTION: [what is happening — single verb phrase: "holds bottle toward camera", "pours liquid into glass"]
ENVIRONMENT: [background/setting — specific renderable details: kitchen, bathroom, outdoor, studio]
LIGHTING: [lighting setup — e.g. "soft window light from left", "golden hour backlight", "ring light"]
MOOD: [overall feel — 2-3 words: "warm authentic", "clinical clean", "energetic bold"]

Be specific and visual. No marketing language. Only describe what you SEE in this single frame.`;

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: frameBase64 } },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
  };

  const res = await fetch(
    `${GEMINI_URL}/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini frame analysis failed: ${res.status} ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

// ═══ Seedance prompt builder from scene analysis ═══

function buildSeedancePrompts(
  sceneAnalyses: string[],
  videoDuration: number,
  productName: string,
  productVisualDesc: string | null,
  quantity: number,
): any[] {
  const segmentDuration = videoDuration / sceneAnalyses.length;
  const packages: any[] = [];

  // Build the timeline structure from analyzed frames
  const timelineParts: string[] = [];
  sceneAnalyses.forEach((analysis, i) => {
    const startSec = (segmentDuration * i).toFixed(0);
    const endSec = (segmentDuration * (i + 1)).toFixed(0);
    timelineParts.push(`[${startSec}s–${endSec}s] ${analysis}`);
  });
  const timeline = timelineParts.join('\n');

  // Extract dominant elements from the analyses for variation generation
  const fullAnalysis = sceneAnalyses.join('\n');

  for (let v = 0; v < quantity; v++) {
    // Build Seedance-optimized prompt (50-150 words, structured)
    const promptParts: string[] = [];

    // Product visual reference (from cover image classification)
    if (productVisualDesc) {
      promptParts.push(`PRODUCT: "${productName}" — ${productVisualDesc}`);
    } else if (productName) {
      promptParts.push(`PRODUCT: "${productName}"`);
    }

    // Scene-by-scene timeline
    promptParts.push(`\nTIMELINE (${videoDuration}s total):`);
    promptParts.push(timeline);

    // Variation instructions
    if (v > 0) {
      const variationTypes = [
        'Use a different camera angle for the opening shot. Change the lighting warmth.',
        'Different presenter/hand model. Shift the environment slightly (different room, different time of day).',
        'Change the product reveal timing. Use a different background texture or color.',
        'Reverse the shot order. Open on the product, pull back to reveal the scene.',
      ];
      promptParts.push(`\nVARIATION ${v + 1}: ${variationTypes[(v - 1) % variationTypes.length]}`);
    }

    // Technical constraints for Seedance
    promptParts.push(`\nSTYLE: Photorealistic, shallow depth of field, natural lighting. UGC authentic feel. Film grain. ${videoDuration}-second video.`);
    promptParts.push('RULES: Natural conversational pacing. Product appears naturally in the scene. No static product photo opening. No background music text in prompt.');

    const script = promptParts.join('\n');

    packages.push({
      title: `Clone — ${productName || 'Ad'} ${quantity > 1 ? `V${v + 1}` : ''}`.trim(),
      angle: 'Cloned from reference ad',
      hook: sceneAnalyses[0]?.match(/ACTION:\s*(.+)/i)?.[1] || 'Product reveal hook',
      script: script.substring(0, 2000),
      sceneStructure: `${sceneAnalyses.length} scenes across ${videoDuration}s — cloned from reference`,
      visualDirection: fullAnalysis.substring(0, 500),
      brollDirection: '',
      avatarSuggestion: fullAnalysis.match(/SUBJECT:\s*(.+)/i)?.[1] || 'Match reference presenter',
      cta: 'Shop Now',
      adCopy: `${productName} — as seen in this ad`,
      headline: productName || 'Product Ad',
      variants: ['Different camera angle', 'Different lighting', 'Different environment'],
      _cloned: true,
      _referenceFrameCount: sceneAnalyses.length,
      contentType: 'video',
      stage: 'tof',
    });
  }

  return packages;
}

// ═══ POST handler ═══

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('INVALID_BODY', 'Invalid JSON'); }

  const { storeId, referenceUrl, productId, productName, coverImageUrl, quantity = 3, videoDuration = 10 } = body;
  // ═══ TENANT ACCESS CHECK ═══
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;


  if (!storeId) return jsonError('MISSING_STORE', 'storeId required');
  if (!referenceUrl) return jsonError('MISSING_URL', 'referenceUrl is required — paste a video URL to clone');

  console.log(`[CLONE] Starting clone: url=${referenceUrl.substring(0, 100)}, product=${productName || '(none)'}, qty=${quantity}`);

  // Validate URL — must be a direct video URL (not YouTube — those need yt-dlp)
  const isDirectVideo = /\.(mp4|mov|webm|avi)(\?|$)/i.test(referenceUrl) ||
    referenceUrl.includes('fal.media') || referenceUrl.includes('sora-') ||
    referenceUrl.includes('.mp4') || referenceUrl.includes('video');
  const isYouTube = referenceUrl.includes('youtube.com') || referenceUrl.includes('youtu.be');

  if (isYouTube) {
    return jsonError('YOUTUBE_NOT_SUPPORTED', 'YouTube URLs are not directly supported. Download the video first and upload it, or paste a direct video URL (MP4/MOV/WebM).');
  }

  // Create temp working directory
  const workDir = path.join(process.cwd(), 'tmp', `clone-${crypto.randomUUID().slice(0, 8)}`);
  try {
    await mkdir(workDir, { recursive: true });
  } catch {}

  try {
    // Step 1: Download video
    const videoPath = path.join(workDir, 'reference.mp4');
    await downloadVideo(referenceUrl, videoPath);

    // Step 2: Extract frames
    const frameCount = Math.min(5, Math.max(3, Math.round(videoDuration / 2)));
    const framePaths = extractFrames(videoPath, workDir, frameCount);

    if (framePaths.length === 0) {
      return jsonError('FRAME_EXTRACTION_FAILED', 'Could not extract any frames from the video. The URL may not be a valid video file.');
    }

    // Step 3: Analyze each frame with Gemini Vision (parallel)
    const duration = getVideoDuration(videoPath);
    console.log(`[CLONE] Analyzing ${framePaths.length} frames from ${duration.toFixed(1)}s video`);

    const frameAnalyses = await Promise.all(
      framePaths.map(async (fp, i) => {
        try {
          const buf = await readFile(fp);
          const base64 = buf.toString('base64');
          const ts = `${((duration * (i + 0.5)) / framePaths.length).toFixed(1)}s`;
          const analysis = await analyzeFrame(base64, 'image/jpeg', i, framePaths.length, ts);
          console.log(`[CLONE] Frame ${i + 1}: ${analysis.substring(0, 120)}...`);
          return analysis;
        } catch (e: any) {
          console.error(`[CLONE] Frame ${i + 1} analysis failed: ${e.message}`);
          return `Frame ${i + 1}: [analysis failed]`;
        }
      })
    );

    // Step 4: Get product visual description (if cover image provided)
    let productVisualDesc: string | null = null;
    if (coverImageUrl) {
      productVisualDesc = await describeProductImage(coverImageUrl, productName || undefined);
    }

    // Step 5: Generate Seedance-optimized packages
    const packages = buildSeedancePrompts(
      frameAnalyses.filter(a => !a.includes('[analysis failed]')),
      Math.round(duration),
      productName || 'Product',
      productVisualDesc,
      quantity,
    );

    console.log(`[CLONE] Generated ${packages.length} clone packages from ${frameAnalyses.length} frames`);

    // Step 6: Save to creative_packages for history
    try {
      const db = getDb();
      const pkgId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO creative_packages (id, store_id, content_type, creative_type, funnel_stage,
          hook_style, avatar_style, generation_goal, quantity, product_id, strategy, packages, status, version)
        VALUES (?, ?, 'video', 'clone', 'tof', 'pattern_interrupt', 'female_ugc', 'clone_ad', ?, ?, ?, ?, 'completed', 1)
      `).run(
        pkgId, storeId, quantity, productId || null,
        JSON.stringify({ referenceUrl, frameCount: framePaths.length, videoDuration: Math.round(duration) }),
        JSON.stringify(packages),
      );
    } catch (e: any) {
      console.error(`[CLONE] DB save failed (non-fatal): ${e.message}`);
    }

    return jsonSuccess({
      packages,
      sceneBreakdown: frameAnalyses,
      referenceAnalysis: {
        duration: Math.round(duration),
        frameCount: framePaths.length,
        url: referenceUrl,
      },
      config: {
        contentType: 'video',
        creativeType: 'clone',
        funnelStage: 'tof',
        quantity,
        videoDuration: Math.round(duration),
      },
    });

  } catch (err: any) {
    console.error(`[CLONE] Pipeline error: ${err.message}`);
    return jsonError('CLONE_FAILED', `Clone pipeline failed: ${err.message?.substring(0, 300)}`, null, 500);
  } finally {
    // Cleanup temp files
    try { await rm(workDir, { recursive: true, force: true }); } catch {}
  }
}
