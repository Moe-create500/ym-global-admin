// TODO (Phase 3B / data hygiene): the 4 UI modes (Auto Generate / My Angle / From Existing / Clone Ad) are encoded as a (genMode, conceptAngle) tuple over a 3-value genMode union. "Auto Generate" and "My Angle" both write genMode='new'; they're discriminated by conceptAngle being '' (Auto) vs ' ' (My Angle, unkeyed sentinel) vs user text (My Angle, typed). The single-space sentinel ' ' is a hack — it makes the picker's truthiness check at the My Angle button flip while the textarea masks it back to '' for display. Reconciliation: extend the genMode union with a literal 'my_angle' value, or add a separate `angleMode: 'auto' | 'manual'` discriminator field. Out of scope for pure extraction.
'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface GenModeSelectorProps {
  genMode: GeneratorConfig['genMode'];
  conceptAngle: GeneratorConfig['conceptAngle'];
  setGenConfig: SetGenConfig;
}

export function GenModeSelector({ genMode, conceptAngle, setGenConfig }: GenModeSelectorProps) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <button onClick={() => setGenConfig(c => ({ ...c, genMode: 'new' as const, conceptAngle: '' }))}
        className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
          genMode === 'new' && !conceptAngle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
        }`}>Auto Generate</button>
      <button onClick={() => setGenConfig(c => ({ ...c, genMode: 'new' as const, conceptAngle: c.conceptAngle || ' ' }))}
        className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
          genMode === 'new' && conceptAngle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
        }`}>My Angle</button>
      <button onClick={() => setGenConfig(c => ({ ...c, genMode: 'existing' as const }))}
        className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
          genMode === 'existing' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
        }`}>From Existing</button>
      <button onClick={() => setGenConfig(c => ({ ...c, genMode: 'clone_ad' as const, contentType: 'video', contentMix: 'video' }))}
        className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
          genMode === 'clone_ad' ? 'bg-pink-600 border-pink-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
        }`}>Clone Ad<br /><span className="text-[8px] font-normal opacity-70">From reference</span></button>
    </div>
  );
}
