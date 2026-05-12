'use client';

import type { AccountIntelligence } from '@/components/creative-generator/types';

export interface TrendsPanelProps {
  accountIntel: AccountIntelligence | null;
}

export function TrendsPanel({ accountIntel }: TrendsPanelProps) {
  if (!accountIntel) return null;
  const { rising, declining, fatigueSignals, scalingSignals } = accountIntel.trends;
  if (rising.length === 0 && declining.length === 0 && fatigueSignals.length === 0 && scalingSignals.length === 0) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-[10px] text-cyan-400 uppercase font-semibold mb-3">7-Day Trends</h3>
      <div className="space-y-3">
        {rising.length > 0 && (
          <div>
            <p className="text-[9px] text-emerald-500 uppercase mb-1">Rising</p>
            {rising.map((t, i) => (
              <div key={i} className="flex justify-between text-[10px] mb-0.5"><span className="text-slate-300 truncate mr-2">{t.name}</span><span className="text-emerald-400 flex-shrink-0">+{t.change}x ROAS</span></div>
            ))}
          </div>
        )}
        {declining.length > 0 && (
          <div>
            <p className="text-[9px] text-red-500 uppercase mb-1">Declining</p>
            {declining.map((t, i) => (
              <div key={i} className="flex justify-between text-[10px] mb-0.5"><span className="text-slate-400 truncate mr-2">{t.name}</span><span className="text-red-400 flex-shrink-0">{t.change}x ROAS</span></div>
            ))}
          </div>
        )}
        {fatigueSignals.length > 0 && (
          <div>
            <p className="text-[9px] text-yellow-500 uppercase mb-1">Fatigue Signals</p>
            {fatigueSignals.map((t, i) => (
              <div key={i} className="flex justify-between text-[10px] mb-0.5"><span className="text-yellow-400/70 truncate mr-2">{t.name}</span><span className="text-yellow-500 flex-shrink-0">{t.prevRoas}x → {t.recentRoas}x</span></div>
            ))}
          </div>
        )}
        {scalingSignals.length > 0 && (
          <div>
            <p className="text-[9px] text-blue-500 uppercase mb-1">Scaling</p>
            {scalingSignals.map((t, i) => (
              <div key={i} className="flex justify-between text-[10px] mb-0.5"><span className="text-slate-300 truncate mr-2">{t.name}</span><span className="text-blue-400 flex-shrink-0">+{t.spendIncrease}% spend, {t.recentRoas}x</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
