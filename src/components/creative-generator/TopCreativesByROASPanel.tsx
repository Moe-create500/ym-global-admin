'use client';

import type { AccountIntelligence } from '@/components/creative-generator/types';

export interface TopCreativesByROASPanelProps {
  accountIntel: AccountIntelligence | null;
}

export function TopCreativesByROASPanel({ accountIntel }: TopCreativesByROASPanelProps) {
  if (!accountIntel || accountIntel.winners.topCreativesByROAS.length === 0) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-[10px] text-emerald-400 uppercase font-semibold mb-3">Top Creatives by ROAS</h3>
      <div className="space-y-2">
        {accountIntel.winners.topCreativesByROAS.map((c, i) => (
          <div key={i} className="flex items-center gap-3 bg-slate-800/30 rounded-lg p-2">
            <div className="w-10 h-10 rounded bg-slate-800 flex-shrink-0 overflow-hidden">
              {c.thumbnail ? <img src={c.thumbnail} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><span className="text-[10px] text-slate-600">#{i+1}</span></div>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-white truncate">{c.name}</p>
              <div className="flex gap-2 mt-0.5">
                <span className="text-[9px] text-emerald-400 font-semibold">{c.roas}x ROAS</span>
                <span className="text-[9px] text-slate-500">{c.purchases} purch</span>
                <span className="text-[9px] text-slate-600">${(c.spend / 100).toFixed(0)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
