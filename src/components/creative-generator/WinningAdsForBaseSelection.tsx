'use client';

import type { AccountIntelligence, GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface WinningAdsForBaseSelectionProps {
  generationGoal: GeneratorConfig['generationGoal'];
  baseAdId: GeneratorConfig['baseAdId'];
  accountIntel: AccountIntelligence | null;
  setGenConfig: SetGenConfig;
}

export function WinningAdsForBaseSelection({ generationGoal, baseAdId, accountIntel, setGenConfig }: WinningAdsForBaseSelectionProps) {
  const isApplicableGoal = generationGoal === 'use_winner_as_base' || generationGoal === 'generate_variations' || generationGoal === 'refresh_fatigued_ad';
  if (!isApplicableGoal || !accountIntel || accountIntel.winners.topCreativesByROAS.length === 0) return null;
  return (
    <div className="bg-slate-900 border border-amber-900/30 rounded-xl p-4">
      <h3 className="text-[10px] text-amber-400 uppercase font-semibold mb-3">Select Base Ad</h3>
      <div className="space-y-1.5">
        {accountIntel.winners.topCreativesByROAS.map((c, i) => (
          <button key={i} onClick={() => setGenConfig(cfg => ({ ...cfg, baseAdId: c.adId }))}
            className={`w-full text-left flex items-center gap-2 p-2 rounded-lg transition-colors ${
              baseAdId === c.adId ? 'bg-amber-900/20 border border-amber-800/50' : 'bg-slate-800/30 hover:bg-slate-800/50'
            }`}>
            <div className="w-8 h-8 rounded bg-slate-800 flex-shrink-0 overflow-hidden">
              {c.thumbnail ? <img src={c.thumbnail} alt="" className="w-full h-full object-cover" /> : <span className="flex w-full h-full items-center justify-center text-[8px] text-slate-600">#{i+1}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-white truncate">{c.name}</p>
              <span className="text-[9px] text-emerald-400">{c.roas}x ROAS</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
