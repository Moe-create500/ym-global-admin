import { breakIntoScenes, renderScene as renderSeedanceScene } from '@/lib/seedance-pipeline';
import type { Scene } from '@/lib/seedance-pipeline';
import { waitForVideo } from '@/lib/seedance';
import { describeProductImage } from '@/lib/vision';
import { stitchScenes } from '@/lib/scene-stitch';
import { generateUgcCharacter, deriveCharacterDescriptionFromContext } from '@/lib/character-image';
import type { Product } from '@/components/creative-generator/types';
import crypto from 'crypto';

/**
 * Result of a fully rendered live-action scene-based pipeline run.
 *
 * Mirrors AnimatedPipelineResult's role for the parallel pipeline. Does not
 * have a storyboardFrames field (live-action skips storyboard image gen — it
 * goes script -> per-scene Seedance T2V/I2V directly).
 */
export interface LiveActionPipelineResult {
  scenes: Scene[];                  // breakIntoScenes output
  script: string;                   // input prompt
  sceneVideoUrls: string[];         // Seedance per-scene URLs (raw fal.media)
  finalVideoUrl: string;            // stitched mp4 (or single-scene URL)
  totalDurationSeconds: number;
  errors: string[];                 // non-fatal warnings
  // Pattern 1 metadata — populated when characterImageUrl was resolved
  // (either user-uploaded or auto-generated). Caller persists to
  // creative_packages.strategy for observability + future re-use.
  characterImageUrl?: string;
  characterImageSource?: 'user-uploaded' | 'auto-generated';
  characterDescription?: string;
}

export interface RunLiveActionScenePipelineOptions {
  /** Total target duration in seconds; LLM splits among the requested scenes. */
  totalDuration: number;
  /** Target scene count from the Storyboard Scenes slider (3-15). When omitted,
   *  breakIntoScenes falls back to its 2-3 scene default. */
  sceneCount?: number;
  /** Aspect ratio for Seedance T2V/I2V (default '9:16'). */
  aspectRatio?: '9:16' | '16:9' | '1:1';
  /** Resolved product image URL — when provided, scenes with productVisible may use I2V. */
  productImageUrl?: string | null;
  /** Pre-computed product description (optional — saves a vision call). */
  productDescription?: string;
  /** DB creative id — used for stitch output filename. */
  creativeId?: string;
  /** When 'service', breakIntoScenes prepends 3PL/service-business framing
   *  to its system prompt. Default 'product' preserves existing behavior. */
  contentMode?: 'product' | 'service';
  /**
   * Pattern 1: user-supplied character image URL. When provided, skips auto-
   * generation and uses this URL as the shared reference across all scenes.
   * When undefined AND useSharedCharacter is true, the pipeline auto-generates
   * one character image via Nano Banana before the scene loop fires.
   */
  uploadedCharacterImageUrl?: string;
  /**
   * Pattern 1: enable shared-character mode. Default true. When false, falls
   * back to legacy T2V/I2V per-scene (character is re-rolled each scene —
   * the disconnected-characters behavior we used to ship).
   */
  useSharedCharacter?: boolean;
  /**
   * Pattern 1: optional explicit character description for auto-generation.
   * When omitted, pipeline derives one from product context + avatarStyle.
   */
  characterDescription?: string;
  /** avatarStyle from GeneratorConfig — feeds character description heuristic. */
  avatarStyle?: string;
}

/**
 * Main orchestrator for live-action scene-based renders.
 *
 *   Stage 1: breakIntoScenes (LLM)  — split prompt into 2-3 Scene records
 *   Stage 2: parallel Seedance T2V/I2V per scene
 *   Stage 3: stitch (single-scene short-circuit returns the URL directly)
 *
 * NOT included in v1 (matches animated pipeline's v1 scope):
 *   - Retry on individual scene failures (one failure aborts the run)
 *   - Promise.allSettled + partial-stitch
 *   - Per-engine duration math beyond Seedance (Sora/Veo/Hailuo would need
 *     scene-count adjustments — separate workstream if those engines come
 *     back into the UI)
 */
export async function runLiveActionScenePipeline(
  prompt: string,
  product: Pick<Product, 'title' | 'description' | 'image_url'>,
  options: RunLiveActionScenePipelineOptions,
): Promise<LiveActionPipelineResult> {
  const errors: string[] = [];
  const totalDuration = Math.max(4, Math.min(60, options.totalDuration));
  const aspectRatio = options.aspectRatio || '9:16';
  const hasProductImage = !!options.productImageUrl;

  // Resolve product description (skip if pre-computed by caller).
  let productDescription = options.productDescription;
  if (!productDescription && product.image_url) {
    try {
      productDescription = (await describeProductImage(product.image_url, product.title)) || undefined;
    } catch {
      // describeProductImage failures are non-fatal — Seedance prompts work
      // without it, just less product-anchored.
    }
  }

  // Stage 1: concept (script -> scenes). Pass sceneCount through so the
  // LLM produces exactly that many scenes (with a defensive clamp inside
  // breakIntoScenes for over-delivery / a warning for under-delivery).
  const scenes = await breakIntoScenes({
    script: prompt,
    totalDuration,
    productName: product.title,
    productDescription,
    hasProductImage,
    sceneCount: options.sceneCount,
    contentMode: options.contentMode,
  });

  if (scenes.length === 0) {
    throw new Error('breakIntoScenes returned zero scenes');
  }

  // Clamp each scene's duration to Seedance's 4-15s window. The LLM doesn't
  // always respect bounds; this is the runtime safety net.
  for (const scene of scenes) {
    if (scene.duration > 15) {
      errors.push(`Scene ${scene.sceneIndex} duration ${scene.duration}s exceeded Seedance 15s cap; clamped`);
      scene.duration = 15;
    }
    if (scene.duration < 4) {
      errors.push(`Scene ${scene.sceneIndex} duration ${scene.duration}s below Seedance 4s minimum; clamped`);
      scene.duration = 4;
    }
  }

  // Pattern 1: Stage 1.5 — resolve shared character image BEFORE scene loop.
  // Three paths: user-uploaded > auto-generated via Nano Banana > legacy
  // T2V/I2V (no shared character, kept for backward compat / opt-out).
  const useSharedCharacter = options.useSharedCharacter !== false; // default true
  let characterImageUrl: string | undefined;
  let characterImageSource: 'user-uploaded' | 'auto-generated' | undefined;
  let characterDescription: string | undefined;

  if (useSharedCharacter) {
    if (options.uploadedCharacterImageUrl) {
      characterImageUrl = options.uploadedCharacterImageUrl;
      characterImageSource = 'user-uploaded';
      console.log(`[LIVE_ACTION-PIPELINE] Using user-uploaded character image: ${characterImageUrl.substring(0, 100)}…`);
    } else {
      // Auto-generate. Caller's characterDescription wins; else derive from context.
      characterDescription = options.characterDescription
        || deriveCharacterDescriptionFromContext({
          productName: product.title,
          productDescription,
          avatarStyle: options.avatarStyle,
        });
      try {
        const charResult = await generateUgcCharacter(characterDescription, {
          aspectRatio: aspectRatio === '16:9' ? '16:9' : aspectRatio === '1:1' ? '1:1' : '9:16',
          size: '2K',
        });
        characterImageUrl = charResult.imageUrl;
        characterImageSource = 'auto-generated';
      } catch (e: any) {
        // Non-fatal: degrade to legacy T2V/I2V per-scene behavior with warning.
        // We do NOT throw — a pipeline failure here would block all
        // downstream scene rendering on top of an already-cheap-to-bypass
        // optimization. The disconnected-characters bug is a quality issue,
        // not a correctness one.
        errors.push(`Character image generation failed (${e?.code || 'unknown'}: ${e?.message}); falling back to legacy per-scene T2V/I2V (character will not be consistent across scenes)`);
        console.warn(`[LIVE_ACTION-PIPELINE] Character image generation failed — falling back to legacy: ${e?.message}`);
      }
    }
  }

  // Stage 2: render scenes in parallel via Seedance. When characterImageUrl is
  // set, renderSeedanceScene switches to R2V with the shared character image.
  // When undefined (failed gen or useSharedCharacter=false), falls back to
  // legacy T2V/I2V — backward compat preserved.
  const sceneVideoUrls = await Promise.all(
    scenes.map(async (scene) => {
      const job = await renderSeedanceScene({
        scene,
        productImageUrl: options.productImageUrl ?? null,
        productDescription,
        aspectRatio,
        characterImageUrl,
      });
      const result = await waitForVideo(job.requestId);
      if (!result.videoUrl) {
        throw new Error(`Seedance returned no videoUrl for scene ${scene.sceneIndex}`);
      }
      return result.videoUrl;
    }),
  );

  // Stage 3: stitch. 'live_action' prefix tags the output filename for
  // debugging. Single-scene case short-circuits inside stitchScenes.
  const stitchId = options.creativeId || crypto.randomUUID();
  const finalVideoUrl = await stitchScenes(sceneVideoUrls, stitchId, 'live_action');

  const totalDurationSeconds = scenes.reduce((acc, s) => acc + s.duration, 0);

  return {
    scenes,
    script: prompt,
    sceneVideoUrls,
    finalVideoUrl,
    totalDurationSeconds,
    errors,
    characterImageUrl,
    characterImageSource,
    characterDescription,
  };
}
