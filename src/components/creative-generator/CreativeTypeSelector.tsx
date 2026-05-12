// TODO (Phase 3B / data hygiene): a constant with this same name is also exported from src/lib/creative-taxonomy.ts but as a different shape (Record<string, ...> vs the array used here). Reconcile during Phase 3B — likely consolidate to a single canonical source of truth in the taxonomy module.
'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

const CREATIVE_TYPES = [
  { key: 'testimonial', label: 'Testimonial', icon: '💬' },
  { key: 'b_roll', label: 'B-Roll', icon: '🎬' },
  { key: 'product_demo', label: 'Product Demo', icon: '📦' },
  { key: 'before_after', label: 'Before / After', icon: '✨' },
  { key: 'problem_solution', label: 'Problem → Solution', icon: '💡' },
  { key: 'founder_story', label: 'Founder Story', icon: '🏗️' },
  { key: 'social_proof', label: 'Social Proof', icon: '⭐' },
  { key: 'lifestyle', label: 'Lifestyle', icon: '🌿' },
  { key: 'hook_viral', label: 'Hook Viral', icon: '🔥' },
  { key: 'educational', label: 'Educational', icon: '🎓' },
  { key: 'podcast_style', label: 'Podcast Style', icon: '🎙️' },
  { key: 'routine', label: 'Routine', icon: '🔄' },
  { key: 'comparison', label: 'Comparison', icon: '⚖️' },
  { key: 'myth_busting', label: 'Myth Busting', icon: '🚫' },
  { key: 'pov_relatable', label: 'POV / Relatable', icon: '👀' },
] as const;

export interface CreativeTypeSelectorProps {
  creativeType: GeneratorConfig['creativeType'];
  setGenConfig: SetGenConfig;
}

export function CreativeTypeSelector({ creativeType, setGenConfig }: CreativeTypeSelectorProps) {
  return (
    <div className="mt-3">
      <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Creative Type</label>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
        {CREATIVE_TYPES.map(ct => (
          <button key={ct.key} onClick={() => setGenConfig(c => ({ ...c, creativeType: ct.key }))}
            className={`px-1.5 py-1.5 rounded text-[9px] font-medium border text-center ${
              creativeType === ct.key ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>{ct.label}</button>
        ))}
      </div>
    </div>
  );
}
