'use client';

import { useState } from 'react';
import type { Creative, CreativesTab } from '@/components/creative-generator/types';
import type { UseBulkSelectionStateReturn } from './hooks/useBulkSelectionState';
import type { ShowWinnerModalArg } from './LibraryTab';
import { mediaUrl } from './utils';
import { ENGINE_METADATA } from '@/lib/engine-metadata';
import { parseAnimatedTemplateData } from '@/lib/animated-template-data';
import { AnimatedScenesModal } from './AnimatedScenesModal';

// Schema's uiColor token → full Tailwind class strings. Tailwind's content
// scanner detects these literals at compile time and includes them in the
// bundle — dynamic class names (`bg-${color}-900/30`) get purged. Schema
// owns the engine→color decision; this Record owns the rendering.
const COLOR_CLASSES: Record<string, string> = {
  emerald: 'bg-emerald-900/30 text-emerald-400',
  indigo: 'bg-indigo-900/30 text-indigo-400',
  cyan: 'bg-cyan-900/30 text-cyan-400',
  orange: 'bg-orange-900/30 text-orange-400',
  violet: 'bg-violet-900/30 text-violet-400',
  pink: 'bg-pink-900/30 text-pink-400',
  yellow: 'bg-yellow-900/30 text-yellow-400',
  rose: 'bg-rose-900/30 text-rose-400',
  blue: 'bg-blue-900/30 text-blue-400',
  sky: 'bg-sky-900/30 text-sky-400',
  slate: 'bg-slate-800 text-slate-400',
  gray: 'bg-gray-800 text-gray-400',
};

export interface GeneratedCreativesTabProps {
  tab: CreativesTab;
  loading: boolean;
  creatives: Creative[];
  winners: any[];
  expiredVideos: Set<string>;
  onSetExpiredVideos: React.Dispatch<React.SetStateAction<Set<string>>>;
  bulkSelection: UseBulkSelectionStateReturn;
  isCreativeLaunchable: (c: Creative) => boolean;
  isCreativeWinner: (id: string) => boolean;
  onSelectAllVisibleCreatives: () => void;
  onClearCreativeSelection: () => void;
  onOpenBulkLaunchModal: () => void;
  onToggleCreativeSelection: (id: string) => void;
  onPollStatus: (id: string) => void;
  onShowWinnerModal: React.Dispatch<React.SetStateAction<ShowWinnerModalArg | null>>;
  onGenerateMoreLikeThis: (winner: any) => void;
}

export function GeneratedCreativesTab({
  tab,
  loading,
  creatives,
  winners,
  expiredVideos,
  onSetExpiredVideos,
  bulkSelection,
  isCreativeLaunchable,
  isCreativeWinner,
  onSelectAllVisibleCreatives,
  onClearCreativeSelection,
  onOpenBulkLaunchModal,
  onToggleCreativeSelection,
  onPollStatus,
  onShowWinnerModal,
  onGenerateMoreLikeThis,
}: GeneratedCreativesTabProps) {
  const { selectedCreativeIds, setSelectedCreativeIds } = bulkSelection;

  // Stage B: which animated creative's per-scene modal is open (null = closed).
  const [scenesModalCreativeId, setScenesModalCreativeId] = useState<string | null>(null);
  const scenesModalCreative = scenesModalCreativeId
    ? creatives.find(c => c.id === scenesModalCreativeId)
    : null;
  const scenesModalParsed = scenesModalCreative
    ? parseAnimatedTemplateData(scenesModalCreative.template_data)
    : null;

  if (tab !== 'generated') return null;

  return (
    <>
      {/* ── Bulk action bar — appears when 1+ creatives selected ── */}
      {selectedCreativeIds.size > 0 && (
        <div className="sticky top-0 z-20 mb-4 bg-blue-900/20 border border-blue-700/50 rounded-xl p-3 backdrop-blur-sm flex flex-wrap items-center gap-3">
          <span className="text-sm text-blue-300 font-medium">
            {selectedCreativeIds.size} selected
          </span>
          <div className="flex-1" />
          <button onClick={onSelectAllVisibleCreatives}
            className="px-3 py-1.5 text-xs text-blue-300 hover:text-white border border-blue-700 rounded-lg">
            Select all launchable
          </button>
          <button onClick={onClearCreativeSelection}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg">
            Clear
          </button>
          <button onClick={onOpenBulkLaunchModal}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg">
            Launch to Facebook ({selectedCreativeIds.size})
          </button>
        </div>
      )}

      {/* ── Always-visible "Select All" / "Launch" entry point when nothing is selected ── */}
      {selectedCreativeIds.size === 0 && creatives.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-slate-500">Select creatives to launch them to Facebook</p>
          <button onClick={onSelectAllVisibleCreatives}
            className="px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 border border-blue-900/50 rounded-lg">
            Select all launchable
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
      ) : creatives.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No creatives yet</p>
          <p className="text-xs text-slate-500 mt-1">Generate videos using Sora, Veo, Hailuo, or NanoBanana</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {creatives.map((c) => {
            const launchable = isCreativeLaunchable(c);
            const selected = selectedCreativeIds.has(c.id);
            // Stage B: only animated rows with parseable scenes get a "View Scenes" button.
            const animatedScenes = c.template_id === 'animated' ? parseAnimatedTemplateData(c.template_data) : null;
            return (
            <div key={c.id} className={`bg-slate-900 border rounded-xl overflow-hidden relative transition-colors ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-800'}`}>
              {/* Winner badge — top-right overlay */}
              {isCreativeWinner(c.id) && (
                <span className="absolute top-2 right-2 z-10 text-[9px] px-2 py-0.5 rounded-full bg-amber-500 text-black font-bold shadow-lg">WINNER</span>
              )}
              {/* Selection checkbox — top-left overlay */}
              {launchable && (
                <button
                  onClick={() => onToggleCreativeSelection(c.id)}
                  className={`absolute top-2 left-2 z-10 w-7 h-7 rounded-md border-2 flex items-center justify-center transition-colors ${
                    selected ? 'bg-blue-600 border-blue-400' : 'bg-slate-900/80 border-slate-600 hover:border-blue-400 backdrop-blur-sm'
                  }`}
                  title={selected ? 'Deselect' : 'Select for launch'}>
                  {selected && (
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )}
              {/* Thumbnail */}
              {c.nb_status === 'completed' && c.file_url && c.type === 'video' && !expiredVideos.has(c.id) ? (
                <video
                  src={mediaUrl(c.file_url)}
                  poster={mediaUrl(c.thumbnail_url)}
                  controls
                  preload="metadata"
                  className="w-full aspect-[9/16] object-contain bg-black"
                  onError={() => onSetExpiredVideos(prev => new Set(prev).add(c.id))}
                />
              ) : c.nb_status === 'completed' && expiredVideos.has(c.id) ? (
                <div className="w-full aspect-[9/16] bg-slate-800 flex items-center justify-center">
                  <div className="text-center px-4">
                    <svg className="w-10 h-10 text-slate-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p className="text-xs text-slate-500">Video Expired</p>
                    <p className="text-[10px] text-slate-600 mt-1">Sora video URLs are temporary and this video is no longer available for download.</p>
                  </div>
                </div>
              ) : c.thumbnail_url || (c.nb_status === 'completed' && c.file_url) ? (
                <img src={mediaUrl(c.thumbnail_url || c.file_url)} alt="" className="w-full aspect-[9/16] object-contain bg-black" />
              ) : (
                <div className="w-full aspect-[9/16] bg-slate-800 flex items-center justify-center">
                  {c.nb_status === 'processing' ? (
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-2" />
                      <p className="text-xs text-purple-400">Generating...</p>
                    </div>
                  ) : (
                    <svg className="w-12 h-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
              )}

              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-white text-sm truncate">{c.title}</h3>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {c.angle && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">{c.angle}</span>
                    )}
                    {c.nb_status && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        c.nb_status === 'completed' ? 'bg-emerald-900/30 text-emerald-400' :
                        c.nb_status === 'processing' ? 'bg-yellow-900/30 text-yellow-400' :
                        c.nb_status === 'failed' ? 'bg-red-900/30 text-red-400' :
                        'bg-slate-800 text-slate-400'
                      }`}>
                        {c.nb_status}
                      </span>
                    )}
                  </div>
                </div>
                {c.description && (
                  <p className="text-xs text-slate-500 mb-2 line-clamp-2">{c.description}</p>
                )}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${
                      c.type === 'video' ? 'bg-blue-900/30 text-blue-400' : 'bg-purple-900/30 text-purple-400'
                    }`}>{c.type}</span>
                    {c.template_id && (() => {
                      const colorClass = COLOR_CLASSES[ENGINE_METADATA[c.template_id]?.uiColor ?? 'slate'] ?? COLOR_CLASSES.slate;
                      return <span className={`text-[10px] px-2 py-0.5 rounded-full ${colorClass}`}>{c.template_id}</span>;
                    })()}
                    {c.format && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400" title="Aspect ratio">{c.format}</span>
                    )}
                    <span className="text-[10px] text-slate-600">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="flex gap-2">
                    {c.nb_status === 'processing' && (
                      <button
                        onClick={() => onPollStatus(c.id)}
                        className="text-[10px] text-blue-400 hover:text-blue-300"
                      >
                        Check Status
                      </button>
                    )}
                    {c.file_url && c.nb_status === 'completed' && (
                      <>
                        <a
                          href={mediaUrl(c.file_url)}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-emerald-400 hover:text-emerald-300"
                        >
                          Download
                        </a>
                        <button
                          onClick={() => {
                            setSelectedCreativeIds(new Set([c.id]));
                            setTimeout(() => onOpenBulkLaunchModal(), 50);
                          }}
                          className="text-[10px] text-blue-400 hover:text-blue-300"
                          title="Launch this creative to Facebook"
                        >
                          Launch
                        </button>
                        {!isCreativeWinner(c.id) ? (
                          <button
                            onClick={() => onShowWinnerModal({ pkg: { title: c.title, script: c.description, angle: c.angle }, idx: 0, creativeId: c.id })}
                            className="text-[10px] text-amber-400 hover:text-amber-300"
                            title="Save as Winner Reference"
                          >
                            Save Winner
                          </button>
                        ) : (
                          <button
                            onClick={() => { const w = winners.find(w => w.creative_id === c.id); if (w) onGenerateMoreLikeThis(w); }}
                            className="text-[10px] text-purple-400 hover:text-purple-300"
                            title="Generate more creatives like this winner"
                          >
                            More Like This
                          </button>
                        )}
                        {animatedScenes && (
                          <button
                            onClick={() => setScenesModalCreativeId(c.id)}
                            className="text-[10px] text-zinc-400 hover:text-white"
                            title="View per-scene breakdown"
                          >
                            View Scenes
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
      {scenesModalParsed && scenesModalCreative && (
        <AnimatedScenesModal
          open={true}
          onClose={() => setScenesModalCreativeId(null)}
          conceptTitle={scenesModalCreative.title || ''}
          concept={scenesModalParsed.templateData.concept}
          scenes={scenesModalParsed.scenes}
        />
      )}
    </>
  );
}
