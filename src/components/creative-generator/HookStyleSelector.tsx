// TODO (Phase 3B / data hygiene): a constant with this same name is also exported from src/lib/creative-taxonomy.ts but as a different shape (Record<string, ...> vs the array used here). Reconcile during Phase 3B — likely consolidate to a single canonical source of truth in the taxonomy module.
'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

const HOOK_STYLES = [
  { key: 'pattern_interrupt', label: 'Pattern Interrupt' },
  { key: 'curiosity', label: 'Curiosity' },
  { key: 'emotional', label: 'Emotional' },
  { key: 'authority', label: 'Authority' },
  { key: 'relatable', label: 'Relatable' },
] as const;

export interface HookStyleSelectorProps {
  hookStyle: GeneratorConfig['hookStyle'];
  setGenConfig: SetGenConfig;
}

export function HookStyleSelector({ hookStyle, setGenConfig }: HookStyleSelectorProps) {
  return (
    <div>
      <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Hook Style</label>
      <div className="flex flex-wrap gap-1">
        {HOOK_STYLES.map(h => (
          <button key={h.key} onClick={() => setGenConfig(c => ({ ...c, hookStyle: h.key }))}
            className={`px-2 py-1 rounded text-[9px] font-medium border ${
              hookStyle === h.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>{h.label}</button>
        ))}
      </div>
    </div>
  );
}
