'use client';

import type { CreativePackage } from '@/components/creative-generator/types';
import { isVideoPackage } from './utils';

export interface ComparisonViewProps {
  comparingPackages: number[];
  genPackages: CreativePackage[];
  batchContentType: string | undefined;
  generatingPackage: boolean;
  onClear: () => void;
  onVary: (idx: number) => void;
}

export function ComparisonView({
  comparingPackages,
  genPackages,
  batchContentType,
  generatingPackage,
  onClear,
  onVary,
}: ComparisonViewProps) {
  return (
    <div className="bg-slate-900 border border-blue-900/30 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Compare Packages</h3>
        <button onClick={onClear} className="text-[10px] text-slate-400 hover:text-white">Clear</button>
      </div>
      <div className={`grid gap-4 ${comparingPackages.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {comparingPackages.map(idx => {
          const pkg = genPackages[idx];
          if (!pkg) return null;
          const isVideo = isVideoPackage(pkg, batchContentType);
          return (
            <div key={idx} className="bg-slate-800/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">#{idx + 1}</span>
                <p className="text-xs font-semibold text-white truncate">{(pkg as any).title}</p>
              </div>
              <div><p className="text-[9px] text-slate-500 uppercase">Angle</p><p className="text-[10px] text-slate-300">{(pkg as any).angle || (pkg as any).conceptAngle}</p></div>
              <div><p className="text-[9px] text-slate-500 uppercase">Hook</p><p className="text-[10px] text-purple-300">{isVideo ? (pkg as any).hook : (pkg as any).headline}</p></div>
              <div><p className="text-[9px] text-slate-500 uppercase">CTA</p><p className="text-[10px] text-emerald-300">{(pkg as any).cta || (pkg as any).ctaDirection}</p></div>
              {isVideo && <div><p className="text-[9px] text-slate-500 uppercase">Avatar</p><p className="text-[10px] text-slate-300">{(pkg as any).avatarSuggestion}</p></div>}
              <div><p className="text-[9px] text-slate-500 uppercase">Structure</p><p className="text-[10px] text-slate-400">{isVideo ? (pkg as any).sceneStructure?.substring(0, 120) : (pkg as any).visualComposition?.substring(0, 120)}...</p></div>
              <button onClick={() => onVary(idx)} disabled={generatingPackage}
                className="w-full mt-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg">
                Vary This One
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
