'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

type ConceptSource = GeneratorConfig['conceptSource'];

export interface ConceptSourceSelectorProps {
  conceptSource: ConceptSource;
  setGenConfig: SetGenConfig;
}

export function ConceptSourceSelector({ conceptSource, setGenConfig }: ConceptSourceSelectorProps) {
  return (
    <>
      <label className="text-[10px] text-purple-400 uppercase font-bold block">Concept Source</label>
      <div className="grid grid-cols-3 gap-2">
        {([
          { key: 'generate_new' as ConceptSource, label: 'Generate New' },
          { key: 'use_existing' as ConceptSource, label: 'Use Existing' },
          { key: 'recently_tested' as ConceptSource, label: 'Recently Tested' },
        ]).map(opt => (
          <button key={opt.key} onClick={() => setGenConfig(c => ({ ...c, conceptSource: opt.key }))}
            className={`px-3 py-2 rounded-lg border text-center transition-all text-xs font-semibold ${
              conceptSource === opt.key
                ? 'bg-purple-600 border-purple-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>{opt.label}</button>
        ))}
      </div>
    </>
  );
}
