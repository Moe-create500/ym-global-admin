'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface PlatformSelectorProps {
  platformTarget: GeneratorConfig['platformTarget'];
  setGenConfig: SetGenConfig;
}

export function PlatformSelector({ platformTarget, setGenConfig }: PlatformSelectorProps) {
  return (
    <div>
      <label className="text-[9px] text-slate-500 uppercase mb-1 block">Platform</label>
      <div className="flex gap-1">
        {(['meta', 'tiktok'] as const).map(p => (
          <button key={p} onClick={() => setGenConfig(c => ({ ...c, platformTarget: p }))}
            className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium border ${
              platformTarget === p ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>{p === 'meta' ? 'Meta' : 'TikTok'}</button>
        ))}
      </div>
    </div>
  );
}
