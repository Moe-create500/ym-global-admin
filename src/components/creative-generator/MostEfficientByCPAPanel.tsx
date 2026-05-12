'use client';

import type { AccountIntelligence } from '@/components/creative-generator/types';

export interface MostEfficientByCPAPanelProps {
  accountIntel: AccountIntelligence | null;
}

export function MostEfficientByCPAPanel({ accountIntel }: MostEfficientByCPAPanelProps) {
  if (!accountIntel || accountIntel.winners.mostEfficientByCPA.length === 0) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-[10px] text-amber-400 uppercase font-semibold mb-3">Most Efficient by CPA</h3>
      <div className="space-y-1.5">
        {accountIntel.winners.mostEfficientByCPA.map((a, i) => (
          <div key={i} className="flex justify-between items-center">
            <span className="text-[10px] text-white truncate flex-1 mr-2">{a.name}</span>
            <div className="flex gap-2 flex-shrink-0">
              <span className="text-[10px] text-amber-400 font-semibold">${a.cpa} CPA</span>
              <span className="text-[9px] text-slate-500">{a.purchases} purch</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
