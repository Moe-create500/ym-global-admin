'use client';

export interface StrategyDisplayProps {
  genStrategy: any;
  viewingHistory: string | null;
}

export function StrategyDisplay({ genStrategy, viewingHistory }: StrategyDisplayProps) {
  if (!genStrategy) return null;
  return (
    <div className="bg-slate-900 border border-purple-900/30 rounded-xl p-4">
      <h3 className="text-[10px] text-purple-400 uppercase font-semibold mb-3">Strategy {viewingHistory ? '(Saved)' : '(Current)'}</h3>
      <div className="space-y-2.5 text-xs">
        {/* Overrides — media buyer suggestions */}
        {genStrategy.overrides?.length > 0 && (
          <div className="mb-2">
            {genStrategy.overrides.map((o: any, i: number) => (
              <div key={i} className="px-3 py-2 bg-amber-900/15 border border-amber-800/40 rounded-lg mb-1.5">
                <p className="text-[10px] text-amber-400 font-semibold">{o.field}: {o.current} → {o.suggested}</p>
                <p className="text-[10px] text-amber-400/70 mt-0.5">{o.reason}</p>
              </div>
            ))}
          </div>
        )}
        <div><p className="text-[9px] text-slate-500 uppercase">Angle</p><p className="text-slate-300">{genStrategy.recommendedAngle}</p></div>
        <div><p className="text-[9px] text-slate-500 uppercase">Hook</p><p className="text-slate-300">{genStrategy.recommendedHook}</p></div>
        <div><p className="text-[9px] text-slate-500 uppercase">Structure</p><p className="text-slate-300">{genStrategy.recommendedStructure}</p></div>
        <div><p className="text-[9px] text-slate-500 uppercase">CTA</p><p className="text-slate-300">{genStrategy.recommendedCta}</p></div>
        <div><p className="text-[9px] text-slate-500 uppercase">Format</p><p className="text-slate-300">{genStrategy.recommendedFormat}</p></div>
        {/* Confidence */}
        {genStrategy.confidence > 0 && (
          <div className="pt-2 border-t border-slate-800">
            <div className="flex justify-between mb-1">
              <span className="text-[9px] text-slate-500">Data Confidence</span>
              <span className="text-[10px] text-purple-400 font-semibold">{genStrategy.confidence}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5"><div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${genStrategy.confidence}%` }} /></div>
          </div>
        )}
        {/* Evidence — "Why This Works" */}
        {genStrategy.evidence?.length > 0 && (
          <div className="pt-2 border-t border-slate-800">
            <p className="text-[9px] text-emerald-500 uppercase mb-2">Why This Works</p>
            {genStrategy.evidence.map((e: any, i: number) => (
              <div key={i} className="bg-emerald-900/10 border border-emerald-900/20 rounded-lg p-2 mb-1.5">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-[9px] text-emerald-400 font-semibold">{e.metric}</span>
                  <span className="text-[10px] text-white font-bold">{e.value}</span>
                </div>
                <p className="text-[10px] text-slate-400">{e.leader}</p>
                <p className="text-[10px] text-slate-500">{e.insight}</p>
              </div>
            ))}
          </div>
        )}
        {/* Reasoning */}
        {genStrategy.reasons?.length > 0 && (
          <div className="pt-2 border-t border-slate-800">
            <p className="text-[9px] text-slate-500 uppercase mb-1">Reasoning</p>
            {genStrategy.reasons.map((r: string, i: number) => (
              <p key={i} className="text-[10px] text-slate-400 mb-0.5">• {r}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
