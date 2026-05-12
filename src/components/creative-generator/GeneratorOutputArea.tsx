'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { UsePackageGenerationStateReturn } from './hooks/usePackageGenerationState';
import type { UsePerPackageRenderStateReturn } from './hooks/usePerPackageRenderState';
import type { UseMetaLaunchStateReturn } from './hooks/useMetaLaunchState';
import type { CreativePackage } from '@/components/creative-generator/types';
import type { ShowWinnerModalArg } from './LibraryTab';
import { PackageList } from './PackageList';
import { LaunchToMetaPanel } from './LaunchToMetaPanel';
import { ComparisonView } from './ComparisonView';

export interface GeneratorOutputAreaProps {
  packageGeneration: UsePackageGenerationStateReturn;
  perPackageRender: UsePerPackageRenderStateReturn;
  metaLaunch: UseMetaLaunchStateReturn;
  genConfig: GeneratorConfig;
  matchedWinnerRef: any;
  defaultVideoEngine: string;
  onRenderImage: (pkg: CreativePackage, idx: number, engine?: string) => void;
  onRetryRender: (pkg: CreativePackage, idx: number) => void;
  onGenerateVideoFromPackage: (pkg: CreativePackage, idx: number, engine?: string) => void;
  onGenerateVariations: (idx: number) => void;
  onGenerateAll: (mode: 'all' | 'sequential') => void;
  onToggleCompare: (idx: number) => void;
  onLaunchToMeta: () => void;
  onShowWinnerModal: React.Dispatch<React.SetStateAction<ShowWinnerModalArg | null>>;
}

export function GeneratorOutputArea({
  packageGeneration,
  perPackageRender,
  metaLaunch,
  genConfig,
  matchedWinnerRef,
  defaultVideoEngine,
  onRenderImage,
  onRetryRender,
  onGenerateVideoFromPackage,
  onGenerateVariations,
  onGenerateAll,
  onToggleCompare,
  onLaunchToMeta,
  onShowWinnerModal,
}: GeneratorOutputAreaProps) {
  const {
    genPackages,
    genPackageConfig,
    generatingPackage,
    genVersion,
    expandedPackage, setExpandedPackage,
    higgsPackJob, setHiggsPackJob,
    tutorialVideoResult, setTutorialVideoResult,
  } = packageGeneration;
  const {
    generatingIdxSet,
    packageVideoStatus, setPackageVideoStatus,
    renderJobs,
    comparingPackages, setComparingPackages,
  } = perPackageRender;
  const {
    fbProfiles,
    selectedProfileId, setSelectedProfileId,
    launchLinkUrl, setLaunchLinkUrl,
    launching,
    launchError,
    launchResult,
  } = metaLaunch;

  return (
    <>
      {/* ═══ Generated Output Area ═══ */}
      {generatingPackage && !higgsPackJob && (
        <div className="bg-slate-900 border border-purple-900/30 rounded-xl p-6 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-3" />
          <p className="text-white font-medium text-sm">Generating {genConfig.quantity * genConfig.creativesPerConcept} creatives across {genConfig.quantity} concept{genConfig.quantity > 1 ? 's' : ''}...</p>
          <div className="flex justify-center gap-6 mt-3 text-[10px]">
            <span className="text-emerald-400">Account data loaded</span>
            <span className="text-emerald-400">Strategy built</span>
            <span className="text-purple-400 animate-pulse">AI generating...</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-2">~5-10 seconds</p>
        </div>
      )}

      {/* Higgsfield Pack Progress */}
      {higgsPackJob && (
        <div className={`bg-slate-900 border rounded-xl p-5 ${higgsPackJob.status === 'completed' ? 'border-emerald-800/50' : higgsPackJob.status === 'failed' ? 'border-red-800/50' : 'border-orange-900/50'}`}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-bold uppercase">Higgsfield Pack</span>
            <span className={`text-xs font-medium ${
              higgsPackJob.status === 'completed' ? 'text-emerald-400' :
              higgsPackJob.status === 'failed' ? 'text-red-400' :
              'text-orange-400'
            }`}>{higgsPackJob.status}</span>
          </div>
          <p className="text-sm text-white mb-3">{higgsPackJob.progress || 'Processing...'}</p>
          {/* Scene progress */}
          {higgsPackJob.scenes && higgsPackJob.scenes.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              {higgsPackJob.scenes.map((s: any, i: number) => (
                <div key={i} className={`px-2 py-1.5 rounded-lg text-center text-[9px] border ${
                  s.status === 'completed' ? 'bg-emerald-900/20 border-emerald-800 text-emerald-400' :
                  s.status === 'failed' ? 'bg-red-900/20 border-red-800 text-red-400' :
                  'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                  <span className="block font-semibold">{s.name}</span>
                  <span className="opacity-70">{s.status}</span>
                </div>
              ))}
            </div>
          )}
          {/* Completed video */}
          {higgsPackJob.status === 'completed' && higgsPackJob.videoUrl && (
            <div className="mt-3">
              <video src={higgsPackJob.videoUrl} controls className="w-full rounded-lg max-h-80 bg-black" />
              <div className="flex gap-2 mt-2">
                <a href={higgsPackJob.videoUrl} download target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium rounded-lg">Download</a>
                <button onClick={() => setHiggsPackJob(null)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 text-[10px] rounded-lg border border-slate-700">Dismiss</button>
              </div>
            </div>
          )}
          {/* Spinner for in-progress */}
          {(higgsPackJob.status === 'generating' || higgsPackJob.status === 'stitching' || higgsPackJob.status === 'planning') && (
            <div className="flex items-center gap-2 mt-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-400" />
              <span className="text-[10px] text-orange-400">This may take 2-5 minutes</span>
            </div>
          )}
        </div>
      )}

      {/* ═══ Tutorial Mode result ═══
          Set by handleGeneratePackage on a { mode: 'tutorial', videoUrl, ... }
          response from clone-ad/route.ts. Renders the finished Seedance video
          directly and suppresses the standard package-review grid below. */}
      {tutorialVideoResult && (
        <div className="bg-slate-900 border border-pink-800/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-400 font-bold uppercase">Tutorial Mode</span>
            <span className="text-xs text-emerald-400 font-medium">completed</span>
            <span className="text-[10px] text-slate-500">{tutorialVideoResult.generatedDuration}s • Seedance 2.0 via Higgsfield</span>
          </div>
          <video src={tutorialVideoResult.videoUrl} controls className="w-full rounded-lg max-h-96 bg-black" />
          <div className="flex gap-2 mt-3 flex-wrap">
            <a
              href={tutorialVideoResult.videoUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium rounded-lg"
            >
              Download
            </a>
            <button
              type="button"
              onClick={() => setTutorialVideoResult(null)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 text-[10px] rounded-lg border border-slate-700"
            >
              Dismiss
            </button>
          </div>
          {/* Show the assembled beat-by-beat prompt for transparency / debugging */}
          <details className="mt-3">
            <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">View beat-by-beat prompt sent to Seedance</summary>
            <pre className="mt-2 p-3 bg-slate-950 border border-slate-800 rounded text-[10px] text-slate-300 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">{tutorialVideoResult.prompt}</pre>
          </details>
          <p className="text-[9px] text-slate-500 mt-2">
            requestId: {tutorialVideoResult.requestId} • source duration: {tutorialVideoResult.sourceDuration}s
          </p>
        </div>
      )}

      {!tutorialVideoResult && genPackages.length > 0 && (
        <PackageList
          genPackages={genPackages}
          batchContentType={genPackageConfig?.contentType}
          videoDuration={genConfig.videoDuration}
          genVersion={genVersion}
          matchedWinnerTitle={matchedWinnerRef?.title}
          expandedPackage={expandedPackage}
          comparingPackages={comparingPackages}
          renderJobs={renderJobs}
          packageVideoStatus={packageVideoStatus}
          generatingIdxSet={generatingIdxSet}
          generatingPackage={generatingPackage}
          defaultVideoEngine={defaultVideoEngine}
          onToggleExpand={(idx) => setExpandedPackage(expandedPackage === idx ? null : idx)}
          onRenderImage={(pkg, idx, engine) => onRenderImage(pkg, idx, engine)}
          onRetryRender={(pkg, idx) => onRetryRender(pkg, idx)}
          onGenerateVideo={(pkg, idx, engine) => onGenerateVideoFromPackage(pkg, idx, engine)}
          onDismissVideoStatus={(idx) => setPackageVideoStatus(prev => { const n = { ...prev }; delete n[idx]; return n; })}
          onVary={(idx) => onGenerateVariations(idx)}
          onSaveWinner={(pkg, idx) => onShowWinnerModal({ pkg, idx })}
          onToggleCompare={(idx) => onToggleCompare(idx)}
          onGenerateAll={(mode) => onGenerateAll(mode)}
          launchSlot={
            /* ═══ LAUNCH TO META ═══ (shows when any image in batch has rendered) */
            Object.values(renderJobs).some(j => j.status === 'completed') ? (
              <LaunchToMetaPanel
                fbProfiles={fbProfiles}
                selectedProfileId={selectedProfileId}
                setSelectedProfileId={setSelectedProfileId}
                launchLinkUrl={launchLinkUrl}
                setLaunchLinkUrl={setLaunchLinkUrl}
                launching={launching}
                launchError={launchError}
                launchResult={launchResult}
                completedAdCount={Object.values(renderJobs).filter(j => j.status === 'completed').length}
                onLaunch={onLaunchToMeta}
              />
            ) : null
          }
        />
      )}

      {/* Comparison View */}
      {comparingPackages.length >= 2 && genPackages.length > 0 && (
        <ComparisonView
          comparingPackages={comparingPackages}
          genPackages={genPackages}
          batchContentType={genPackageConfig?.contentType}
          generatingPackage={generatingPackage}
          onClear={() => setComparingPackages([])}
          onVary={(idx) => onGenerateVariations(idx)}
        />
      )}
    </>
  );
}
