'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface OfferInputProps {
  offer: GeneratorConfig['offer'];
  setGenConfig: SetGenConfig;
}

export function OfferInput({ offer, setGenConfig }: OfferInputProps) {
  return (
    <div>
      <label className="text-[9px] text-slate-500 uppercase mb-1 block">Offer / Bundle</label>
      <input type="text" value={offer} onChange={e => setGenConfig(c => ({ ...c, offer: e.target.value }))}
        placeholder="e.g. Buy 2 Get 1 Free" className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-white" />
    </div>
  );
}
