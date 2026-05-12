'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';
import { groupEnginesByCategory } from '@/lib/engine-metadata';

/**
 * Image-engine UI allowlist — mirrors the UNLOCKED_ENGINES allowlist in
 * src/app/api/creatives/render-image/route.ts (line ~225).
 *
 * The original Nano-Banana-only lockdown was added 2026-05-08 per product
 * decision. The 'gpt-image' entry was added 2026-05-11 alongside the
 * gpt-image-2 integration. Other image engines (ideogram, dalle,
 * gemini-image, stability) remain excluded from the EngineSelector; the
 * PackageCard's per-engine button row exposes them via the render-image
 * route instead (where they're still locked to nano-banana server-side).
 *
 * Add an engine key here AND in render-image/route.ts:UNLOCKED_ENGINES
 * when product decides to re-enable another image engine end-to-end.
 */
export const UNLOCKED_IMAGE_ENGINES = new Set(['nano-banana', 'gpt-image']);

export interface EngineSelectorProps {
  engine: GeneratorConfig['engine'];
  contentType: GeneratorConfig['contentType'];
  setGenConfig: SetGenConfig;
}

export function EngineSelector({ engine, contentType, setGenConfig }: EngineSelectorProps) {
  // Engine groups derived from ENGINE_METADATA (single source of truth).
  // Image group is post-filtered through UNLOCKED_IMAGE_ENGINES (above) so
  // engines that are present in ENGINE_METADATA but not yet user-selectable
  // (dalle, gemini-image, stability, ideogram) don't render here.
  const videoGroups = groupEnginesByCategory('video', { includePseudo: true });
  const imageGroups = groupEnginesByCategory('image', { includePseudo: false })
    .map(g => ({ ...g, engines: g.engines.filter(e => UNLOCKED_IMAGE_ENGINES.has(e.key)) }))
    .filter(g => g.engines.length > 0);
  const groups = contentType === 'video' ? videoGroups : imageGroups;
  const activeColor = contentType === 'video'
    ? 'bg-emerald-600 border-emerald-500 text-white'
    : 'bg-orange-600 border-orange-500 text-white';
  return (
    <div>
      <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Engine</label>
      {groups.map((group) => (
        <div key={group.category} className="mb-3 last:mb-0">
          {group.engines.length > 1 && (
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5 px-1">
              {group.label}
            </div>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            {group.engines.map((e) => (
              <button key={e.key} onClick={() => setGenConfig(c => ({ ...c, engine: e.key }))}
                className={`px-2 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
                  engine === e.key ? activeColor : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}>
                {e.label}<br /><span className="text-[8px] font-normal opacity-70">{e.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
