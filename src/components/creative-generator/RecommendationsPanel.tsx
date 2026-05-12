'use client';

import type { AccountIntelligence } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface RecommendationsPanelProps {
  accountIntel: AccountIntelligence | null;
  setGenConfig: SetGenConfig;
}

export function RecommendationsPanel({ accountIntel, setGenConfig }: RecommendationsPanelProps) {
  return (
    <div className="bg-slate-900 border border-indigo-900/30 rounded-xl p-4">
      <h3 className="text-[10px] text-indigo-400 uppercase font-semibold mb-3">Recommendations</h3>
      {accountIntel ? (
        <div className="space-y-2.5">
          {/* Account metrics summary */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="bg-slate-800/50 rounded p-2"><p className="text-[9px] text-slate-500">Avg ROAS</p><p className="text-sm font-bold text-white">{accountIntel.metrics.avgRoas}x</p></div>
            <div className="bg-slate-800/50 rounded p-2"><p className="text-[9px] text-slate-500">Avg CTR</p><p className="text-sm font-bold text-blue-400">{accountIntel.metrics.avgCtr}%</p></div>
            <div className="bg-slate-800/50 rounded p-2"><p className="text-[9px] text-slate-500">Avg CPA</p><p className="text-sm font-bold text-white">${accountIntel.metrics.avgCpa}</p></div>
            <div className="bg-slate-800/50 rounded p-2"><p className="text-[9px] text-slate-500">Avg CVR</p><p className="text-sm font-bold text-emerald-400">{accountIntel.metrics.avgCvr}%</p></div>
          </div>
          <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Content Type</span><span className="text-xs text-white font-medium capitalize">{accountIntel.recommendations.contentType}</span></div>
          <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Funnel Stage</span><span className="text-xs text-white font-medium">{accountIntel.recommendations.funnelStage === 'tof' ? 'Top' : accountIntel.recommendations.funnelStage === 'mof' ? 'Middle' : 'Bottom'}</span></div>
          <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Hook Style</span><span className="text-xs text-white font-medium capitalize">{accountIntel.recommendations.hookStyle}</span></div>
          <div className="mt-2 pt-2 border-t border-slate-800">
            <div className="flex justify-between mb-1"><span className="text-[10px] text-slate-500">Confidence</span><span className="text-[10px] text-indigo-400 font-semibold">{accountIntel.recommendations.confidence}%</span></div>
            <div className="w-full bg-slate-800 rounded-full h-1.5"><div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${accountIntel.recommendations.confidence}%` }} /></div>
          </div>
          {accountIntel.recommendations.reasons.length > 0 && (
            <div className="pt-2">{accountIntel.recommendations.reasons.map((r, i) => <p key={i} className="text-[10px] text-slate-400 mb-0.5">• {r}</p>)}</div>
          )}
          {accountIntel.recommendations.provider && accountIntel.recommendations.provider !== 'auto' && (
            <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Provider</span><span className="text-xs text-white font-medium capitalize">{accountIntel.recommendations.provider}</span></div>
          )}
          {accountIntel.recommendations.aspectRatio && (
            <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Aspect Ratio</span><span className="text-xs text-white font-medium">{accountIntel.recommendations.aspectRatio}</span></div>
          )}
          {accountIntel.recommendations.duration && (
            <div className="flex justify-between items-center"><span className="text-[10px] text-slate-500">Duration</span><span className="text-xs text-white font-medium">{accountIntel.recommendations.duration}s</span></div>
          )}
          <button onClick={() => setGenConfig(c => ({
            ...c,
            contentType: accountIntel!.recommendations.contentType as any,
            contentMix: accountIntel!.recommendations.contentType as any,
            funnelStage: accountIntel!.recommendations.funnelStage as any,
            funnelStructure: accountIntel!.recommendations.funnelStage as any,
            hookStyle: accountIntel!.recommendations.hookStyle,
            dimension: (accountIntel!.recommendations as any).aspectRatio || c.dimension,
            videoDuration: (accountIntel!.recommendations as any).duration || c.videoDuration,
          }))} className="w-full mt-2 px-3 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-800/50 text-indigo-400 text-[10px] font-medium rounded-lg">Apply Recommendations</button>
        </div>
      ) : (
        <div className="text-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-400 mx-auto mb-2" /><p className="text-[10px] text-slate-500">Loading intelligence...</p></div>
      )}
    </div>
  );
}
