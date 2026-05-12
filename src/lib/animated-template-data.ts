import type { AnimatedTemplateData, AnimatedSceneRecord } from '@/components/creative-generator/types';

/**
 * Parse a creatives.template_data value into an AnimatedTemplateData shape,
 * or return null if the row predates Stage A persistence (no scenes field).
 *
 * Used by UI consumers (LibraryTab, GeneratedCreativesTab) to decide whether
 * to show the "View Scenes" button on a creative tile.
 *
 * Accepts either a JSON-encoded string (the form sqlite returns through the
 * /api/creatives GET handler) or an already-parsed object (in case a caller
 * has done JSON.parse upstream). Returns null on any failure mode — bad
 * JSON, missing scenes array, empty scenes array, non-object input — so
 * callers can do `if (parsed) { ... }` without further guarding.
 */
export function parseAnimatedTemplateData(
  raw: unknown,
): { templateData: AnimatedTemplateData; scenes: AnimatedSceneRecord[] } | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const td = obj as Partial<AnimatedTemplateData>;
  if (!Array.isArray(td.scenes) || td.scenes.length === 0) return null;
  return {
    templateData: td as AnimatedTemplateData,
    scenes: td.scenes,
  };
}
