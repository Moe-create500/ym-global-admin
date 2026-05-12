'use client';

import type { AccountIntelligence } from '@/components/creative-generator/types';

export interface LearnedPatternsPanelProps {
  accountIntel: AccountIntelligence | null;
}

export function LearnedPatternsPanel({ accountIntel }: LearnedPatternsPanelProps) {
  if (!accountIntel || !accountIntel.learnedPatterns || accountIntel.learnedPatterns.totalWithPerformance === 0) return null;
  const { learnedPatterns } = accountIntel;
  return (
    <div className="bg-slate-900 border border-cyan-900/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] text-cyan-400 uppercase font-semibold">Learned Patterns</h3>
        <span className="text-[9px] text-slate-600">{learnedPatterns.totalWithPerformance} tracked</span>
      </div>

      {/* What works */}
      {learnedPatterns.whatWorks.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] text-emerald-500 uppercase mb-1.5">What Works</p>
          {learnedPatterns.whatWorks.map((w, i) => (
            <div key={i} className="bg-emerald-900/10 border border-emerald-900/20 rounded-lg p-2 mb-1.5">
              <p className="text-[10px] text-white font-medium truncate">{w.title}</p>
              <p className="text-[9px] text-slate-500 capitalize">{w.pattern.replace(/\|/g, ' + ')}</p>
              <div className="flex gap-2 mt-1">
                <span className="text-[9px] text-emerald-400 font-semibold">{w.roas}x ROAS</span>
                <span className="text-[9px] text-blue-400">{w.ctr}% CTR</span>
                <span className="text-[9px] text-slate-500">${w.cpa} CPA</span>
                <span className="text-[9px] text-slate-500">{w.purchases} purch</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* What doesn't work */}
      {learnedPatterns.whatDoesnt.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] text-red-500 uppercase mb-1.5">What Doesn't Work</p>
          {learnedPatterns.whatDoesnt.map((l, i) => (
            <div key={i} className="bg-red-900/10 border border-red-900/20 rounded-lg p-2 mb-1.5">
              <p className="text-[10px] text-slate-400 truncate">{l.title}</p>
              <p className="text-[9px] text-slate-500 capitalize">{l.pattern.replace(/\|/g, ' + ')}</p>
              <div className="flex gap-2 mt-1">
                <span className="text-[9px] text-red-400">{l.roas}x ROAS</span>
                <span className="text-[9px] text-slate-600">${(l.spendCents / 100).toFixed(0)} wasted</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pattern win rates */}
      {learnedPatterns.patternScores.length > 0 && (
        <div>
          <p className="text-[9px] text-slate-500 uppercase mb-1.5">Pattern Win Rates</p>
          {learnedPatterns.patternScores.map((p, i) => (
            <div key={i} className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-slate-400 capitalize truncate flex-1 mr-2">{p.creativeType} + {p.funnelStage}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-12 bg-slate-800 rounded-full h-1">
                  <div className={`h-1 rounded-full ${p.winRate >= 60 ? 'bg-emerald-500' : p.winRate >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${p.winRate}%` }} />
                </div>
                <span className={`text-[9px] font-semibold ${p.winRate >= 60 ? 'text-emerald-400' : p.winRate >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>{p.winRate}%</span>
                <span className="text-[8px] text-slate-600">{p.wins}W/{p.losses}L</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
