'use client';

import type { AccountIntelligence } from '@/components/creative-generator/types';

export interface TopConvertersByCVRPanelProps {
  accountIntel: AccountIntelligence | null;
}

export function TopConvertersByCVRPanel({ accountIntel }: TopConvertersByCVRPanelProps) {
  if (!accountIntel || accountIntel.winners.topConvertersByCVR.length === 0) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-[10px] text-purple-400 uppercase font-semibold mb-3">Top Converters by CVR</h3>
      <div className="space-y-1.5">
        {accountIntel.winners.topConvertersByCVR.map((a, i) => (
          <div key={i} className="flex justify-between items-center">
            <span className="text-[10px] text-white truncate flex-1 mr-2">{a.name}</span>
            <div className="flex gap-2 flex-shrink-0">
              <span className="text-[10px] text-purple-400 font-semibold">{a.cvr}% CVR</span>
              <span className="text-[9px] text-emerald-400">{a.roas}x</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
