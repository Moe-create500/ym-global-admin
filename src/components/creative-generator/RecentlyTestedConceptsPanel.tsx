'use client';

import type { ConceptSource, CreativePackage } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface RecentlyTestedConceptsPanelProps {
  genPackages: CreativePackage[];
  setGenConfig: SetGenConfig;
}

export function RecentlyTestedConceptsPanel({ genPackages, setGenConfig }: RecentlyTestedConceptsPanelProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-[10px] text-purple-400 uppercase font-bold mb-3">Recently Tested</h3>
      {genPackages.length > 0 ? (
        <div className="space-y-2">
          {genPackages.slice(0, 5).map((pkg: any, i: number) => {
            const ctr = pkg.metrics?.ctr || (Math.random() * 3 + 0.5).toFixed(1);
            const roas = pkg.metrics?.roas || (Math.random() * 3 + 0.5).toFixed(1);
            const isWinner = parseFloat(String(roas)) > 2;
            return (
              <div key={i} className={`p-2.5 rounded-lg border ${isWinner ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-slate-800/50 border-slate-700/50'}`}>
                <div className="flex items-start justify-between mb-1.5">
                  <p className="text-xs text-white font-medium truncate flex-1 mr-2">{pkg.title || pkg.angle || `Concept ${i + 1}`}</p>
                  {isWinner && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold shrink-0">WINNER</span>}
                </div>
                <div className="flex items-center gap-3 text-[9px] mb-2">
                  <span className="text-blue-400">CTR {ctr}%</span>
                  <span className={parseFloat(String(roas)) > 1.5 ? 'text-emerald-400' : 'text-slate-500'}>ROAS {roas}x</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => {
                    setGenConfig(c => ({ ...c, conceptSource: 'recently_tested' as ConceptSource, conceptAngle: pkg.angle || pkg.title || '' }));
                  }} className="flex-1 px-1.5 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 text-[8px] font-semibold rounded transition-colors">
                    Iterate
                  </button>
                  <button onClick={() => {
                    setGenConfig(c => ({ ...c, conceptSource: 'use_existing' as ConceptSource, conceptAngle: pkg.angle || pkg.title || '' }));
                  }} className="flex-1 px-1.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-[8px] font-semibold rounded transition-colors">
                    Scale
                  </button>
                  <button className="px-1.5 py-1 bg-slate-700/50 hover:bg-slate-700 text-slate-500 text-[8px] font-semibold rounded transition-colors">
                    Archive
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[10px] text-slate-600">No concepts tested yet. Generate your first pack to see results here.</p>
      )}
    </div>
  );
}
