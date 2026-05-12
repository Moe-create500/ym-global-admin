'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface ConceptsCountProps {
  quantity: GeneratorConfig['quantity'];
  setGenConfig: SetGenConfig;
}

export function ConceptsCount({ quantity, setGenConfig }: ConceptsCountProps) {
  return (
    <div>
      <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Concepts</label>
      <div className="flex gap-1.5">
        {[1, 3, 5, 10].map(n => (
          <button key={n} onClick={() => setGenConfig(c => ({ ...c, quantity: n }))}
            className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${
              quantity === n ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>{n}</button>
        ))}
      </div>
    </div>
  );
}
