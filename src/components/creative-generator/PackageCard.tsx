'use client';

import type { VideoPackage, ImagePackage, CreativePackage, RenderJob } from '@/components/creative-generator/types';
import { isVideoPackage } from './utils';
import { engineLabel } from '@/lib/engine-metadata';

export interface PackageCardProps {
  pkg: CreativePackage;
  idx: number;
  batchContentType: string | undefined;
  isOpen: boolean;
  onToggleExpand: () => void;
  renderJob: RenderJob | undefined;
  onRenderImage: (engine?: string) => void;
  onRetryRender: () => void;
  videoStatus: { id: string; status: string; engine: string; reason?: string } | undefined;
  onGenerateVideo: (engine?: string) => void;
  onDismissVideoStatus: () => void;
  isGeneratingVideo: boolean;
  defaultVideoEngine: string;
  videoDuration: number;
  generatingPackage: boolean;
  onVary: () => void;
  onSaveWinner: () => void;
  onToggleCompare: () => void;
  isComparing: boolean;
}

export function PackageCard({
  pkg,
  idx,
  batchContentType,
  isOpen,
  onToggleExpand,
  renderJob,
  onRenderImage,
  onRetryRender,
  videoStatus,
  onGenerateVideo,
  onDismissVideoStatus,
  isGeneratingVideo,
  defaultVideoEngine,
  videoDuration,
  generatingPackage,
  onVary,
  onSaveWinner,
  onToggleCompare,
  isComparing,
}: PackageCardProps) {
  const isVideo = isVideoPackage(pkg, batchContentType);
  const pkgStage = String((pkg as any).stage || '').toUpperCase();

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <button onClick={onToggleExpand}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">#{idx + 1}</span>
            <h4 className="text-sm font-semibold text-white truncate">{(pkg as any).title || `Package ${idx + 1}`}</h4>
            {(pkg as any)._fallback && <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400">Draft</span>}
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${isVideo ? 'bg-blue-900/30 text-blue-400' : 'bg-orange-900/30 text-orange-400'}`}>
              {isVideo ? 'Video' : 'Image'}
            </span>
            {pkgStage && ['TOF', 'MOF', 'BOF'].includes(pkgStage) && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                pkgStage === 'TOF' ? 'bg-sky-900/30 text-sky-400' :
                pkgStage === 'MOF' ? 'bg-violet-900/30 text-violet-400' :
                'bg-pink-900/30 text-pink-400'
              }`}>{pkgStage}</span>
            )}
            {/* Render status badge (visible when collapsed) */}
            {!isVideo && renderJob && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                renderJob.status === 'completed' ? 'bg-emerald-900/30 text-emerald-400' :
                renderJob.status === 'failed' ? 'bg-red-900/30 text-red-400' :
                renderJob.status === 'rendering' ? 'bg-yellow-900/30 text-yellow-400' :
                'bg-blue-900/30 text-blue-400'
              }`}>
                {renderJob.status === 'completed' ? 'Rendered' :
                 renderJob.status === 'failed' ? 'Failed' :
                 renderJob.status === 'rendering' ? 'Rendering...' : 'Queued'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">{(pkg as any).angle || (pkg as any).conceptAngle || ''}</p>
        </div>
        <svg className={`w-5 h-5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="border-t border-slate-800 px-5 py-4 space-y-4">
          {isVideo ? (
            <>
              {(pkg as VideoPackage).hook && (
                <div><p className="text-[10px] text-purple-400 uppercase font-semibold mb-1">Hook (0-3s)</p><p className="text-sm text-white bg-purple-900/20 border border-purple-900/30 rounded-lg p-3">{(pkg as VideoPackage).hook}</p></div>
              )}
              {(pkg as VideoPackage).script && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-blue-400 uppercase font-semibold">Full Script</p>
                    {(pkg as any)._finalEstimatedSeconds !== undefined && (pkg as any)._duration && (
                      <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                        (pkg as any)._validationPass ? 'bg-emerald-900/30 text-emerald-400' : 'bg-yellow-900/30 text-yellow-400'
                      }`}>
                        {(pkg as any)._finalWordCount} words • ~{(pkg as any)._finalEstimatedSeconds}s / {(pkg as any)._duration}s
                        {(pkg as any)._compressed && ' (compressed)'}
                      </span>
                    )}
                  </div>
                  <pre className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{(pkg as VideoPackage).script}</pre>
                </div>
              )}
              {(pkg as VideoPackage).sceneStructure && (
                <div><p className="text-[10px] text-cyan-400 uppercase font-semibold mb-1">Scene Structure</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as VideoPackage).sceneStructure}</p></div>
              )}
              {(pkg as VideoPackage).visualDirection && (
                <div><p className="text-[10px] text-indigo-400 uppercase font-semibold mb-1">Visual Direction</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as VideoPackage).visualDirection}</p></div>
              )}
              {(pkg as VideoPackage).brollDirection && (
                <div><p className="text-[10px] text-teal-400 uppercase font-semibold mb-1">B-Roll Direction</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as VideoPackage).brollDirection}</p></div>
              )}
              {(pkg as VideoPackage).avatarSuggestion && (
                <div><p className="text-[10px] text-amber-400 uppercase font-semibold mb-1">Avatar / Presenter</p><p className="text-xs text-slate-300">{(pkg as VideoPackage).avatarSuggestion}</p></div>
              )}
              {(pkg as VideoPackage).cta && (
                <div><p className="text-[10px] text-emerald-400 uppercase font-semibold mb-1">CTA</p><p className="text-sm text-emerald-300 font-medium">{(pkg as VideoPackage).cta}</p></div>
              )}
            </>
          ) : (
            <>
              {(pkg as ImagePackage).imageFormat && (
                <div className="mb-2"><span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-900/30 text-orange-400 uppercase">{(pkg as ImagePackage).imageFormat.replace(/_/g, ' ')}</span></div>
              )}
              {(pkg as ImagePackage).headline && (
                <div><p className="text-[10px] text-purple-400 uppercase font-semibold mb-1">Headline</p><p className="text-lg text-white font-bold">{(pkg as ImagePackage).headline}</p></div>
              )}
              {(pkg as ImagePackage).hookText && (
                <div><p className="text-[10px] text-pink-400 uppercase font-semibold mb-1">Hook Text (scroll-stop overlay)</p><p className="text-sm text-pink-300 font-semibold bg-pink-900/10 border border-pink-900/20 rounded-lg p-2">{(pkg as ImagePackage).hookText}</p></div>
              )}
              {(pkg as ImagePackage).proofElement && (
                <div><p className="text-[10px] text-amber-400 uppercase font-semibold mb-1">Proof Element</p><p className="text-xs text-slate-300">{(pkg as ImagePackage).proofElement}</p></div>
              )}
              {(pkg as ImagePackage).productPlacement && (
                <div><p className="text-[10px] text-blue-400 uppercase font-semibold mb-1">Product Placement</p><p className="text-xs text-slate-300">{(pkg as ImagePackage).productPlacement}</p></div>
              )}
              {(pkg as ImagePackage).visualComposition && (
                <div><p className="text-[10px] text-indigo-400 uppercase font-semibold mb-1">Layout Blueprint</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap">{(pkg as ImagePackage).visualComposition}</p></div>
              )}
              {(pkg as ImagePackage).textOverlays && (pkg as ImagePackage).textOverlays!.length > 0 && (
                <div>
                  <p className="text-[10px] text-cyan-400 uppercase font-semibold mb-1">Text Overlays (CapCut-ready)</p>
                  <div className="space-y-1">
                    {(pkg as ImagePackage).textOverlays!.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-2 bg-slate-800/60 rounded px-2 py-1">
                        <span className="text-[9px] text-slate-500 uppercase w-12">{t.position}</span>
                        <span className="text-xs text-white" style={{ fontWeight: t.fontWeight === 'bold' ? 700 : 400 }}>{t.text}</span>
                        <span className="text-[8px] text-slate-600 ml-auto">{t.fontSize} {t.color}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(pkg as ImagePackage).colorScheme && (
                <div className="flex gap-2 items-center">
                  <p className="text-[10px] text-slate-500">Colors:</p>
                  {Object.entries((pkg as ImagePackage).colorScheme!).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1"><div className="w-4 h-4 rounded border border-slate-600" style={{ backgroundColor: v }} /><span className="text-[9px] text-slate-500">{k}</span></div>
                  ))}
                </div>
              )}
              {(pkg as ImagePackage).offerPlacement && (
                <div><p className="text-[10px] text-amber-400 uppercase font-semibold mb-1">Offer</p><p className="text-xs text-slate-300">{(pkg as ImagePackage).offerPlacement}</p></div>
              )}
              {(pkg as ImagePackage).ctaText && (
                <div><p className="text-[10px] text-emerald-400 uppercase font-semibold mb-1">CTA</p><p className="text-sm text-emerald-300 font-medium">{(pkg as ImagePackage).ctaText} <span className="text-[9px] text-slate-500">({(pkg as ImagePackage).ctaPlacement})</span></p></div>
              )}
            </>
          )}
          {/* Ad Copy */}
          {(pkg as any).adCopy && (
            <div><p className="text-[10px] text-orange-400 uppercase font-semibold mb-1">Ad Copy</p><p className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{(pkg as any).adCopy}</p></div>
          )}
          {/* Variants */}
          {(pkg as any).variants?.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">Variant Ideas</p>
              <ul className="space-y-1">
                {(pkg as any).variants.map((v: string, vi: number) => (
                  <li key={vi} className="text-xs text-slate-400 flex items-start gap-2"><span className="text-slate-600 mt-0.5">•</span>{v}</li>
                ))}
              </ul>
            </div>
          )}
          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-800">
            {/* === IMAGE RENDER QUEUE === */}
            {!isVideo && (() => {
              const job = renderJob;
              if (!job || job.status === 'completed') {
                return (
                  <div className="flex gap-1">
                    <button onClick={() => onRenderImage()}
                      className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-medium rounded-l-lg">
                      {job?.status === 'completed' ? 'Re-render' : 'Render Image'}
                    </button>
                    <button onClick={() => onRenderImage('dalle')}
                      className="px-2 py-1.5 bg-orange-700 hover:bg-orange-800 text-white text-[9px] font-medium border-l border-orange-500" title="DALL-E 3 — text-to-image (falls back to gpt-image-1 when reference image attached)">DALL-E 3</button>
                    <button onClick={() => onRenderImage('gpt-image')}
                      className="px-2 py-1.5 bg-orange-700 hover:bg-orange-800 text-white text-[9px] font-medium border-l border-orange-500" title="GPT Image 2 — OpenAI flagship multimodal with reasoning, native image-to-image">GPT Image 2</button>
                    <button onClick={() => onRenderImage('gemini-image')}
                      className="px-2 py-1.5 bg-orange-700 hover:bg-orange-800 text-white text-[9px] font-medium border-l border-orange-500" title="Google Gemini (good all-around)">Gem</button>
                    <button onClick={() => onRenderImage('stability')}
                      className="px-2 py-1.5 bg-orange-700 hover:bg-orange-800 text-white text-[9px] font-medium border-l border-orange-500" title="Stability AI SDXL (strong prompt adherence)">SD</button>
                    <button onClick={() => onRenderImage('nano-banana')}
                      className="px-2 py-1.5 bg-orange-700 hover:bg-orange-800 text-white text-[9px] font-medium rounded-r-lg border-l border-orange-500" title="Nano Banana 2 (best text rendering + product scenes)">NB</button>
                  </div>
                );
              }
              if (job.status === 'queued') {
                return (
                  <span className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-blue-900/30 text-blue-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />Queued ({engineLabel(job.engine)})...
                  </span>
                );
              }
              if (job.status === 'rendering') {
                const renderEngineLabel = engineLabel(job.engine);
                return (
                  <span className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-yellow-900/30 text-yellow-400 flex items-center gap-1.5">
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Rendering with {renderEngineLabel}...
                  </span>
                );
              }
              if (job.status === 'failed') {
                return (
                  <button onClick={onRetryRender}
                    className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 cursor-pointer"
                    title="Click to retry">
                    {job.error || 'Failed'} — retry
                  </button>
                );
              }
              return null;
            })()}
            {/* Rendered image preview */}
            {!isVideo && renderJob?.status === 'completed' && renderJob?.imageUrl && (
              <div className="w-full mt-2 rounded-lg overflow-hidden border border-emerald-900/30 bg-slate-950">
                <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-900/20">
                  <span className="text-[10px] text-emerald-400 font-medium">Rendered via {engineLabel(renderJob.engine)}</span>
                  <a href={renderJob.imageUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-emerald-500 hover:text-emerald-300 underline">Open full size</a>
                </div>
                <img src={renderJob.imageUrl} alt={`Rendered: ${(pkg as any).title || ''}`}
                  className="w-full max-h-64 object-contain bg-slate-950" />
              </div>
            )}
            {/* === VIDEO GENERATION (unchanged) === */}
            {isVideo && !videoStatus && (() => {
              const autoEng = defaultVideoEngine;
              return (
              <div className="flex gap-1">
                <button onClick={() => onGenerateVideo()} disabled={isGeneratingVideo}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-l-lg">
                  {isGeneratingVideo ? 'Sending...' : `Generate ${videoDuration}s (${engineLabel(autoEng)})`}
                </button>
                <button onClick={() => onGenerateVideo('sora')} disabled={isGeneratingVideo}
                  className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium border-l border-emerald-500">Sora</button>
                <button onClick={() => onGenerateVideo('veo')} disabled={isGeneratingVideo}
                  className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium border-l border-emerald-500">Veo</button>
                <button onClick={() => onGenerateVideo('higgsfield')} disabled={isGeneratingVideo}
                  className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[9px] font-medium rounded-r-lg border-l border-emerald-500">Higgs</button>
              </div>
              );
            })()}
            {videoStatus && (
              videoStatus.status === 'failed' ? (
                <button onClick={onDismissVideoStatus}
                  className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 cursor-pointer"
                  title="Click to dismiss and retry">
                  {videoStatus.reason || 'Failed'} — click to retry
                </button>
              ) : (
                <span className={`px-3 py-1.5 text-[10px] font-medium rounded-lg ${
                  videoStatus.status === 'processing' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-emerald-900/30 text-emerald-400'
                }`}>
                  {videoStatus.status === 'processing'
                    ? `Generating with ${videoStatus.engine}...`
                    : `Video queued${videoStatus.engine === 'higgsfield' ? ' (silent — add voiceover separately)' : ''}`}
                </span>
              )
            )}
            <button onClick={onVary} disabled={generatingPackage}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg">Vary</button>
            <button onClick={onSaveWinner}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded-lg">Save Winner</button>
            <button onClick={onToggleCompare}
              className={`px-3 py-1.5 text-[10px] font-medium rounded-lg border ${isComparing ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
              {isComparing ? 'Comparing' : 'Compare'}
            </button>
            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(pkg, null, 2))}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-medium rounded-lg border border-slate-700">Export</button>
            <button onClick={() => { const script = (pkg as any).script || (pkg as any).adCopy || ''; navigator.clipboard.writeText(script); }}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-medium rounded-lg border border-slate-700">Copy Script</button>
          </div>
        </div>
      )}
    </div>
  );
}
