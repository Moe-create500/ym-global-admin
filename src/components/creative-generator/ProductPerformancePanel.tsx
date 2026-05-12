'use client';

import type { AccountIntelligence } from '@/components/creative-generator/types';

export interface ProductPerformancePanelProps {
  accountIntel: AccountIntelligence | null;
}

export function ProductPerformancePanel({ accountIntel }: ProductPerformancePanelProps) {
  if (!accountIntel || accountIntel.productPerformance.length === 0) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-[10px] text-orange-400 uppercase font-semibold mb-3">Product Performance</h3>
      <div className="space-y-2">
        {accountIntel.productPerformance.map((p, i) => (
          <div key={i} className="flex items-center gap-2 bg-slate-800/30 rounded-lg p-2">
            <div className="w-8 h-8 rounded bg-slate-800 flex-shrink-0 overflow-hidden">
              {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : <span className="flex w-full h-full items-center justify-center text-[8px] text-slate-600">#{i+1}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-white truncate">{p.name}</p>
              <div className="flex gap-2"><span className="text-[9px] text-emerald-400">{p.roas}x</span><span className="text-[9px] text-slate-500">{p.purchases} purch</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
