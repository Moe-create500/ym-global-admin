import { renderScene as renderSeedanceScene } from '@/lib/seedance-pipeline';
import { waitForR2VVideo, acquireR2VRenderSlot, releaseR2VRenderSlot } from '@/lib/seedance';
import { describeProductImage } from '@/lib/vision';
import { stitchScenes } from '@/lib/scene-stitch';
import { generateUgcCharacter, deriveCharacterDescriptionFromContext } from '@/lib/character-image';
import { buildScenePrompts } from '@/lib/scene-prompt-builder';
import { STYLE_DEFINITIONS } from '@/lib/animation-styles';
import { persistSceneClip } from '@/lib/scene-clip-storage';
import type { Product, FailedScene, AnimationStyle } from '@/components/creative-generator/types';
import type { AdType, Scene } from '@/lib/scene-types';
import crypto from 'crypto';

/**
 * Unified scene-based video pipeline. Single backend for every ad type.
 *
 * Replaces the dual pipelines that existed pre-unification:
 *   - live-action-pipeline.ts (UGC, the proven Pattern 1 + Option A path)
 *   - animated-pipeline.ts    (animated, via Nano Banana storyboard + Seedance I2V)
 *
 * Architectural insight: Seedance R2V doesn't care about ad type — it takes a
 * prompt + reference images + produces a video. Ad type differences live
 * entirely in the prompt-generation layer (scene-prompt-builder.ts). The
 * orchestration below (character resolution, R2V dispatch, partial-stitch,
 * stitch) is identical across ad types.
 *
 * Stages:
 *   1. buildScenePrompts(adType, ...)  → Scene[]  (LLM, system prompt switches on adType)
 *   2. Maybe-resolve character image            (gated by adType)
 *   3. Promise.allSettled → R2V per scene with character + product refs as HTTPS URLs
 *   4. Partial-stitch threshold gate
 *   5. ffmpeg concat
 */

const PARTIAL_SUCCESS_RATIO = 0.5;
const PARTIAL_SUCCESS_FLOOR = 2;

export interface ScenePipelineResult {
  /** breakIntoScenes output (full requested set, including failed). */
  scenes: Scene[];
  /** Input script (may be empty for adType='b_roll' where no script exists). */
  script: string;
  /**
   * Seedance per-scene URLs in scene order. `null` entries indicate scenes
   * that failed; the stitched `finalVideoUrl` contains only the non-null
   * entries. Length always equals scenes.length.
   */
  sceneVideoUrls: (string | null)[];
  /** Stitched mp4 of surviving scenes. */
  finalVideoUrl: string;
  /** Sum of duration only over scenes whose render succeeded. */
  totalDurationSeconds: number;
  errors: string[];
  // Pattern 1 character-continuity metadata. Populated for adType='ugc' and
  // adType='animated' when the chosen animationStyle.requiresCharacterConsistency.
  // Undefined for adType='b_roll' (no avatar) and adType='animated' with
  // non-character styles (3d_motion_graphics, scientific_explainer).
  characterImageUrl?: string;
  characterImageSource?: 'user-uploaded' | 'auto-generated';
  characterDescription?: string;
  // Partial-stitch metadata.
  partial: boolean;
  requestedSceneCount: number;
  completedSceneCount: number;
  failedScenes: FailedScene[];
  // adType echoed back for callers/observers — written into template_data.
  adType: AdType;
  animationStyle?: AnimationStyle;
}

export interface RunScenePipelineOptions {
  /** Required. The only dispatcher into adType-specific behavior. */
  adType: AdType;
  /** Required when adType === 'animated'. Ignored for other ad types. */
  animationStyle?: AnimationStyle;
  totalDuration: number;
  sceneCount?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  /** Resolved product image URL (already validated public HTTPS). */
  productImageUrl?: string | null;
  productDescription?: string;
  creativeId?: string;
  contentMode?: 'product' | 'service';
  /** Optional pre-existing script from package-gen. UGC always passes;
   *  animated uses for narration anchoring; b_roll typically omits. */
  prompt?: string;
  angle?: string;
  // Pattern 1 character controls. Honored only when the ad type wants a
  // character (ugc, animated with character-consistent style).
  uploadedCharacterImageUrl?: string;
  useSharedCharacter?: boolean;
  characterDescription?: string;
  avatarStyle?: string;
}

/**
 * Returns true when this ad type + style combination needs a shared character
 * image generated/resolved before the scene loop. Drives Stage 2 (Pattern 1).
 */
function shouldUseCharacter(adType: AdType, animationStyle: AnimationStyle | undefined): boolean {
  if (adType === 'ugc') return true;
  if (adType === 'animated' && animationStyle) {
    return !!STYLE_DEFINITIONS[animationStyle]?.requiresCharacterConsistency;
  }
  return false; // b_roll, scene, animated-without-character — no avatar
}

export async function runScenePipeline(
  product: Pick<Product, 'title' | 'description' | 'image_url'>,
  options: RunScenePipelineOptions,
): Promise<ScenePipelineResult> {
  const errors: string[] = [];
  const adType = options.adType;
  const animationStyle = options.animationStyle;
  const totalDuration = Math.max(4, Math.min(60, options.totalDuration));
  const aspectRatio = options.aspectRatio || '9:16';
  const hasProductImage = !!options.productImageUrl;
  const sceneCount = options.sceneCount ?? 4;
  const prompt = options.prompt || '';

  console.log(
    `[SCENE-PIPELINE] Start: adType=${adType}` +
      (animationStyle ? `/${animationStyle}` : '') +
      ` | scenes=${sceneCount} | duration=${totalDuration}s | hasProductImage=${hasProductImage}`,
  );

  // Resolve product description (skip if pre-computed by caller).
  let productDescription = options.productDescription;
  if (!productDescription && product.image_url) {
    try {
      productDescription = (await describeProductImage(product.image_url, product.title)) || undefined;
    } catch {
      // Non-fatal — Seedance prompts work without it.
    }
  }

  // Stage 1: scene prompt builder. Single LLM call that switches on adType.
  const scenes = await buildScenePrompts({
    adType,
    animationStyle,
    product,
    script: prompt || undefined,
    angle: options.angle,
    totalDuration,
    sceneCount,
    hasProductImage,
    contentMode: options.contentMode,
  });

  if (scenes.length === 0) {
    throw new Error('Scene prompt builder returned zero scenes');
  }

  // Clamp each scene's duration to 4-8s. Scenes >8s exceed Fal.ai R2V poll
  // timeout (~5-10+ min). Alex Robinson tutorial baseline is 5-8s/scene.
  for (const scene of scenes) {
    if (scene.duration > 8) {
      errors.push(`Scene ${scene.sceneIndex} duration ${scene.duration}s exceeded 8s cap; clamped`);
      scene.duration = 8;
    }
    if (scene.duration < 4) {
      errors.push(`Scene ${scene.sceneIndex} duration ${scene.duration}s below 4s minimum; clamped`);
      scene.duration = 4;
    }
  }

  // Stage 2: Pattern 1 character image — gated by adType + style.
  //   adType='ugc'                         → always generate/resolve character
  //   adType='animated' with character style → generate/resolve character
  //   adType='animated' without character    → skip (3d_motion_graphics, scientific_explainer)
  //   adType='b_roll'                       → skip (no avatar by design)
  //   adType='scene'                        → skip (generic; caller can pass uploadedCharacterImageUrl
  //                                                  to force one if desired)
  const useSharedCharacter = options.useSharedCharacter !== false; // default true
  const wantCharacter = shouldUseCharacter(adType, animationStyle);
  let characterImageUrl: string | undefined;
  let characterImageSource: 'user-uploaded' | 'auto-generated' | undefined;
  let characterDescription: string | undefined;

  if (useSharedCharacter && wantCharacter) {
    if (options.uploadedCharacterImageUrl) {
      characterImageUrl = options.uploadedCharacterImageUrl;
      characterImageSource = 'user-uploaded';
      console.log(`[SCENE-PIPELINE] Using user-uploaded character image: ${characterImageUrl.substring(0, 100)}…`);
    } else {
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
          animationStyle,
        });
        characterImageUrl = charResult.imageUrl;
        characterImageSource = 'auto-generated';
      } catch (e: any) {
        // Non-fatal: degrade to T2V/I2V per-scene. The disconnected-characters
        // bug is a quality issue, not a correctness one.
        errors.push(
          `Character image generation failed (${e?.code || 'unknown'}: ${e?.message}); falling back to per-scene T2V/I2V (character will not be consistent across scenes)`,
        );
        console.warn(`[SCENE-PIPELINE] Character image generation failed — falling back: ${e?.message}`);
      }
    }
  }

  // Stage 3: parallel R2V via Seedance with partial-stitch tolerance.
  // Identical to the legacy live-action stage 2 — renderScene handles the
  // optional fields (no spokenScript → no audio; no productInHand → no UGC
  // placement text) so this loop is now ad-type agnostic.
  const settled = await Promise.allSettled(
    scenes.map(async (scene) => {
      // Global render-concurrency cap (default 4). ONE acquire per scene
      // before the retry loop; ONE release in finally after the loop.
      // Slot is HELD across both attempts — release-then-reacquire would
      // join the back of the FIFO wait queue behind every other pending
      // acquire, easily 2-4x the per-attempt budget for a scene that
      // already burned 8-12 min on attempt 1. acquire is OUTSIDE the try
      // because if it ever throws (it can't today, but defending against
      // future changes) there would be no slot to release.
      await acquireR2VRenderSlot();
      try {
        // Retry-once for transient failures (timeout, submission_failed).
        // Non-retryable: content_policy_violation, file_download_error,
        // unknown — deterministic-on-retry, so fail fast and let the
        // partial-stitch threshold gate decide the render outcome.
        const MAX_ATTEMPTS = 2;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          let requestId: string | undefined;
          try {
            const job = await renderSeedanceScene({
              scene,
              productImageUrl: options.productImageUrl ?? null,
              productDescription,
              aspectRatio,
              characterImageUrl,
            });
            requestId = job.requestId;
            const result = await waitForR2VVideo(job.requestId);
            if (!result.videoUrl) {
              throw new Error(`Seedance returned no videoUrl for scene ${scene.sceneIndex}`);
            }
            // Best-effort scene-clip library save. Runs only on a successful
            // waitForR2VVideo return — placed between the throw and the
            // return so a retry-on-failure (3bb2025) never double-saves
            // (failed attempts throw before reaching this line). persistSceneClip
            // wraps every internal step in try/catch and never throws, so the
            // pipeline cannot regress on a save error.
            await persistSceneClip({
              creativeId: options.creativeId,
              sceneIndex: scene.sceneIndex,
              videoUrl: result.videoUrl,
              visualPrompt: scene.visualPrompt,
              spokenScript: scene.spokenScript,
              duration: scene.duration,
              productTitle: product.title,
              style: adType === 'animated' && animationStyle ? `animated/${animationStyle}` : adType,
              adType,
              requestId: job.requestId,
            });
            return result.videoUrl;
          } catch (e: any) {
            const wrapped: any = e instanceof Error ? e : new Error(String(e));
            wrapped.sceneIndex = scene.sceneIndex;
            if (requestId) wrapped.requestId = requestId;

            // Classify with the EXACT same regex set + ordering as the
            // post-allSettled failure classifier below. Keeps retryability
            // and final FailedScene.reason aligned.
            const msg: string = wrapped.message || String(wrapped);
            let cls: 'timeout' | 'content_policy_violation' | 'file_download_error' | 'submission_failed' | 'unknown' = 'unknown';
            if (/timed out|timeout/i.test(msg)) cls = 'timeout';
            else if (/content_policy_violation|partner_validation_failed/i.test(msg)) cls = 'content_policy_violation';
            else if (/file_download_error|Failed to download/i.test(msg)) cls = 'file_download_error';
            else if (/HTTP 4\d{2}|R2V error|isQuota/i.test(msg)) cls = 'submission_failed';

            const retryable = cls === 'timeout' || cls === 'submission_failed';
            if (retryable && attempt < MAX_ATTEMPTS) {
              console.log(`[SCENE-PIPELINE] Scene ${scene.sceneIndex} attempt ${attempt + 1} (retrying after ${cls})`);
              continue;
            }
            throw wrapped;
          }
        }
        // Unreachable: each loop iteration either returns a videoUrl,
        // continues, or throws. Defensive throw to satisfy TS control-flow.
        throw new Error(`Scene ${scene.sceneIndex}: retry loop exited without result`);
      } finally {
        // Free the render slot on every termination path — success return,
        // thrown error, scene timeout. Leaking a slot eventually deadlocks
        // the process. ONE release per scene; slot held across retries.
        releaseR2VRenderSlot();
      }
    }),
  );

  const sceneVideoUrls: (string | null)[] = settled.map((s) =>
    s.status === 'fulfilled' ? s.value : null,
  );
  const failedScenes: FailedScene[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'rejected') {
      const err = s.reason;
      const msg: string = err?.message || String(err);
      let reason: FailedScene['reason'] = 'unknown';
      if (/timed out|timeout/i.test(msg)) reason = 'timeout';
      else if (/content_policy_violation|partner_validation_failed/i.test(msg)) reason = 'content_policy_violation';
      else if (/file_download_error|Failed to download/i.test(msg)) reason = 'file_download_error';
      else if (/HTTP 4\d{2}|R2V error|isQuota/i.test(msg)) reason = 'submission_failed';
      failedScenes.push({
        sceneIndex: err?.sceneIndex ?? scenes[i].sceneIndex,
        reason,
        message: msg.substring(0, 300),
        ...(err?.requestId ? { requestId: err.requestId } : {}),
      });
    }
  });

  const requestedSceneCount = scenes.length;
  const completedSceneCount = sceneVideoUrls.filter((u) => u !== null).length;
  const partial = failedScenes.length > 0;

  const minOk = Math.max(PARTIAL_SUCCESS_FLOOR, Math.ceil(requestedSceneCount * PARTIAL_SUCCESS_RATIO));
  if (completedSceneCount < minOk) {
    const breakdown = failedScenes.map((f) => `scene ${f.sceneIndex}: ${f.reason}`).join(', ');
    throw new Error(
      `Only ${completedSceneCount}/${requestedSceneCount} scenes succeeded (need ≥${minOk}). Failures: ${breakdown}`,
    );
  }

  if (partial) {
    errors.push(
      `Partial render: ${completedSceneCount}/${requestedSceneCount} scenes completed. Failed: ${failedScenes
        .map((f) => `${f.sceneIndex}(${f.reason})`)
        .join(', ')}.`,
    );
    console.warn(
      `[SCENE-PIPELINE] Partial render: ${completedSceneCount}/${requestedSceneCount} succeeded; failed=${JSON.stringify(failedScenes)}`,
    );
  }

  // Stage 4: stitch surviving scenes in original order.
  const succeededVideoUrls = sceneVideoUrls.filter((u): u is string => u !== null);
  const stitchId = options.creativeId || crypto.randomUUID();
  // Prefix tags the output filename for grep/debug; keep 'live_action' for
  // back-compat with existing stitch-output discovery patterns.
  const finalVideoUrl = await stitchScenes(succeededVideoUrls, stitchId, 'live_action');

  const totalDurationSeconds = scenes.reduce(
    (acc, s, i) => acc + (sceneVideoUrls[i] !== null ? s.duration : 0),
    0,
  );

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
    partial,
    requestedSceneCount,
    completedSceneCount,
    failedScenes,
    adType,
    animationStyle,
  };
}
