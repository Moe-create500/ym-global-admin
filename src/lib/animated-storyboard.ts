import { generateImage, editImage } from '@/lib/nano-banana-image';
import { STYLE_DEFINITIONS } from '@/lib/animation-styles';
import type { AnimationStyle } from '@/components/creative-generator/types';

/**
 * One scene in the storyboard. Comes from the concept generator (Round 5).
 */
export interface StoryboardScene {
  sceneIndex: number;          // 0-based
  duration: number;            // seconds, e.g. 4
  visualDescription: string;   // what to show, e.g. "Cracked dry lips close-up, problem state"
  cameraDirection?: string;    // "slow zoom in", "static wide", etc.
}

/**
 * Result for a single rendered storyboard frame.
 */
export interface StoryboardFrame {
  sceneIndex: number;
  imageUrl: string;
  model: string;
  width?: number;
  height?: number;
}

/**
 * Options for storyboard generation.
 */
export interface GenerateStoryboardOptions {
  scenes: StoryboardScene[];
  style: AnimationStyle;
  /** Product reference image URL (Shopify CDN, /api/products/uploads, etc.) */
  productImageUrl?: string;
  /** Product name for prompt (e.g. "Marroomi Beef Tallow Lip Balm") */
  productName?: string;
  /** Aspect ratio: '9:16' | '4:5' | '1:1' | '16:9' (default '9:16') */
  aspectRatio?: '9:16' | '4:5' | '1:1' | '16:9';
  /**
   * Pattern 1: shared character image URL. When set AND the style requires
   * character consistency, the first storyboard frame is generated with this
   * character image as a Nano Banana edit reference (instead of the product
   * image). Subsequent frames continue to use the prior frame as reference
   * (existing sequential character-lock chain). Result: the character in
   * every storyboard frame anchors to the same upstream identity.
   *
   * For non-character-consistent styles (3d_motion_graphics,
   * scientific_explainer), this is ignored — those styles don't have humans.
   */
  characterImageUrl?: string;
}

/**
 * Builds the prompt for a single storyboard frame.
 *
 * Kept under ~400 chars to stay well within Nano Banana Pro's prompt cap —
 * fal.ai returned 422 invalid_request on every frame when prompts were ~600+
 * chars (full visualStyleGuide + scene + verbose product instruction + framing).
 *
 * Drops:
 *   - The verbose product instruction — the product is already passed as a
 *     reference image to editImage(), so we don't need to describe packaging
 *     in text. Naming the product is enough.
 *   - cameraDirection — belongs in the Seedance motion prompt, not the
 *     storyboard frame (which is a still).
 *   - The full visualStyleGuide — first sentence captures the look; later
 *     sentences add stylistic notes that compete with the scene description.
 */
function buildFramePrompt(
  scene: StoryboardScene,
  style: AnimationStyle,
  productName?: string,
): string {
  const styleDef = STYLE_DEFINITIONS[style];
  const styleShort = styleDef.visualStyleGuide.split('.')[0] + '.';
  const scenePart = scene.visualDescription.trim();
  const productPart = productName ? ` Product: ${productName}.` : '';
  return `${styleShort} ${scenePart}${productPart} Single still frame, no text or captions.`;
}

/**
 * Resolves a product image URL into a form fal.ai can fetch.
 *  - https:// / http:// — HEAD-validated, returned as-is on success, null on failure
 *  - /api/products/uploads?file=<name> or /api/* — read from local disk, returned as
 *    base64 data: URL (fal.ai's servers cannot fetch our relative paths)
 *  - Anything else — null; caller falls through to text-to-image
 *
 * Mirrors the seedance pattern in route.ts:455-490 (same path join, same mime detection,
 * same error handling). Without this, fal.ai's nano-banana-pro/edit returned 422 on
 * every storyboard frame because image_urls contained an unfetchable relative path.
 */
async function resolveImageForFal(rawUrl: string): Promise<string | null> {
  if (rawUrl.startsWith('https://') || rawUrl.startsWith('http://')) {
    try {
      const headRes = await fetch(rawUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      if (headRes.ok) {
        console.log(`[STORYBOARD] Product image validated (HTTP ${headRes.status}): ${rawUrl.substring(0, 80)}...`);
        return rawUrl;
      }
      console.error(`[STORYBOARD] Product image URL returned HTTP ${headRes.status}: ${rawUrl.substring(0, 80)}`);
    } catch (fetchErr: any) {
      console.error(`[STORYBOARD] Product image URL unreachable: ${fetchErr.message}`);
    }
    return null;
  }
  if (rawUrl.startsWith('/api/products/uploads?file=') || rawUrl.startsWith('/api/')) {
    try {
      const { readFile: rf } = await import('fs/promises');
      const pathMod = await import('path');
      const filename = new URL(rawUrl, 'http://localhost').searchParams.get('file');
      if (filename) {
        const filePath = pathMod.join(process.cwd(), 'public', 'uploads', filename);
        const buf = await rf(filePath);
        const ext = filename.split('.').pop()?.toLowerCase() || 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
        console.log(`[STORYBOARD] Product image loaded from disk: ${filename} (${buf.length} bytes)`);
        return `data:${mime};base64,${buf.toString('base64')}`;
      }
    } catch (e: any) {
      console.error(`[STORYBOARD] Local file resolve failed: ${e.message}`);
    }
    return null;
  }
  return null;
}

/**
 * Generates a sequence of storyboard frames for an animated ad.
 *
 * Strategy:
 * - For styles requiring character consistency (claymation, pixar_3d):
 *   Generate frame 0 with text-to-image. Generate frames 1+ using image-edit
 *   with frame 0 as reference, so character/style locks across frames.
 * - For non-character styles (3d_motion_graphics, scientific_explainer):
 *   Generate all frames in parallel with text-to-image — visual continuity
 *   matters less when there's no character identity to preserve, and
 *   the product reference image provides product consistency.
 */
export async function generateStoryboard(
  opts: GenerateStoryboardOptions,
): Promise<StoryboardFrame[]> {
  const { scenes, style, productImageUrl, productName, aspectRatio = '9:16', characterImageUrl } = opts;
  const styleDef = STYLE_DEFINITIONS[style];

  if (scenes.length === 0) {
    throw new Error('generateStoryboard: no scenes provided');
  }

  // Resolve productImageUrl ONCE at the top so parallel mode doesn't re-read the
  // same file per frame. Subsequent reference URLs in sequential mode come from
  // fal.ai's CDN (https://fal.media/...) which is publicly fetchable — no
  // re-resolution needed inside the loop.
  const resolvedProductImageUrl: string | undefined = productImageUrl
    ? (await resolveImageForFal(productImageUrl)) ?? undefined
    : undefined;

  // Pattern 1: resolve characterImageUrl the same way (https HEAD-validated,
  // local /api/* paths read into base64). Character image takes precedence
  // over product image as the frame-0 reference when the style needs character
  // consistency — that's the whole point of Pattern 1.
  const resolvedCharacterImageUrl: string | undefined = characterImageUrl
    ? (await resolveImageForFal(characterImageUrl)) ?? undefined
    : undefined;

  if (styleDef.requiresCharacterConsistency) {
    // Sequential: frame 0 establishes character, subsequent frames use it as reference.
    // Pattern 1: if a shared characterImageUrl is provided, use IT as frame-0
    // reference (anchors all frames to the user-supplied / auto-generated
    // character identity). Falls back to product image when no character ref
    // is available — preserves existing behavior.
    const frames: StoryboardFrame[] = [];
    let referenceFrameUrl: string | undefined = resolvedCharacterImageUrl || resolvedProductImageUrl;

    for (const scene of scenes) {
      const prompt = buildFramePrompt(scene, style, productName);
      let result;

      if (referenceFrameUrl) {
        // Use prior frame (or character/product image for first frame) as reference
        result = await editImage(prompt, [referenceFrameUrl], { aspectRatio });
      } else {
        // First frame, no reference available
        result = await generateImage(prompt, { aspectRatio });
      }

      frames.push({
        sceneIndex: scene.sceneIndex,
        imageUrl: result.imageUrl,
        model: result.model,
        width: result.width,
        height: result.height,
      });

      // Lock subsequent frames to this one for character continuity
      referenceFrameUrl = result.imageUrl;
    }

    return frames;
  } else {
    // Parallel: each frame is independent, just style + scene + product
    const promises = scenes.map(async (scene): Promise<StoryboardFrame> => {
      const prompt = buildFramePrompt(scene, style, productName);
      let result;

      if (resolvedProductImageUrl) {
        // Use product image to lock product appearance even though no character
        result = await editImage(prompt, [resolvedProductImageUrl], { aspectRatio });
      } else {
        result = await generateImage(prompt, { aspectRatio });
      }

      return {
        sceneIndex: scene.sceneIndex,
        imageUrl: result.imageUrl,
        model: result.model,
        width: result.width,
        height: result.height,
      };
    });

    return Promise.all(promises);
  }
}
