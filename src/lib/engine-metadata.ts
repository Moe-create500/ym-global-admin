// ============================================================================
// ENGINE METADATA — single source of truth for engine UI (Stage 2 of consolidation)
// ============================================================================
//
// All UI consumers (EngineSelector, ContentTypeSelector, label maps in
// PackageCard / page.tsx / RecreateModal / LibraryTab / GeneratedCreativesTab)
// read from ENGINE_METADATA instead of hardcoding engine literals.
//
// Adding/removing/relabeling an engine = edit this one record. No drift.
//
// File lives separately from schemas/CreativeBrief.ts (which uses zod) so this
// file can be a runtime dependency on the production server without dragging
// zod into the bundle. The server's package.json (owned by ym-global-admin)
// doesn't list zod, so any consumer file that transitively imports zod fails
// webpack module resolution at next build time. Stage 2b discovered this the
// hard way; Stage 2c moved metadata here. See commit history for the trail.

/**
 * UI grouping category. Drives the Stage 3 grouped EngineSelector layout
 * and LibraryTab `<optgroup>` dropdown sections. Categorize by user intent,
 * not backend dispatch — `seedance` lives in 'live-action' even though the
 * `animated` pseudo-engine dispatches via seedance under the hood.
 */
export type EngineCategory = 'live-action' | 'animated' | 'custom-motion' | 'image';

export interface EngineMeta {
  /** Stable engine key — must match the corresponding zod enum value where applicable. */
  key: string;
  /** Display label for buttons, badges, label maps. */
  label: string;
  /** Optional compact label for tight UI (e.g., 'Higgs' for higgsfield). */
  shortLabel?: string;
  /** One-line description shown next to the button (e.g., '4-15s + audio'). */
  desc: string;
  /** Whether this engine produces video, image, or both. */
  contentType: 'video' | 'image' | 'both';
  /** UI grouping category for sectioned engine pickers. Required so tsc enforces every entry has one. */
  category: EngineCategory;
  /** Optional duration range in seconds for video engines (min, max). */
  durationRange?: [number, number];
  /** Whether this engine produces audio (TTS / narration) on its output. */
  supportsAudio?: boolean;
  /** Tailwind-friendly color hint for badges and category coloring. */
  uiColor?: string;
  /**
   * UI-only pseudo-engine that maps to another engine at runtime.
   * Pseudo engines are NOT in the zod enums — they're UX conveniences
   * that dispatch a real engine plus extra config.
   *
   * Example: 'animated' is pseudo; it dispatches Seedance + animation style.
   */
  pseudo?: boolean;
  /** When pseudo, which real engine is dispatched. */
  dispatchedAs?: string;
  /**
   * When true, engine is excluded from UI surfaces (EngineSelector, LibraryTab)
   * but remains in ENGINE_METADATA for backend dispatch and API validation.
   */
  hidden?: boolean;
  /**
   * When true, this engine uses a scene-decomposed pipeline (concept gen ->
   * N per-scene renders -> stitch). Drives the Storyboard Scenes slider's
   * visibility in GeneratorForm, the per-scene metadata persistence path,
   * and the scene-count plumbing into the LLM concept generator. Engines
   * without this flag do single-shot rendering and don't use the slider.
   */
  sceneBased?: boolean;
  /**
   * When true, this engine accepts a product/brand reference image for
   * image-to-image generation (vs text-only). Affects UI hints around
   * "upload a reference image" affordances and prompt-engineering decisions
   * downstream. Optional — engines without this flag are text-only.
   */
  supportsReferenceImage?: boolean;
}

export const ENGINE_METADATA: Record<string, EngineMeta> = {
  // ---- Video engines ----
  'seedance-scenes': {
    key: 'seedance-scenes',
    label: 'Live Action (Scene-based)',
    desc: 'Multi-scene UGC, full per-scene metadata',
    contentType: 'video',
    category: 'live-action',
    durationRange: [4, 60],
    supportsAudio: true,
    uiColor: 'emerald',
    pseudo: true,
    dispatchedAs: 'seedance',
    sceneBased: true,
  },
  seedance: {
    key: 'seedance',
    label: 'Live Action (Seedance)',
    desc: '4-15s + audio',
    contentType: 'video',
    category: 'live-action',
    durationRange: [4, 15],
    supportsAudio: true,
    uiColor: 'emerald',
  },
  sora: {
    key: 'sora',
    label: 'Sora',
    desc: '8-20s, no 9/10s',
    contentType: 'video',
    category: 'live-action',
    durationRange: [8, 20],
    supportsAudio: true,
    uiColor: 'indigo',
    hidden: true,
  },
  veo: {
    key: 'veo',
    label: 'Veo',
    desc: '4-8s',
    contentType: 'video',
    category: 'live-action',
    durationRange: [4, 8],
    supportsAudio: true,
    uiColor: 'cyan',
    hidden: true,
  },
  minimax: {
    key: 'minimax',
    label: 'Hailuo',
    shortLabel: 'Hailuo',
    desc: '5-6s',
    contentType: 'video',
    category: 'live-action',
    durationRange: [5, 6],
    supportsAudio: false,
    uiColor: 'orange',
    hidden: true,
  },
  higgsfield: {
    key: 'higgsfield',
    label: 'Higgsfield',
    shortLabel: 'Higgs',
    desc: 'Custom motion',
    contentType: 'video',
    category: 'custom-motion',
    supportsAudio: false,
    uiColor: 'violet',
    hidden: true,
  },
  animated: {
    key: 'animated',
    label: 'Scene Match (Seedance)',
    desc: 'Claymation / pixar / scientific, multi-scene matched',
    contentType: 'video',
    category: 'animated',
    durationRange: [12, 60],
    supportsAudio: true,
    uiColor: 'pink',
    pseudo: true,
    dispatchedAs: 'seedance',
    sceneBased: true,
  },

  // ---- Image engines ----
  'nano-banana': {
    key: 'nano-banana',
    label: 'Nano Banana',
    desc: 'Best for product scenes, text rendering',
    contentType: 'image',
    category: 'image',
    uiColor: 'yellow',
  },
  ideogram: {
    key: 'ideogram',
    label: 'Ideogram',
    desc: 'Text-heavy image generation',
    contentType: 'image',
    category: 'image',
    uiColor: 'rose',
  },
  dalle: {
    // Engine key 'dalle' preserved for DB backwards-compat with existing rows.
    // Label renamed away from "GPT Image" once a real gpt-image-2 engine
    // landed alongside (the dalle path is actually gpt-image-1 with reference
    // + dall-e-3 text-only fallback; "DALL-E 3" is the dominant text-only
    // surface users hit).
    key: 'dalle',
    label: 'DALL-E 3',
    desc: 'OpenAI image generation',
    contentType: 'image',
    category: 'image',
    uiColor: 'blue',
    supportsReferenceImage: true,
  },
  'gpt-image': {
    key: 'gpt-image',
    label: 'GPT Image 2',
    desc: 'OpenAI gpt-image-2, native multimodal with reasoning',
    contentType: 'image',
    category: 'image',
    uiColor: 'blue',
    hidden: false,
    supportsReferenceImage: true,
  },
  'gemini-image': {
    key: 'gemini-image',
    label: 'Gemini',
    desc: 'Google image generation',
    contentType: 'image',
    category: 'image',
    uiColor: 'sky',
  },
  stability: {
    key: 'stability',
    label: 'Stability AI',
    desc: 'SD-based image generation',
    contentType: 'image',
    category: 'image',
    uiColor: 'slate',
  },
  auto: {
    key: 'auto',
    label: 'Auto',
    desc: 'Provider router decides',
    contentType: 'image',
    category: 'image',
    uiColor: 'gray',
    pseudo: true,
  },
};

/** Helper: list engines for a given content type, optionally including pseudo or hidden engines. */
export function enginesByContentType(
  contentType: 'video' | 'image',
  opts: { includePseudo?: boolean; includeHidden?: boolean } = {},
): EngineMeta[] {
  const { includePseudo = true, includeHidden = false } = opts;
  return Object.values(ENGINE_METADATA).filter((e) => {
    if (e.contentType !== contentType && e.contentType !== 'both') return false;
    if (!includePseudo && e.pseudo) return false;
    if (!includeHidden && e.hidden) return false;
    return true;
  });
}

/** Helper: get the label for an engine key, or fall back to the key if unknown. */
export function engineLabel(key: string): string {
  return ENGINE_METADATA[key]?.label ?? key;
}

/** Helper: derived TS type union of all engine keys (real + pseudo). */
export type EngineKey = keyof typeof ENGINE_METADATA;

// ============================================================================
// CATEGORY GROUPING (Stage 3)
// ============================================================================

/** Display order for categories — used by EngineSelector + LibraryTab to render section order. */
export const CATEGORY_ORDER: readonly EngineCategory[] = [
  'live-action',
  'animated',
  'custom-motion',
  'image',
] as const;

/** Display labels for category section headers and `<optgroup>` labels. */
export const CATEGORY_LABELS: Record<EngineCategory, string> = {
  'live-action': 'Live Action',
  'animated': 'Animated',
  'custom-motion': 'Custom Motion',
  'image': 'Image',
};

/** Shape returned by groupEnginesByCategory for each rendered group. */
export interface EngineCategoryGroup {
  category: EngineCategory;
  label: string;
  engines: EngineMeta[];
}

/**
 * Returns ordered, non-empty engine groups for the given content type.
 * Each group has a category key, display label, and the matching engines.
 * Empty groups (no engines after filter) are dropped so consumers can blindly
 * map without rendering empty sections.
 */
export function groupEnginesByCategory(
  contentType: 'video' | 'image',
  opts: { includePseudo?: boolean } = {},
): EngineCategoryGroup[] {
  const filtered = enginesByContentType(contentType, opts);
  return CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      engines: filtered.filter((e) => e.category === cat),
    }))
    .filter((g) => g.engines.length > 0);
}
