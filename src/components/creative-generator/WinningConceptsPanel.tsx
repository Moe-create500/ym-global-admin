'use client';

import type { ConceptSource } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface WinningConceptsPanelProps {
  conceptData: any;
  setGenConfig: SetGenConfig;
}

export function WinningConceptsPanel({ conceptData, setGenConfig }: WinningConceptsPanelProps) {
  if (!conceptData || !(conceptData.concepts?.length > 0)) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] text-emerald-400 uppercase font-bold">Winning Concepts</h3>
        <div className="flex gap-1.5 text-[8px]">
          <span className="px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400">{conceptData.scaleCount} scale</span>
          <span className="px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400">{conceptData.testCount} test</span>
          <span className="px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">{conceptData.killCount} kill</span>
        </div>
      </div>
      <div className="space-y-2">
        {conceptData.concepts.slice(0, 6).map((concept: any, i: number) => (
          <div key={i} className={`p-2.5 rounded-lg border ${
            concept.status === 'scale' ? 'bg-emerald-950/20 border-emerald-800/40' :
            concept.status === 'test' ? 'bg-blue-950/20 border-blue-800/40' :
            'bg-red-950/10 border-red-800/30'
          }`}>
            <div className="flex items-start justify-between mb-1">
              <p className="text-[11px] text-white font-medium truncate flex-1 mr-2">{concept.name}</p>
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-[9px] font-bold ${
                  concept.score >= 8 ? 'text-emerald-400' : concept.score >= 5 ? 'text-blue-400' : 'text-red-400'
                }`}>{concept.score}/10</span>
                <span className={`text-[7px] px-1.5 py-0.5 rounded-full uppercase font-bold ${
                  concept.status === 'scale' ? 'bg-emerald-500/20 text-emerald-400' :
                  concept.status === 'test' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-red-500/20 text-red-400'
                }`}>{concept.status}</span>
              </div>
            </div>
            <div className="flex items-center gap-2.5 text-[9px] mb-2">
              <span className="text-blue-400">CTR {concept.metrics.ctr}%</span>
              <span className={concept.metrics.roas >= 1.5 ? 'text-emerald-400' : 'text-slate-500'}>ROAS {concept.metrics.roas}x</span>
              <span className="text-slate-500">CPA ${concept.metrics.cpa}</span>
              <span className="text-slate-600">${concept.metrics.spend}</span>
            </div>
            {concept.fatigue.status !== 'healthy' && (
              <div className={`text-[8px] px-2 py-1 rounded mb-2 ${
                concept.fatigue.status === 'fatiguing' ? 'bg-orange-900/20 text-orange-400' : 'bg-yellow-900/20 text-yellow-400'
              }`}>
                {concept.fatigue.signals.join(' · ')}
              </div>
            )}
            <div className="flex gap-1">
              {concept.status === 'scale' && (
                <button onClick={() => setGenConfig(c => ({ ...c, conceptSource: 'use_existing' as ConceptSource, quantity: 1, creativesPerConcept: 5, conceptAngle: concept.name }))}
                  className="flex-1 px-1.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-[8px] font-semibold rounded transition-colors">
                  Scale
                </button>
              )}
              {concept.status === 'test' && (
                <button onClick={() => setGenConfig(c => ({ ...c, conceptSource: 'recently_tested' as ConceptSource, quantity: 1, creativesPerConcept: 3, conceptAngle: concept.name }))}
                  className="flex-1 px-1.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-[8px] font-semibold rounded transition-colors">
                  Test More
                </button>
              )}
              {concept.fatigue.status === 'fatiguing' && (
                <button onClick={() => setGenConfig(c => ({ ...c, conceptSource: 'use_existing' as ConceptSource, quantity: 1, creativesPerConcept: 3, conceptAngle: concept.name }))}
                  className="flex-1 px-1.5 py-1 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 text-[8px] font-semibold rounded transition-colors">
                  Refresh
                </button>
              )}
              {concept.status === 'kill' && (
                <span className="flex-1 px-1.5 py-1 text-red-500/50 text-[8px] text-center">Underperforming</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[8px] text-slate-600 mt-2">vs baseline: CTR {conceptData.baseline.ctr}% · ROAS {conceptData.baseline.roas}x · CPA ${conceptData.baseline.cpa}</p>
    </div>
  );
}
