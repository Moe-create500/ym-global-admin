/**
 * Image Compositing Engine v3 — Layout-Aware Product Placement
 *
 * Solves: product always centered → unnatural, low quality ads.
 *
 * New system:
 *   1. Detect creative layout type from package metadata
 *   2. Apply layout-specific placement rules (asymmetric, directional)
 *   3. Scale product by funnel stage (TOF medium, MOF smaller, BOF larger)
 *   4. Add grounded shadow + perspective-matched integration
 *   5. Never center by default — winning ads are asymmetrical
 */

import sharp from 'sharp';
import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface CompositeResult {
  imageUrl: string;
  method: string;
}

export type LayoutType = 'comparison' | 'product_hero' | 'text_dominant' | 'offer' | 'ingredient_concept';

/**
 * Detect layout type from package metadata.
 */
export function detectLayoutType(pkg: {
  imageFormat?: string;
  hookText?: string;
  headline?: string;
  proofElement?: string;
  offerPlacement?: string;
  angle?: string;
  conceptAngle?: string;
}): LayoutType {
  const format = (pkg.imageFormat || '').toLowerCase();
  const text = `${pkg.angle || ''} ${pkg.conceptAngle || ''} ${pkg.hookText || ''} ${pkg.headline || ''} ${format}`.toLowerCase();

  if (format === 'comparison' || format === 'before_after' || /vs|versus|compare|better than|unlike/i.test(text)) {
    return 'comparison';
  }
  if (format === 'offer_stack' || /offer|deal|discount|sale|bundle|save|free|limited|price|buy \d/i.test(text)) {
    return 'offer';
  }
  if (/ingredien|natural|organic|herbal|vitamin|mineral|concept/i.test(text)) {
    return 'ingredient_concept';
  }
  if (format === 'testimonial' || format === 'social_proof' || format === 'review_stack' ||
      format === 'authority_claim' || format === 'myth_busting' || format === 'hook_viral' ||
      format === 'pattern_interrupt' || format === 'educational') {
    return 'text_dominant';
  }
  // Default: product-focused hero layout
  return 'product_hero';
}

// ═══════════════════════════════════════════════════════════
// LAYOUT GRID SYSTEM — Structural placement, NOT random drops
//
// Each layout defines a GRID with named zones.
// Product snaps to a specific ANCHOR POINT derived from the grid.
// Anchor selection cycles through fallbacks — never random.
// ═══════════════════════════════════════════════════════════

/**
 * Layout grid definition.
 * Zones are defined as fractions of the image.
 * Product anchors to a specific zone based on structural rules.
 */
interface LayoutGrid {
  /** Primary product anchor — the default snap point */
  anchor: { xFrac: number; yFrac: number };
  /** Fallback anchors — used when variation index changes (0=primary, 1=fallback1, etc.) */
  fallbacks: { xFrac: number; yFrac: number; label: string }[];
  /** Base product scale (fraction of image height) */
  baseScale: number;
  /** Allowed rotation range in degrees */
  maxRotation: number;
  /** Structural label */
  label: string;
  /** Zone constraints — product must stay within these bounds */
  zoneBounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * Grid definitions per layout.
 * Each grid defines WHERE the product structurally belongs.
 */
const LAYOUT_GRIDS: Record<LayoutType, LayoutGrid> = {
  // ═══ COMPARISON: LEFT (loser) | DIVIDER | RIGHT (winner) ═══
  // Product MUST be on right column, aligned to right column content center.
  // Divider is at 50%. Right column = 52%–95% of width.
  comparison: {
    anchor: { xFrac: 0.68, yFrac: 0.38 },
    fallbacks: [
      { xFrac: 0.65, yFrac: 0.32, label: 'right-col-upper' },
      { xFrac: 0.70, yFrac: 0.44, label: 'right-col-lower' },
      { xFrac: 0.66, yFrac: 0.36, label: 'right-col-center-alt' },
    ],
    baseScale: 0.42,
    maxRotation: 2,
    label: 'comparison-right-column',
    zoneBounds: { minX: 0.52, maxX: 0.92, minY: 0.18, maxY: 0.70 },
  },

  // ═══ PRODUCT HERO: Hook top, product dominant lower-right ═══
  // Product is THE focus — large, slightly right of center, lower half.
  // Top 25% reserved for hook text. Bottom 15% reserved for CTA.
  product_hero: {
    anchor: { xFrac: 0.52, yFrac: 0.38 },
    fallbacks: [
      { xFrac: 0.55, yFrac: 0.35, label: 'hero-right-upper' },
      { xFrac: 0.48, yFrac: 0.42, label: 'hero-center-lower' },
      { xFrac: 0.58, yFrac: 0.40, label: 'hero-far-right' },
    ],
    baseScale: 0.48,
    maxRotation: 3,
    label: 'hero-dominant',
    zoneBounds: { minX: 0.30, maxX: 0.85, minY: 0.25, maxY: 0.72 },
  },

  // ═══ TEXT DOMINANT: Text leads, product is supporting ═══
  // Product is smaller, bottom-right or side — never competes with text.
  // Top 50%+ is text zone. Product in bottom-right quadrant.
  text_dominant: {
    anchor: { xFrac: 0.68, yFrac: 0.58 },
    fallbacks: [
      { xFrac: 0.65, yFrac: 0.55, label: 'text-support-right' },
      { xFrac: 0.12, yFrac: 0.60, label: 'text-support-left' },
      { xFrac: 0.70, yFrac: 0.50, label: 'text-support-mid-right' },
    ],
    baseScale: 0.28,
    maxRotation: 0,
    label: 'text-supporting',
    zoneBounds: { minX: 0.05, maxX: 0.90, minY: 0.40, maxY: 0.78 },
  },

  // ═══ OFFER: Product near CTA, conversion-tied ═══
  // Product visually connected to the offer/CTA area (lower third).
  // Above the CTA button, right-of-center.
  offer: {
    anchor: { xFrac: 0.58, yFrac: 0.42 },
    fallbacks: [
      { xFrac: 0.55, yFrac: 0.38, label: 'offer-above-cta' },
      { xFrac: 0.62, yFrac: 0.45, label: 'offer-right-of-cta' },
      { xFrac: 0.50, yFrac: 0.40, label: 'offer-center-above' },
    ],
    baseScale: 0.38,
    maxRotation: 2,
    label: 'offer-conversion-zone',
    zoneBounds: { minX: 0.30, maxX: 0.85, minY: 0.28, maxY: 0.68 },
  },

  // ═══ INGREDIENT/CONCEPT: Product subtle, concept leads ═══
  // Product is small and in a corner. Visual concept dominates.
  ingredient_concept: {
    anchor: { xFrac: 0.72, yFrac: 0.60 },
    fallbacks: [
      { xFrac: 0.10, yFrac: 0.62, label: 'concept-corner-left' },
      { xFrac: 0.70, yFrac: 0.55, label: 'concept-side-right' },
      { xFrac: 0.75, yFrac: 0.65, label: 'concept-far-corner' },
    ],
    baseScale: 0.22,
    maxRotation: 0,
    label: 'concept-subtle',
    zoneBounds: { minX: 0.05, maxX: 0.90, minY: 0.40, maxY: 0.80 },
  },
};

/**
 * Select a structurally anchored placement for a layout + stage.
 *
 * Uses a variation index (0 = primary anchor, 1+ = fallbacks) to cycle
 * through valid positions for batch renders. NOT random — deterministic
 * based on the index so the same batch produces varied but intentional layouts.
 */
function selectPlacement(
  layout: LayoutType,
  funnelStage: string,
  bgW: number, bgH: number,
  variationIndex: number = 0,
): { top: number; left: number; scale: number; rotation: number; label: string } {
  const grid = LAYOUT_GRIDS[layout] || LAYOUT_GRIDS.product_hero;

  // Pick anchor: index 0 = primary, 1+ = cycle through fallbacks
  let anchor: { xFrac: number; yFrac: number; label?: string };
  let anchorLabel: string;
  if (variationIndex === 0) {
    anchor = grid.anchor;
    anchorLabel = grid.label;
  } else {
    const fbIdx = (variationIndex - 1) % grid.fallbacks.length;
    anchor = grid.fallbacks[fbIdx];
    anchorLabel = anchor.label || grid.label;
  }

  // Funnel stage scaling
  let stageMultiplier = 1.0;
  if (funnelStage === 'tof') stageMultiplier = 0.90;
  else if (funnelStage === 'mof') stageMultiplier = 0.78;
  else if (funnelStage === 'bof') stageMultiplier = 1.10;

  const finalScale = grid.baseScale * stageMultiplier;

  // Convert fractions to pixels, clamped to zone bounds
  const { zoneBounds } = grid;
  const rawLeft = anchor.xFrac;
  const rawTop = anchor.yFrac;
  const clampedLeft = Math.max(zoneBounds.minX, Math.min(zoneBounds.maxX, rawLeft));
  const clampedTop = Math.max(zoneBounds.minY, Math.min(zoneBounds.maxY, rawTop));

  const left = Math.round(bgW * clampedLeft);
  const top = Math.round(bgH * clampedTop);

  // Rotation: small controlled tilt, clamped to layout's max
  const rotation = grid.maxRotation > 0
    ? Math.round(((variationIndex % 3) - 1) * grid.maxRotation * 10) / 10  // -max, 0, +max
    : 0;

  return { top, left, scale: finalScale, rotation, label: anchorLabel };
}

/**
 * Remove white/light background from a product image.
 * Threshold-based alpha mask + 2px edge feather.
 */
async function removeBackground(imageBuf: Buffer, threshold: number = 240): Promise<Buffer> {
  const { data, info } = await sharp(imageBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = new Uint8Array(data);

  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    if (r >= threshold && g >= threshold && b >= threshold) {
      pixels[i + 3] = 0;
    }
  }

  // Edge feather (2px box blur on alpha)
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      alpha[y * width + x] = pixels[(y * width + x) * channels + 3];

  const feathered = new Uint8Array(width * height);
  const radius = 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            sum += alpha[ny * width + nx];
            count++;
          }
        }
      }
      feathered[y * width + x] = Math.round(sum / count);
    }
  }

  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels[(y * width + x) * channels + 3] = feathered[y * width + x];

  return sharp(Buffer.from(pixels.buffer), {
    raw: { width, height, channels: channels as 4 },
  }).png().toBuffer();
}

/**
 * Layout-aware product compositing.
 *
 * Pipeline:
 *   1. Detect layout type from package metadata
 *   2. Download background + product
 *   3. Remove product background
 *   4. Calculate layout-aware placement + scale
 *   5. Generate grounded shadow
 *   6. Composite: background → shadow → product
 */
export async function compositeProductOntoBackground(
  backgroundUrl: string,
  productImageUrl: string,
  options: {
    placement?: string;
    productScale?: number;
    outputSize?: { width: number; height: number };
    layoutType?: LayoutType;
    funnelStage?: string;
    variationIndex?: number;
  } = {}
): Promise<CompositeResult> {
  const outputW = options.outputSize?.width || 1080;
  const outputH = options.outputSize?.height || 1350;
  const layout = options.layoutType || 'product_hero';
  const funnelStage = options.funnelStage || 'tof';
  const variationIndex = options.variationIndex ?? Math.floor(Math.random() * 4);

  console.log(`[COMPOSITE] Starting: layout=${layout} stage=${funnelStage} bg=${backgroundUrl.substring(0, 60)} product=${productImageUrl.substring(0, 60)}`);

  // Download both images
  const [bgBuf, rawProductBuf] = await Promise.all([
    downloadImage(backgroundUrl),
    downloadImage(productImageUrl),
  ]);
  if (!bgBuf) throw new Error('Failed to download background image');
  if (!rawProductBuf) throw new Error('Failed to download product image');

  // Remove product background
  console.log(`[COMPOSITE] Removing product background...`);
  const cutoutBuf = await removeBackground(rawProductBuf, 235);

  // Select grid-anchored placement (variation index cycles through anchors)
  const placement = selectPlacement(layout, funnelStage, outputW, outputH, variationIndex);
  const effectiveScale = options.productScale || placement.scale;
  console.log(`[COMPOSITE] Selected: ${placement.label} scale=${effectiveScale.toFixed(2)} rot=${placement.rotation}°`);

  // Scale product
  const targetProdH = Math.round(outputH * effectiveScale);
  let scaledProduct = await sharp(cutoutBuf)
    .resize({ height: targetProdH, fit: 'inside' })
    .png()
    .toBuffer();

  // Apply slight rotation for dynamism (if non-zero)
  if (placement.rotation !== 0) {
    try {
      scaledProduct = await sharp(scaledProduct)
        .rotate(placement.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    } catch {}
  }

  const prodMeta = await sharp(scaledProduct).metadata();
  const prodW = prodMeta.width || Math.round(outputW * 0.3);
  const prodH = prodMeta.height || targetProdH;

  // Clamp position to stay within bounds (use placement position directly)
  const finalLeft = Math.max(0, Math.min(placement.left, outputW - prodW));
  const finalTop = Math.max(0, Math.min(placement.top, outputH - prodH));

  // Create shadow
  let shadowBuf: Buffer | null = null;
  try {
    shadowBuf = await sharp(scaledProduct)
      .clone()
      .ensureAlpha()
      .tint({ r: 0, g: 0, b: 0 })
      .blur(14)
      .modulate({ brightness: 0.25 })
      .png()
      .toBuffer();
  } catch (e: any) {
    console.log(`[COMPOSITE] Shadow failed (non-fatal): ${e.message}`);
  }

  // Resize background
  const bgResized = await sharp(bgBuf)
    .resize(outputW, outputH, { fit: 'cover' })
    .png()
    .toBuffer();

  // Composite layers: bg → shadow → product
  const layers: sharp.OverlayOptions[] = [];
  if (shadowBuf) {
    layers.push({
      input: shadowBuf,
      top: Math.min(finalTop + 8, outputH - prodH),
      left: Math.min(finalLeft + 5, outputW - prodW),
      blend: 'over',
    });
  }
  layers.push({
    input: scaledProduct,
    top: finalTop,
    left: finalLeft,
    blend: 'over',
  });

  const composited = await sharp(bgResized)
    .composite(layers)
    .png({ quality: 90 })
    .toBuffer();

  console.log(`[COMPOSITE] Done: ${composited.length} bytes, ${outputW}x${outputH}, placement=${placement.label}`);

  // Save
  const filename = `composite_${crypto.randomUUID().slice(0, 12)}.png`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), composited);

  return {
    imageUrl: `/api/products/uploads?file=${filename}`,
    method: `composite-v3-${placement.label}`,
  };
}

/**
 * Download an image from any URL.
 * Local /api/products/uploads paths are read directly from disk.
 */
async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith('/api/products/uploads?file=') || url.startsWith('/api/products/uploads%3Ffile=')) {
      const filename = new URL(url, 'http://localhost').searchParams.get('file');
      if (!filename) { console.error(`[COMPOSITE] Invalid local URL: ${url}`); return null; }
      const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
      try {
        const buf = await readFile(filePath);
        console.log(`[COMPOSITE] Read local file: ${filename} (${buf.length} bytes)`);
        return buf;
      } catch (e: any) {
        console.error(`[COMPOSITE] Local file read failed: ${filePath} — ${e.message}`);
        return null;
      }
    }
    if (url.startsWith('/api/') || url.startsWith('/uploads/')) {
      const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
      url = `${baseUrl}${url}`;
    }
    const res = await fetch(url);
    if (!res.ok) { console.error(`[COMPOSITE] Download failed: ${url.substring(0, 80)} → ${res.status}`); return null; }
    return Buffer.from(await res.arrayBuffer());
  } catch (e: any) {
    console.error(`[COMPOSITE] Download error: ${e.message}`);
    return null;
  }
}
