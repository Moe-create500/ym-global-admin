'use client';

import type React from 'react';
import type { CreativePackage, RenderJob } from '@/components/creative-generator/types';
import { isVideoPackage } from './utils';
import { PackageCard } from './PackageCard';

export interface PackageListProps {
  genPackages: CreativePackage[];
  batchContentType: string | undefined;
  videoDuration: number;
  genVersion: number;
  matchedWinnerTitle: string | null | undefined;
  expandedPackage: number | null;
  comparingPackages: number[];
  renderJobs: Record<number, RenderJob>;
  packageVideoStatus: Record<number, { id: string; status: string; engine: string; reason?: string }>;
  generatingIdxSet: Set<number>;
  generatingPackage: boolean;
  defaultVideoEngine: string;
  onToggleExpand: (idx: number) => void;
  onRenderImage: (pkg: CreativePackage, idx: number, engine?: string) => void;
  onRetryRender: (pkg: CreativePackage, idx: number) => void;
  onGenerateVideo: (pkg: CreativePackage, idx: number, engine?: string) => void;
  onDismissVideoStatus: (idx: number) => void;
  onVary: (idx: number) => void;
  onSaveWinner: (pkg: CreativePackage, idx: number) => void;
  onToggleCompare: (idx: number) => void;
  onGenerateAll: (mode: 'all' | 'sequential') => void;
  launchSlot: React.ReactNode;
}

export function PackageList({
  genPackages,
  batchContentType,
  videoDuration,
  genVersion,
  matchedWinnerTitle,
  expandedPackage,
  comparingPackages,
  renderJobs,
  packageVideoStatus,
  generatingIdxSet,
  generatingPackage,
  defaultVideoEngine,
  onToggleExpand,
  onRenderImage,
  onRetryRender,
  onGenerateVideo,
  onDismissVideoStatus,
  onVary,
  onSaveWinner,
  onToggleCompare,
  onGenerateAll,
  launchSlot,
}: PackageListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Generated Packages ({genPackages.length})</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">v{genVersion}</span>
          {genVersion > 1 && <span className="text-[10px] text-purple-400">variation</span>}
          {matchedWinnerTitle && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
              Based on Winner: {matchedWinnerTitle}
            </span>
          )}
        </div>
        {comparingPackages.length >= 2 && (
          <span className="text-[10px] text-blue-400">{comparingPackages.length} selected for comparison</span>
        )}
        {/* Bulk generate buttons — works for BOTH image and video (mixed batches aware) */}
        {genPackages.length > 0 && (() => {
          // Split packages by per-package content type
          const vCount = genPackages.filter(p => isVideoPackage(p, batchContentType)).length;
          const iCount = genPackages.length - vCount;
          const isMixed = vCount > 0 && iCount > 0;
          const primaryColor = isMixed ? 'bg-purple-600 hover:bg-purple-700' : vCount > 0 ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-600 hover:bg-orange-700';
          const secondaryColor = isMixed ? 'bg-purple-700 hover:bg-purple-800' : vCount > 0 ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-orange-700 hover:bg-orange-800';
          const btnLabelParts: string[] = [];
          if (vCount > 0) btnLabelParts.push(`${vCount} ${videoDuration}s video${vCount !== 1 ? 's' : ''}`);
          if (iCount > 0) btnLabelParts.push(`${iCount} image${iCount !== 1 ? 's' : ''}`);
          return (
          <div className="flex items-center gap-2">
            {/* Progress indicator */}
            {(() => {
              const vActive = generatingIdxSet.size;
              const vDone = Object.values(packageVideoStatus).filter(s => s.status === 'completed' || s.status === 'processing').length;
              const iActive = Object.values(renderJobs).filter(j => j.status === 'queued' || j.status === 'rendering').length;
              const iDone = Object.values(renderJobs).filter(j => j.status === 'completed').length;
              const totalActive = vActive + iActive;
              const totalDone = vDone + iDone;
              return totalActive > 0 ? (
                <span className="text-[10px] text-yellow-400 flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  {totalActive} generating{totalDone > 0 ? `, ${totalDone} started` : ''}
                </span>
              ) : totalDone > 0 ? (
                <span className="text-[10px] text-emerald-400">{totalDone}/{genPackages.length} started</span>
              ) : null;
            })()}
            {/* Generate All button */}
            <button onClick={() => onGenerateAll('all')}
              className={`px-3 py-1 ${primaryColor} text-white text-[10px] font-medium rounded-lg`}>
              Generate All ({btnLabelParts.join(' + ')})
            </button>
            {/* 1-by-1 button */}
            <button onClick={() => onGenerateAll('sequential')}
              className={`px-3 py-1 ${secondaryColor} text-white text-[10px] font-medium rounded-lg`}>
              1-by-1
            </button>
          </div>
          );
        })()}
      </div>
      {launchSlot}
      {genPackages.map((pkg, idx) => (
        <PackageCard
          key={idx}
          pkg={pkg}
          idx={idx}
          batchContentType={batchContentType}
          isOpen={expandedPackage === idx}
          onToggleExpand={() => onToggleExpand(idx)}
          renderJob={renderJobs[idx]}
          onRenderImage={(engine) => onRenderImage(pkg, idx, engine)}
          onRetryRender={() => onRetryRender(pkg, idx)}
          videoStatus={packageVideoStatus[idx]}
          onGenerateVideo={(engine) => onGenerateVideo(pkg, idx, engine)}
          onDismissVideoStatus={() => onDismissVideoStatus(idx)}
          isGeneratingVideo={generatingIdxSet.has(idx)}
          defaultVideoEngine={defaultVideoEngine}
          videoDuration={videoDuration}
          generatingPackage={generatingPackage}
          onVary={() => onVary(idx)}
          onSaveWinner={() => onSaveWinner(pkg, idx)}
          onToggleCompare={() => onToggleCompare(idx)}
          isComparing={comparingPackages.includes(idx)}
        />
      ))}
    </div>
  );
}
