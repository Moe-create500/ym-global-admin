// TODO (Phase 3B / data hygiene): the onClick writes BOTH contentMix and contentType. Picking 'image' here flips contentType to 'image', which makes the gate {contentType === 'video'} evaluate false on next render and hides this card. The user clicks "Image Only" once and the card disappears — surprising UX. Reconciliation: either remove the cross-field write (and let the user navigate via ContentTypeSelector) or change the gate semantics. Out of scope for pure extraction.
'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface ContentMixSelectorProps {
  contentMix: GeneratorConfig['contentMix'];
  setGenConfig: SetGenConfig;
}

export function ContentMixSelector({ contentMix, setGenConfig }: ContentMixSelectorProps) {
  return (
    <div>
      <label className="text-[10px] text-purple-400 uppercase font-bold mb-2 block">4. Content Mix</label>
      <div className="grid grid-cols-3 gap-2">
        {([
          { key: 'video' as const, label: 'Video Only' },
          { key: 'image' as const, label: 'Image Only' },
          { key: 'mixed' as const, label: 'Mixed' },
        ]).map(m => (
          <button key={m.key} onClick={() => setGenConfig(c => ({
            ...c, contentMix: m.key, contentType: m.key === 'image' ? 'image' : 'video',
          }))}
            className={`px-2 py-2 rounded-lg text-[10px] font-semibold border transition-colors ${
              contentMix === m.key ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>{m.label}</button>
        ))}
      </div>
    </div>
  );
}
