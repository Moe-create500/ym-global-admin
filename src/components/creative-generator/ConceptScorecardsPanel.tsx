'use client';

import type { AccountIntelligence } from '@/components/creative-generator/types';

export interface ConceptScorecardsPanelProps {
  accountIntel: AccountIntelligence | null;
  onConceptAction: (concept: any, action: string) => void;
}

export function ConceptScorecardsPanel({ accountIntel, onConceptAction }: ConceptScorecardsPanelProps) {
  if (!accountIntel || !((accountIntel as any).conceptScores?.length > 0)) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-[10px] text-purple-400 uppercase font-semibold mb-3">Concept Intelligence</h3>
      <div className="space-y-2">
        {(accountIntel as any).conceptScores.slice(0, 8).map((c: any, i: number) => (
          <div key={i} className={`rounded-lg p-2 border ${
            c.action === 'scale' ? 'bg-emerald-950/20 border-emerald-800/30' :
            c.action === 'pause' ? 'bg-red-950/20 border-red-800/30' :
            c.action === 'refresh' ? 'bg-amber-950/20 border-amber-800/30' :
            'bg-slate-800/30 border-slate-700/30'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-white font-medium truncate flex-1">{c.conceptName}</p>
              <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-semibold ${
                c.action === 'scale' ? 'bg-emerald-500/20 text-emerald-400' :
                c.action === 'pause' ? 'bg-red-500/20 text-red-400' :
                c.action === 'refresh' ? 'bg-amber-500/20 text-amber-400' :
                c.action === 'generate_more' ? 'bg-purple-500/20 text-purple-400' :
                'bg-blue-500/20 text-blue-400'
              }`}>{c.action === 'scale' ? 'SCALE' : c.action === 'pause' ? 'PAUSE' : c.action === 'refresh' ? 'REFRESH' : c.action === 'generate_more' ? 'MORE' : c.action === 'add_bof' ? '+BOF' : '+TOF'}</span>
            </div>
            <div className="flex gap-2 text-[9px]">
              <span className="text-emerald-400">{c.roas}x</span>
              <span className="text-slate-500">{c.purchases}p</span>
              <span className="text-slate-500">${(c.spendCents / 100).toFixed(0)}</span>
              <span className="text-slate-500">{c.adCount} ads</span>
              {c.isFatigued && <span className="text-amber-400">fatiguing</span>}
              {c.isRising && <span className="text-emerald-400">rising</span>}
            </div>
            {/* Action buttons */}
            <div className="flex gap-1 mt-1.5">
              {c.action !== 'pause' && (
                <button onClick={() => onConceptAction(c, c.action)}
                  className={`px-1.5 py-0.5 rounded text-[8px] font-semibold ${
                    c.action === 'scale' ? 'bg-emerald-600 text-white' :
                    c.action === 'refresh' ? 'bg-amber-600 text-white' :
                    'bg-blue-600 text-white'
                  }`}>
                  {c.action === 'scale' ? 'Scale' : c.action === 'refresh' ? 'Refresh' : c.action === 'generate_more' ? 'More' : c.action === 'add_bof' ? '+BOF' : '+TOF'}
                </button>
              )}
              {c.action !== 'add_tof' && c.action !== 'pause' && (
                <button onClick={() => onConceptAction(c, 'add_tof')}
                  className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-slate-700 text-slate-300 hover:bg-slate-600">+TOF</button>
              )}
              {c.action !== 'add_bof' && c.action !== 'pause' && (
                <button onClick={() => onConceptAction(c, 'add_bof')}
                  className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-slate-700 text-slate-300 hover:bg-slate-600">+BOF</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
