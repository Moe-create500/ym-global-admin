/**
 * Higgsfield Scene Planner & Video Stitcher
 *
 * Splits long-form ads into sequential 5-8s scenes, generates each with
 * Higgsfield, then stitches into one continuous video using ffmpeg.
 *
 * Supports multiple creative styles:
 * - product_showcase: clean product hero shots
 * - broll: lifestyle b-roll sequences
 * - ugc: UGC-style native content
 * - cartoon: animated/illustrated style
 * - asmr: satisfying product ASMR
 * - cinematic: dramatic cinematic reveal
 * - unboxing: product unboxing sequence
 */

import { createVideo, getVideoStatus } from './higgsfield';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

// ═══ Scene Styles ═══

export interface SceneStyle {
  key: string;
  label: string;
  description: string;
  sceneCount: number;
  scenes: { name: string; promptTemplate: string; durationHint: string; useProductImage: boolean }[];
}

export const HIGGSFIELD_STYLES: SceneStyle[] = [
  {
    key: 'product_showcase',
    label: 'Product Showcase',
    description: 'Clean hero shots — rotating, close-up, lifestyle placement',
    sceneCount: 3,
    scenes: [
      { name: 'Hero Reveal', useProductImage: true, promptTemplate: 'Cinematic product reveal. Dramatic lighting, slow zoom in on the product packaging. Clean dark background with soft spotlights. Product rotates slowly showing the label. Studio quality.', durationHint: '5-8s' },
      { name: 'Detail Shot', useProductImage: true, promptTemplate: 'Extreme close-up detail shot of the product. Camera slowly pans across the label, showing texture and branding. Shallow depth of field, warm lighting. Studio product photography in motion.', durationHint: '5-8s' },
      { name: 'Lifestyle Context', useProductImage: true, promptTemplate: 'The product placed elegantly on a marble countertop in a modern bathroom. Morning sunlight streaming in. Camera slowly pulls back revealing the luxury setting. Product is the focal point.', durationHint: '5-8s' },
    ],
  },
  {
    key: 'broll',
    label: 'B-Roll Sequence',
    description: 'Lifestyle b-roll — product in real-world scenes',
    sceneCount: 4,
    scenes: [
      { name: 'Morning Routine', useProductImage: false, promptTemplate: 'Woman reaching for a skincare product on a bathroom shelf during morning routine. Soft natural window light. Handheld iPhone footage feel. Real apartment, lived-in feel. The product is a {product}.', durationHint: '5s' },
      { name: 'Product Use', useProductImage: false, promptTemplate: 'Close-up of hands applying skincare product. Smooth slow motion. Natural lighting. Clean, minimal bathroom background. Focus on the gentle application. Relaxing, self-care moment.', durationHint: '5s' },
      { name: 'Result Moment', useProductImage: false, promptTemplate: 'Woman smiling in mirror, touching her glowing skin. Soft glow on skin. Natural light. Genuine, candid moment. iPhone quality footage with slight handheld movement. Happy and confident.', durationHint: '5s' },
      { name: 'Product Hero', useProductImage: true, promptTemplate: 'The product sitting on a clean surface with soft bokeh background. Golden hour light. Slow gentle camera orbit. Beautiful product-first composition.', durationHint: '5s' },
    ],
  },
  {
    key: 'ugc',
    label: 'UGC Style',
    description: 'Raw, native, creator-feel content',
    sceneCount: 3,
    scenes: [
      { name: 'Selfie Hook', useProductImage: false, promptTemplate: 'Young woman filming herself with iPhone, looking excited and about to show something. Ring light visible. Bedroom setting. Raw UGC creator energy. Genuine smile. She is holding a small product bottle.', durationHint: '5-8s' },
      { name: 'Show Product', useProductImage: true, promptTemplate: 'Close-up of a product being held up to the camera. Natural room lighting. Casual, unpolished feel. Real person showing a real product. iPhone selfie camera perspective.', durationHint: '5-8s' },
      { name: 'Reaction', useProductImage: false, promptTemplate: 'Person reacting positively, touching their face and smiling. Looking in mirror. Natural, unstaged moment. Warm bedroom lighting. UGC creator aesthetic. Genuinely impressed.', durationHint: '5-8s' },
    ],
  },
  {
    key: 'cartoon',
    label: 'Cartoon / Animated',
    description: 'Illustrated animated style ads',
    sceneCount: 3,
    scenes: [
      { name: 'Animated Intro', useProductImage: true, promptTemplate: 'Colorful 2D cartoon animation of the product bouncing into frame with sparkle effects. Bright, fun, playful animation style. Bold colors. Cartoon style product showcase.', durationHint: '5-8s' },
      { name: 'Benefits Animation', useProductImage: false, promptTemplate: 'Animated cartoon sequence showing health and beauty benefits with animated icons floating around. Bright colorful 2D animation. Fun, energetic motion graphics. Hearts, stars, and sparkle effects.', durationHint: '5-8s' },
      { name: 'CTA Animation', useProductImage: true, promptTemplate: 'Cartoon product with animated sparkles and a pulsing glow effect. Bright, inviting, playful 2D animation style. Product centered and clear. Shopping/buy-now energy.', durationHint: '5-8s' },
    ],
  },
  {
    key: 'asmr',
    label: 'ASMR / Satisfying',
    description: 'Satisfying close-up product interactions',
    sceneCount: 3,
    scenes: [
      { name: 'Unboxing', useProductImage: false, promptTemplate: 'Slow, satisfying unboxing of a premium product. Hands carefully removing tissue paper from a box. Extreme close-up. Soft ASMR lighting. Every texture visible. Slow deliberate movements.', durationHint: '5-8s' },
      { name: 'Texture Detail', useProductImage: true, promptTemplate: 'Extreme macro close-up of the product surface. Finger slowly tracing across the packaging. Satisfying detail shots. Soft warm lighting. ASMR visual style.', durationHint: '5-8s' },
      { name: 'Pour / Apply', useProductImage: false, promptTemplate: 'Satisfying slow pour of a golden liquid or cream onto fingertips. Close-up of application onto skin. Smooth, deliberate movements. Beautiful lighting. Visually satisfying content.', durationHint: '5-8s' },
    ],
  },
  {
    key: 'cinematic',
    label: 'Cinematic',
    description: 'Dramatic, movie-quality product reveal',
    sceneCount: 3,
    scenes: [
      { name: 'Dramatic Reveal', useProductImage: true, promptTemplate: 'Cinematic slow-motion reveal of the product emerging from darkness. Dramatic volumetric lighting. Smoke or mist effects. Film grain. Epic product entrance like a movie trailer.', durationHint: '5-8s' },
      { name: 'Orbit Shot', useProductImage: true, promptTemplate: 'Cinematic 360-degree orbit around the product. Professional studio lighting with dramatic shadows. Slow smooth camera movement. Film quality color grade. Dark moody atmosphere.', durationHint: '5-8s' },
      { name: 'Final Hero', useProductImage: true, promptTemplate: 'The product in a dramatic final hero pose. Backlit with golden rim lighting. Smoke wisps. Cinematic depth of field. Dark background. Premium luxury feel.', durationHint: '5-8s' },
    ],
  },
  {
    key: 'unboxing',
    label: 'Unboxing',
    description: 'Full unboxing experience sequence',
    sceneCount: 4,
    scenes: [
      { name: 'Package Arrival', useProductImage: false, promptTemplate: 'Hands receiving a small package on a doorstep. Clean shipping box with simple branding. Anticipation. Natural daylight. iPhone footage feel.', durationHint: '5s' },
      { name: 'Opening Box', useProductImage: false, promptTemplate: 'Hands opening a shipping box, tissue paper inside. Top-down camera angle. Natural lighting. Satisfying reveal moment. About to pull out the product.', durationHint: '5s' },
      { name: 'First Look', useProductImage: true, promptTemplate: 'Lifting the product out of a box, examining it up close. Rotating it in hands. Reading the label. Natural light. First impression moment. Real and genuine.', durationHint: '5s' },
      { name: 'Happy Customer', useProductImage: false, promptTemplate: 'Person holding a small product bottle with a genuine smile. Product next to face. Natural lighting. Happy customer moment. Authentic and relatable.', durationHint: '5s' },
    ],
  },
];

// ═══ Scene Planner ═══

export interface PlannedScene {
  index: number;
  name: string;
  prompt: string;
  imageUrl: string;
}

/**
 * Plan scenes for a Higgsfield multi-clip video.
 * Replaces {product} in templates with the actual product name.
 */
export interface FoundationData {
  beliefs?: string[];
  uniqueMechanism?: string;
  avatarSummary?: string;
  offerBrief?: string;
}

export function planScenes(
  styleKey: string,
  productName: string,
  productImageUrl: string,
  customAngle?: string,
  foundation?: FoundationData,
): PlannedScene[] {
  const style = HIGGSFIELD_STYLES.find(s => s.key === styleKey) || HIGGSFIELD_STYLES[0];

  return style.scenes.map((scene, i) => {
    let prompt = scene.promptTemplate.replace(/\{product\}/g, productName);
    prompt += ' SILENT — no audio, no sound effects, no ambient noise.';

    if (customAngle) {
      prompt += ` Creative angle: ${customAngle}.`;
    }

    // Inject foundation data — each scene targets a belief
    if (foundation) {
      if (foundation.beliefs && foundation.beliefs.length > 0) {
        // Assign one belief per scene (cycle if more scenes than beliefs)
        const belief = foundation.beliefs[i % foundation.beliefs.length];
        prompt += ` This scene must visually communicate and reinforce the belief: "${belief}".`;
      }
      if (foundation.uniqueMechanism) {
        prompt += ` The product's unique mechanism: ${foundation.uniqueMechanism}.`;
      }
    }

    return {
      index: i,
      name: scene.name,
      prompt,
      imageUrl: scene.useProductImage ? productImageUrl : '',
    };
  });
}

// ═══ Multi-Scene Generator ═══

export interface SceneResult {
  index: number;
  name: string;
  requestId: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  videoUrl: string | null;
  error: string | null;
}

/**
 * Extract the last frame of a video as a PNG, upload-ready.
 * Returns a temporary file path to the extracted frame.
 */
async function extractLastFrame(videoUrl: string, tmpDir: string): Promise<string | null> {
  try {
    // Download video
    const videoPath = path.join(tmpDir, `prev_${crypto.randomUUID()}.mp4`);
    const res = await fetch(videoUrl);
    if (!res.ok) return null;
    writeFileSync(videoPath, Buffer.from(await res.arrayBuffer()));

    // Get duration
    const durStr = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    const dur = parseFloat(durStr) || 5;

    // Extract last frame (0.1s before end)
    const framePath = path.join(tmpDir, `frame_${crypto.randomUUID()}.png`);
    execSync(
      `ffmpeg -y -ss ${Math.max(0, dur - 0.1)} -i "${videoPath}" -frames:v 1 -q:v 2 "${framePath}"`,
      { timeout: 15000, stdio: 'pipe' }
    );

    // Upload frame to public/uploads so Higgsfield can access it via URL
    const frameFilename = `frame_${crypto.randomUUID()}.png`;
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const { copyFileSync } = require('fs');
    copyFileSync(framePath, path.join(uploadsDir, frameFilename));

    // Cleanup temp video
    try { unlinkSync(videoPath); } catch {}
    try { unlinkSync(framePath); } catch {}

    // Return a publicly accessible URL — must be reachable by Higgsfield's servers
    const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://ymglobalventures.com';
    return `${baseUrl}/uploads/${frameFilename}`;
  } catch (err: any) {
    console.error('[HIGGS-SCENE] Failed to extract last frame:', err.message);
    return null;
  }
}

/**
 * Wait for a single scene to complete.
 */
async function waitForScene(
  requestId: string,
  timeoutMs: number = 120000,
  pollIntervalMs: number = 4000,
): Promise<{ status: string; videoUrl: string | null; error: string | null }> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const status = await getVideoStatus(requestId);
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'nsfw') {
        return status;
      }
    } catch {}
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  return { status: 'failed', videoUrl: null, error: 'Timed out waiting for scene' };
}

/**
 * Generate scenes with visual continuity.
 *
 * Each scene waits for the previous one to complete, then extracts the
 * last frame and feeds it as the input image for the next scene.
 * This creates seamless visual flow between clips.
 */
export async function generateScenes(
  scenes: PlannedScene[],
  onSceneUpdate?: (results: SceneResult[]) => void,
): Promise<SceneResult[]> {
  const results: SceneResult[] = scenes.map(s => ({
    index: s.index, name: s.name, requestId: '', status: 'queued' as const, videoUrl: null, error: null,
  }));

  const tmpDir = path.join(process.cwd(), 'tmp', `scenes-${crypto.randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  let previousVideoUrl: string | null = null;

  for (const scene of scenes) {
    const i = scene.index;

    try {
      // If we have a previous scene's video, extract its last frame
      // and use it as the input for this scene (visual continuity)
      let inputImage = scene.imageUrl || '';
      if (previousVideoUrl && i > 0) {
        console.log(`[HIGGS-SCENE] Extracting last frame from scene ${i} for continuity...`);
        const lastFrame = await extractLastFrame(previousVideoUrl, tmpDir);
        if (lastFrame) {
          inputImage = lastFrame;
          console.log(`[HIGGS-SCENE] Using last frame for scene ${i + 1} continuity`);
        }
      }

      console.log(`[HIGGS-SCENE] Generating scene ${i + 1}: ${scene.name} ${inputImage ? `(image: ${inputImage.substring(0, 60)}...)` : '(text-only)'}`);
      let result;
      try {
        result = await createVideo(scene.prompt, inputImage || '');
      } catch (createErr: any) {
        // If image-based call fails, retry as text-only
        console.error(`[HIGGS-SCENE] Scene ${i + 1} failed with image, retrying text-only:`, createErr.message?.substring(0, 100));
        result = await createVideo(scene.prompt);
      }

      results[i].requestId = result.requestId;
      results[i].status = 'in_progress';
      if (onSceneUpdate) onSceneUpdate(results);

      // Wait for THIS scene to complete before starting the next
      console.log(`[HIGGS-SCENE] Waiting for scene ${i + 1} to complete...`);
      const status = await waitForScene(result.requestId, 120000, 4000);

      results[i].status = status.status as any;
      results[i].videoUrl = status.videoUrl;
      results[i].error = status.error;

      if (status.status === 'completed' && status.videoUrl) {
        previousVideoUrl = status.videoUrl;
        console.log(`[HIGGS-SCENE] Scene ${i + 1} completed: ${status.videoUrl.substring(0, 60)}...`);
      } else {
        console.error(`[HIGGS-SCENE] Scene ${i + 1} failed: ${status.error || status.status}`);
        // Don't break — try next scene without continuity
      }

      if (onSceneUpdate) onSceneUpdate(results);

    } catch (err: any) {
      console.error(`[HIGGS-SCENE] Scene ${i + 1} error:`, err.message);
      results[i].status = 'failed';
      results[i].error = err.message;
      if (onSceneUpdate) onSceneUpdate(results);
    }
  }

  // Cleanup temp dir
  try { execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' }); } catch {}

  return results;
}

// ═══ Video Stitcher ═══

/**
 * Download video clips and stitch them together using ffmpeg.
 * Returns the URL of the final stitched video (saved to /public/uploads).
 */
export async function stitchScenes(sceneResults: SceneResult[]): Promise<string> {
  const completedScenes = sceneResults
    .filter(s => s.status === 'completed' && s.videoUrl)
    .sort((a, b) => a.index - b.index);

  if (completedScenes.length === 0) {
    throw new Error('No completed scenes to stitch');
  }

  // If only one scene, just return its URL directly
  if (completedScenes.length === 1) {
    return completedScenes[0].videoUrl!;
  }

  const tmpDir = path.join(process.cwd(), 'tmp', `stitch-${crypto.randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Download all clips
    const clipPaths: string[] = [];
    for (const scene of completedScenes) {
      const clipPath = path.join(tmpDir, `scene_${scene.index}.mp4`);
      console.log(`[STITCH] Downloading scene ${scene.index + 1}...`);
      const res = await fetch(scene.videoUrl!);
      if (!res.ok) throw new Error(`Failed to download scene ${scene.index + 1}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(clipPath, buf);
      clipPaths.push(clipPath);
    }

    // Create ffmpeg concat file
    const concatPath = path.join(tmpDir, 'concat.txt');
    const concatContent = clipPaths.map(p => `file '${p}'`).join('\n');
    writeFileSync(concatPath, concatContent);

    // Stitch with ffmpeg — re-encode to normalize formats
    const outputFilename = `higgs_${crypto.randomUUID()}.mp4`;
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const outputPath = path.join(uploadsDir, outputFilename);

    console.log(`[STITCH] Concatenating ${clipPaths.length} clips...`);
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -c:v libx264 -preset fast -crf 23 -an -movflags +faststart "${outputPath}"`,
      { timeout: 60000, stdio: 'pipe' }
    );

    console.log(`[STITCH] Output: ${outputPath}`);

    // Cleanup temp files
    for (const p of clipPaths) { try { unlinkSync(p); } catch {} }
    try { unlinkSync(concatPath); } catch {}

    return `/api/products/uploads?file=${outputFilename}`;
  } catch (err: any) {
    // Cleanup on error
    try { execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' }); } catch {}
    throw err;
  }
}
