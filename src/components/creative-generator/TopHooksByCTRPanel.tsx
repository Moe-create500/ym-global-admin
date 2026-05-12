'use client';

import type { AccountIntelligence } from '@/components/creative-generator/types';

export interface TopHooksByCTRPanelProps {
  accountIntel: AccountIntelligence | null;
}

export function TopHooksByCTRPanel({ accountIntel }: TopHooksByCTRPanelProps) {
  if (!accountIntel || accountIntel.winners.topHooksByCTR.length === 0) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-[10px] text-blue-400 uppercase font-semibold mb-3">Top Hooks by CTR</h3>
      <div className="space-y-2">
        {accountIntel.winners.topHooksByCTR.map((h, i) => (
          <div key={i} className="bg-slate-800/50 rounded-lg p-2.5">
            <p className="text-xs text-white truncate mb-1">{h.hook}</p>
            <div className="flex gap-3"><span className="text-[10px] text-blue-400 font-semibold">{h.ctr}% CTR</span><span className="text-[10px] text-emerald-400">{h.roas}x</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
