'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface VideoDurationSelectorProps {
  videoDuration: GeneratorConfig['videoDuration'];
  setGenConfig: SetGenConfig;
}

export function VideoDurationSelector({ videoDuration, setGenConfig }: VideoDurationSelectorProps) {
  return (
    <div>
      <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Video Duration</label>
      <div className="flex gap-1">
        {([8, 10, 15, 20] as const).map(d => (
          <button key={d} onClick={() => setGenConfig(c => ({ ...c, videoDuration: d }))}
            className={`flex-1 px-2 py-1.5 rounded text-[10px] font-semibold border ${
              videoDuration === d ? 'bg-yellow-600 border-yellow-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}>{d}s</button>
        ))}
      </div>
    </div>
  );
}
