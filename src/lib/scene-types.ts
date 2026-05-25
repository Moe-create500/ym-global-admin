/**
 * Unified ad-type taxonomy for the scene-based video pipeline.
 *
 * `AdType` is the *only* dispatcher into the unified pipeline. Engine-specific
 * dispatch (Veo/MiniMax/Higgsfield/Sora) is gone — every scene-based render
 * goes through Seedance R2V + ffmpeg stitch regardless of ad type. What
 * differs per ad type lives entirely in the prompt-generation layer
 * (scene-prompt-builder.ts), not the pipeline.
 *
 *   - 'ugc'      — talking avatar holding/using product. Pattern 1 character
 *                  continuity. Spoken script per scene.
 *   - 'animated' — cartoon / illustrated / claymation / pixar / scientific
 *                  explainer. Style descriptor prepended at prompt-build time.
 *                  Character image only when the style needs continuity
 *                  (claymation, pixar_3d). Voiceover per scene.
 *   - 'b_roll'   — product close-ups, hands using product, environmental
 *                  shots. No avatar. No dialogue.
 *   - 'scene'    — generic scene-based with no forced avatar or style.
 *                  Whatever the script describes.
 */
export type AdType = 'ugc' | 'animated' | 'b_roll' | 'scene';

/**
 * Per-scene record produced by the prompt builder, consumed by the renderer.
 *
 * Fields are required vs optional based on which ad types populate them:
 *
 *   - sceneIndex, visualPrompt, duration, productVisible — REQUIRED.
 *     productVisible is the dispatch signal for R2V (with product reference)
 *     vs T2V (text-only) at the renderScene level, independent of ad type.
 *
 *   - spokenScript — optional. UGC and animated UGC populate; b_roll omits.
 *     renderScene appends to the Seedance prompt only when present.
 *
 *   - productInHand, productNearFace — optional. UGC-specific placement
 *     hints used by renderScene to enrich the Seedance prompt with "Person
 *     is holding the product" / "Product is near their face". Absent for
 *     non-UGC ad types; renderScene's gating handles their absence.
 *
 *   - cameraDirection — optional. Animated styles use this for camera-move
 *     hints (e.g., "slow zoom in"). UGC/b_roll typically omit.
 *
 * Re-exported from seedance-pipeline.ts to preserve the existing import
 * surface; downstream callers can `import { Scene } from '@/lib/scene-types'`
 * or keep their existing seedance-pipeline imports.
 */
export type { Scene } from '@/lib/seedance-pipeline';
