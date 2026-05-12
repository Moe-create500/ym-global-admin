'use client';

export interface CreativeFatigueMonitorProps {
  conceptData: any;
}

export function CreativeFatigueMonitor({ conceptData }: CreativeFatigueMonitorProps) {
  if (!conceptData || !(conceptData.fatiguingCount > 0)) return null;
  return (
    <div className="bg-slate-900 border border-orange-900/30 rounded-xl p-4">
      <h3 className="text-[10px] text-orange-400 uppercase font-bold mb-3">Fatigue Alert</h3>
      <div className="space-y-2">
        {conceptData.concepts.filter((c: any) => c.fatigue.status !== 'healthy').slice(0, 4).map((concept: any, i: number) => (
          <div key={i} className={`p-2 rounded-lg border ${
            concept.fatigue.status === 'fatiguing' ? 'bg-orange-950/20 border-orange-800/40' : 'bg-yellow-950/10 border-yellow-800/30'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-white font-medium truncate flex-1">{concept.name}</span>
              <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                concept.fatigue.status === 'fatiguing' ? 'bg-orange-500/20 text-orange-400' : 'bg-yellow-500/20 text-yellow-400'
              }`}>{concept.fatigue.status} ({concept.fatigue.score}/10)</span>
            </div>
            <p className="text-[9px] text-slate-500">{concept.fatigue.signals.join(' · ')}</p>
          </div>
        ))}
      </div>
      <p className="text-[8px] text-orange-500/60 mt-2">{conceptData.fatiguingCount} concept{conceptData.fatiguingCount > 1 ? 's' : ''} showing fatigue signals</p>
    </div>
  );
}
