'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface OutputStrategySelectorProps {
  funnelStructure: GeneratorConfig['funnelStructure'];
  setGenConfig: SetGenConfig;
}

export function OutputStrategySelector({ funnelStructure, setGenConfig }: OutputStrategySelectorProps) {
  return (
    <div>
      <label className="text-[10px] text-purple-400 uppercase font-bold mb-2 block">3. Output Strategy</label>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setGenConfig(c => ({ ...c, funnelStructure: c.funnelStructure === 'full' ? 'tof' : c.funnelStructure, genMode: c.genMode === 'full_funnel' ? 'new' : c.genMode }))}
          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
            funnelStructure !== 'full' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
          }`}>Single Stage</button>
        <button onClick={() => setGenConfig(c => ({ ...c, funnelStructure: 'full', genMode: c.genMode === 'existing' ? c.genMode : 'new', contentMix: c.contentMix === 'video' || c.contentMix === 'image' ? c.contentMix : 'mixed' }))}
          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
            funnelStructure === 'full' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
          }`}>Full Funnel Pack</button>
      </div>
    </div>
  );
}
