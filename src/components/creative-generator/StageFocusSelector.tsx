// TODO (Phase 3B / data hygiene): the onClick writes both funnelStructure and funnelStage to f.key on every click. funnelStructure is a 4-value enum ('tof' | 'mof' | 'bof' | 'full') while funnelStage is a 3-value enum ('tof' | 'mof' | 'bof'). The dual-write suggests one of these fields is redundant — likely funnelStage, which is fully derivable from funnelStructure when funnelStructure !== 'full'. Reconciliation requires touching the genConfig type, all readers of both fields, and the generate-package backend. Out of scope for pure extraction.
'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface StageFocusSelectorProps {
  funnelStructure: GeneratorConfig['funnelStructure'];
  setGenConfig: SetGenConfig;
}

export function StageFocusSelector({ funnelStructure, setGenConfig }: StageFocusSelectorProps) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">Stage Focus</label>
      <div className="grid grid-cols-3 gap-2">
        {([
          { key: 'tof' as const, label: 'Awareness', desc: 'TOF' },
          { key: 'mof' as const, label: 'Consideration', desc: 'MOF' },
          { key: 'bof' as const, label: 'Conversion', desc: 'BOF' },
        ]).map(f => (
          <button key={f.key} onClick={() => setGenConfig(c => ({ ...c, funnelStructure: f.key, funnelStage: f.key }))}
            className={`px-2 py-2 rounded-lg text-[10px] font-semibold border transition-colors text-center ${
              funnelStructure === f.key ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>{f.label}<br /><span className="text-[8px] font-normal opacity-60">{f.desc}</span></button>
        ))}
      </div>
    </div>
  );
}
