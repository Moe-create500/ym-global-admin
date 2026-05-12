'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface AspectRatioSelectorProps {
  dimension: GeneratorConfig['dimension'];
  setGenConfig: SetGenConfig;
}

export function AspectRatioSelector({ dimension, setGenConfig }: AspectRatioSelectorProps) {
  return (
    <div>
      <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Aspect Ratio</label>
      <div className="flex gap-1">
        {(['4:5', '1:1', '9:16', '16:9'] as const).map(d => (
          <button key={d} onClick={() => setGenConfig(c => ({ ...c, dimension: d }))}
            className={`flex-1 px-2 py-1.5 rounded text-[10px] font-semibold border ${
              dimension === d ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}>{d}</button>
        ))}
      </div>
    </div>
  );
}
