import { generateAnimatedConcept } from '@/lib/animated-concept';
import type { AnimatedConceptPackage } from '@/lib/animated-concept';
import { generateStoryboard } from '@/lib/animated-storyboard';
import type { StoryboardFrame } from '@/lib/animated-storyboard';
import { createImageToVideo, waitForVideo } from '@/lib/seedance';
import { stitchScenes } from '@/lib/scene-stitch';
import { generateUgcCharacter, deriveCharacterDescriptionFromContext } from '@/lib/character-image';
import { STYLE_DEFINITIONS } from '@/lib/animation-styles';
import type { GeneratorConfig, Product } from '@/components/creative-generator/types';
import crypto from 'crypto';

/**
 * Result of a fully rendered animated ad pipeline run.
 */
export interface AnimatedPipelineResult {
  concept: AnimatedConceptPackage;
  storyboardFrames: StoryboardFrame[];
  sceneVideoUrls: string[];        // one per scene, ordered by sceneIndex (raw fal.media URLs)
  finalVideoUrl: string;           // stitched mp4 served from /public/uploads (always populated)
  totalDurationSeconds: number;
  errors: string[];                // non-fatal warnings collected during pipeline
  // Pattern 1 metadata — populated when a shared character image was used
  // for the storyboard's frame-0 reference (character-consistent styles only).
  characterImageUrl?: string;
  characterImageSource?: 'user-uploaded' | 'auto-generated';
  characterDescription?: string;
}

/**
 * Per-scene Seedance render job descriptor.
 */
interface SceneRenderJob {
  sceneIndex: number;
  frameUrl: string;
  motionPrompt: string;
  duration: number;
  voSegment: string;
}

/**
 * Builds the Seedance image-to-video prompt for a single scene.
 * Mirrors the lessons from the recent Seedance gibberish fix:
 *   - Isolate VO in `She says: "..."` format
 *   - No FAST-PACED / CRITICAL PACING contradictions
 *   - No OPENING / Scene timing meta-instructions
 *   - Animation style described once at the top
 */
function buildSceneMotionPrompt(job: SceneRenderJob, _styleNotes: string): string {
  const parts: string[] = [];
  if (job.motionPrompt) parts.push(job.motionPrompt);
  if (job.voSegment && job.voSegment.trim().length > 0) {
    // Quotes signal "dialogue" to Seedance TTS without leaking a label.
    // Bare voSegment (commit 6a4165b) didn't trigger spoken VO — claymation
    // ran with ambient audio only. Quote-wrap (34324ec) is what makes
    // Seedance speak the voSegment as dialogue.
    parts.push(`"${job.voSegment.trim()}"`);
  }
  return parts.join('\n\n');
}

/**
 * Renders a single scene by calling Seedance image-to-video on the storyboard frame.
 * Returns the resulting video URL once the job completes.
 */
async function renderScene(
  job: SceneRenderJob,
  styleNotes: string,
): Promise<string> {
  const prompt = buildSceneMotionPrompt(job, styleNotes);

  const submission = await createImageToVideo(prompt, job.frameUrl, {
    duration: job.duration,
  });

  const result = await waitForVideo(submission.requestId);
  if (!result.videoUrl) {
    throw new Error(`Seedance returned no videoUrl for scene ${job.sceneIndex}`);
  }
  return result.videoUrl;
}

/**
 * Main orchestrator: runs concept -> storyboard -> scene renders -> stitch.
 *
 * NOT included in v1:
 *   - VO TTS layer (Seedance handles audio natively per scene)
 *   - Retry logic on individual scene failures (one failure aborts the run)
 *   - Promise.allSettled with partial-stitch (currently Promise.all rejects whole batch)
 */
export async function runAnimatedPipeline(
  config: GeneratorConfig,
  product: Pick<Product, 'title' | 'description' | 'image_url'>,
  options?: {
    inspirationHooks?: string[];
    creativeId?: string;
    contentMode?: 'product' | 'service';
    /** Pattern 1: user-uploaded character image URL (skips auto-gen). */
    uploadedCharacterImageUrl?: string;
    /** Pattern 1: opt-out flag — default true (auto-generate when no upload). */
    useSharedCharacter?: boolean;
    /** Pattern 1: optional explicit character description for auto-generation. */
    characterDescription?: string;
  },
): Promise<AnimatedPipelineResult> {
  const errors: string[] = [];

  // Stage 1: concept
  const concept = await generateAnimatedConcept({
    config,
    product,
    inspirationHooks: options?.inspirationHooks,
    contentMode: options?.contentMode,
  });

  if (!concept.durationValid) {
    errors.push(
      `Scene durations sum to a different total than expectedDuration (${concept.durationSeconds}s). Proceeding anyway.`,
    );
  }

  // Pattern 1: resolve shared character image BEFORE storyboard. Only meaningful
  // for character-consistent styles (claymation, pixar_3d). For non-character
  // styles (3d_motion_graphics, scientific_explainer), characterImageUrl is
  // passed but ignored downstream — no extra Nano Banana call needed there.
  const styleDef = STYLE_DEFINITIONS[config.animationStyle!];
  const useSharedCharacter = options?.useSharedCharacter !== false; // default true
  let characterImageUrl: string | undefined;
  let characterImageSource: 'user-uploaded' | 'auto-generated' | undefined;
  let characterDescription: string | undefined;

  if (useSharedCharacter && styleDef?.requiresCharacterConsistency) {
    if (options?.uploadedCharacterImageUrl) {
      characterImageUrl = options.uploadedCharacterImageUrl;
      characterImageSource = 'user-uploaded';
      console.log(`[ANIMATED-PIPELINE] Using user-uploaded character image: ${characterImageUrl.substring(0, 100)}…`);
    } else {
      characterDescription = options?.characterDescription
        || deriveCharacterDescriptionFromContext({
          productName: product.title,
          productDescription: product.description ?? undefined,
          avatarStyle: config.avatarStyle,
        });
      try {
        const charResult = await generateUgcCharacter(characterDescription, {
          aspectRatio: '9:16',
          size: '2K',
        });
        characterImageUrl = charResult.imageUrl;
        characterImageSource = 'auto-generated';
      } catch (e: any) {
        // Non-fatal: skip character anchoring, fall back to product-image-as-ref
        // (existing behavior). The animated pipeline already had partial
        // character consistency via storyboard chaining; we just lose the
        // anchored-identity boost.
        errors.push(`Character image generation failed (${e?.code || 'unknown'}: ${e?.message}); animated storyboard will fall back to product-image-as-reference (existing behavior).`);
        console.warn(`[ANIMATED-PIPELINE] Character image generation failed — falling back: ${e?.message}`);
      }
    }
  }

  // Stage 2: storyboard. When characterImageUrl is set, generateStoryboard
  // uses it as the frame-0 reference for character-consistent styles.
  const storyboardFrames = await generateStoryboard({
    scenes: concept.scenes,
    style: config.animationStyle!,
    productImageUrl: product.image_url || undefined,
    productName: product.title,
    aspectRatio: '9:16',
    characterImageUrl,
  });

  if (storyboardFrames.length !== concept.scenes.length) {
    throw new Error(
      `Storyboard frame count (${storyboardFrames.length}) does not match scene count (${concept.scenes.length})`,
    );
  }

  // Stage 3: render each scene with Seedance image-to-video
  const sceneJobs: SceneRenderJob[] = concept.scenes.map((scene, idx) => {
    const frame = storyboardFrames.find(f => f.sceneIndex === scene.sceneIndex);
    if (!frame) {
      throw new Error(`No storyboard frame for scene ${scene.sceneIndex}`);
    }
    return {
      sceneIndex: scene.sceneIndex,
      frameUrl: frame.imageUrl,
      motionPrompt: scene.cameraDirection
        ? `${scene.visualDescription}. Camera: ${scene.cameraDirection}`
        : scene.visualDescription,
      duration: scene.duration,
      voSegment: concept.voSegmentsByScene[idx] || '',
    };
  });

  // Render scenes in parallel — Seedance fal.ai endpoint supports concurrent submissions
  const sceneVideoUrls = await Promise.all(
    sceneJobs.map(job => renderScene(job, concept.styleNotes)),
  );

  const totalDurationSeconds = concept.scenes.reduce((acc, s) => acc + s.duration, 0);

  // Stage 4: stitch scenes into a single mp4. Tied to the DB row's id when caller
  // provides one (route.ts does); otherwise generates a fresh uuid for filename.
  // Uses the shared stitcher (extracted in Step 5A); 'animated' prefix preserves
  // the existing animated_<id>.mp4 filename convention for debugging continuity.
  const stitchId = options?.creativeId || crypto.randomUUID();
  const finalVideoUrl = await stitchScenes(sceneVideoUrls, stitchId, 'animated');

  return {
    concept,
    storyboardFrames,
    sceneVideoUrls,
    finalVideoUrl,
    totalDurationSeconds,
    errors,
    characterImageUrl,
    characterImageSource,
    characterDescription,
  };
}
