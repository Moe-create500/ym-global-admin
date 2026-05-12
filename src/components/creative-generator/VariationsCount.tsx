// TODO (Phase 3B / data hygiene): the onClick writes the same value n to THREE genConfig fields atomically — creativesPerConcept, videosPerConcept, and imagesPerConcept. Only creativesPerConcept is read elsewhere in the UI; videosPerConcept and imagesPerConcept appear to be backend-payload mirrors with no other in-file writers. The three-way redundancy suggests two of these fields should be derived from the canonical creativesPerConcept (or from a content-mix-aware split). Reconciliation requires touching the genConfig type, the generate-package backend payload shape, and any handler that reads these fields. Out of scope for pure extraction.
'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface VariationsCountProps {
  creativesPerConcept: GeneratorConfig['creativesPerConcept'];
  setGenConfig: SetGenConfig;
}

export function VariationsCount({ creativesPerConcept, setGenConfig }: VariationsCountProps) {
  return (
    <div>
      <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Variations / concept</label>
      <div className="flex gap-1.5">
        {[1, 3, 5, 10].map(n => (
          <button key={n} onClick={() => setGenConfig(c => ({ ...c, creativesPerConcept: n, videosPerConcept: n, imagesPerConcept: n }))}
            className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${
              creativesPerConcept === n ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>{n}</button>
        ))}
      </div>
    </div>
  );
}
