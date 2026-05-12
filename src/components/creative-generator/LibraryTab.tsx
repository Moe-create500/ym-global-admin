'use client';

import { useState } from 'react';
import type { CreativesTab } from '@/components/creative-generator/types';
import type { UseLibraryStateReturn } from './hooks/useLibraryState';
import { mediaUrl } from './utils';
import { groupEnginesByCategory } from '@/lib/engine-metadata';
import { parseAnimatedTemplateData } from '@/lib/animated-template-data';
import { AnimatedScenesModal } from './AnimatedScenesModal';

export interface ShowWinnerModalArg {
  pkg: any;
  idx: number;
  creativeId?: string;
}

export interface LibraryTabProps {
  tab: CreativesTab;
  storeFilter: string;
  library: UseLibraryStateReturn;
  winners: any[];
  onLoadLibrary: () => void;
  onGenerateMoreLikeThis: (winner: any) => void;
  onDuplicateSetup: (pkg: any) => void;
  onRemoveWinner: (winnerId: string) => void;
  onShowWinnerModal: (arg: ShowWinnerModalArg) => void;
  onSetTab: React.Dispatch<React.SetStateAction<CreativesTab>>;
  onSetSelectedCreativeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpenBulkLaunchModal: () => void;
}

export function LibraryTab({
  tab,
  storeFilter,
  library,
  winners,
  onLoadLibrary,
  onGenerateMoreLikeThis,
  onDuplicateSetup,
  onRemoveWinner,
  onShowWinnerModal,
  onSetTab,
  onSetSelectedCreativeIds,
  onOpenBulkLaunchModal,
}: LibraryTabProps) {
  const {
    libraryPackages,
    libraryCreatives,
    libraryWinners,
    libraryCounts,
    libraryLoading,
    librarySearch, setLibrarySearch,
    libraryFilters, setLibraryFilters,
    expandedLibraryPkg, setExpandedLibraryPkg,
  } = library;

  // Stage B: which animated creative's per-scene modal is open (null = closed).
  const [scenesModalCreativeId, setScenesModalCreativeId] = useState<string | null>(null);
  const scenesModalCreative = scenesModalCreativeId
    ? libraryCreatives.find((c: any) => c.id === scenesModalCreativeId)
    : null;
  const scenesModalParsed = scenesModalCreative
    ? parseAnimatedTemplateData(scenesModalCreative.template_data)
    : null;

  if (tab !== 'library') return null;

  return (
    <>
      {!storeFilter ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">Select a store to view your creative library</p>
        </div>
      ) : libraryLoading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400" /></div>
      ) : (
        <div className="space-y-6">
          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{libraryCounts.totalPackages}</p>
              <p className="text-[10px] text-slate-500 uppercase">Generations</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{libraryCounts.totalCreatives}</p>
              <p className="text-[10px] text-slate-500 uppercase">Creatives</p>
            </div>
            <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{libraryCounts.totalWinners}</p>
              <p className="text-[10px] text-amber-500 uppercase">Winners</p>
            </div>
          </div>

          {/* Filters + Search */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-[10px] text-slate-500 uppercase mb-1 block">Search</label>
                <input
                  value={librarySearch}
                  onChange={e => setLibrarySearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && onLoadLibrary()}
                  placeholder="Search title, concept, hook..."
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase mb-1 block">Type</label>
                <select value={libraryFilters.contentType || ''} onChange={e => setLibraryFilters(f => ({ ...f, contentType: e.target.value || undefined }))}
                  className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
                  <option value="">All</option>
                  <option value="video">Video</option>
                  <option value="image">Image</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase mb-1 block">Funnel</label>
                <select value={libraryFilters.funnelStage || ''} onChange={e => setLibraryFilters(f => ({ ...f, funnelStage: e.target.value || undefined }))}
                  className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
                  <option value="">All</option>
                  <option value="tof">TOF</option>
                  <option value="mof">MOF</option>
                  <option value="bof">BOF</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase mb-1 block">Provider</label>
                <select value={libraryFilters.provider || ''} onChange={e => setLibraryFilters(f => ({ ...f, provider: e.target.value || undefined }))}
                  className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
                  <option value="">All</option>
                  {[
                    ...groupEnginesByCategory('video', { includePseudo: true }),
                    ...groupEnginesByCategory('image', { includePseudo: true }),
                  ].map((group) => (
                    <optgroup key={group.category} label={group.label}>
                      {group.engines.map((e) => (
                        <option key={e.key} value={e.key}>{e.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!libraryFilters.winnerOnly}
                  onChange={e => setLibraryFilters(f => ({ ...f, winnerOnly: e.target.checked || undefined }))}
                  className="rounded bg-slate-700 border-slate-600" />
                <span className="text-[10px] text-amber-400">Winners only</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!libraryFilters.launchedOnly}
                  onChange={e => setLibraryFilters(f => ({ ...f, launchedOnly: e.target.checked || undefined }))}
                  className="rounded bg-slate-700 border-slate-600" />
                <span className="text-[10px] text-blue-400">Launched only</span>
              </label>
              <button onClick={onLoadLibrary}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded-lg">
                Search
              </button>
            </div>
          </div>

          {/* ── Winners Section ── */}
          {libraryWinners.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-amber-400 mb-3">Saved Winners ({libraryWinners.length})</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {winners.map(w => (
                  <div key={w.id} className="bg-slate-900 border border-amber-800/40 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500 text-black font-bold">WINNER</span>
                      <span className="text-[10px] text-slate-500">{new Date(w.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-white mb-1 truncate">{w.title || 'Untitled'}</h4>
                    <p className="text-xs text-slate-500 mb-2 truncate">{w.concept || w.hook_pattern || ''}</p>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {w.content_type && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{w.content_type}</span>}
                      {w.creative_type && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-900/30 text-purple-400">{w.creative_type}</span>}
                      {w.funnel_stage && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-900/30 text-blue-400">{w.funnel_stage.toUpperCase()}</span>}
                      {w.provider && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-900/30 text-cyan-400">{w.provider}</span>}
                      {w.performance_roas && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400">{w.performance_roas}x ROAS</span>}
                    </div>
                    {w.energy_tone && <p className="text-[10px] text-slate-500 mb-1">Tone: {w.energy_tone}</p>}
                    {w.hook_pattern && <p className="text-[10px] text-slate-500 mb-1 truncate">Hook: {w.hook_pattern}</p>}
                    {w.user_notes && <p className="text-[10px] text-amber-400/70 mb-2 italic">"{w.user_notes}"</p>}
                    <div className="flex gap-2 pt-2 border-t border-slate-800">
                      <button onClick={() => onGenerateMoreLikeThis(w)}
                        className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-medium rounded-lg flex-1">
                        More Like This
                      </button>
                      <button onClick={() => onDuplicateSetup(w)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-medium rounded-lg border border-slate-700">
                        Use Setup
                      </button>
                      <button onClick={() => onRemoveWinner(w.id)}
                        className="px-2 py-1 text-red-400 hover:text-red-300 text-[10px]">
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Past Generations Section ── */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Past Generations ({libraryPackages.length})</h3>
            {libraryPackages.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
                <p className="text-slate-500 text-sm">No past generations found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {libraryPackages.map(lp => (
                  <div key={lp.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                    <button onClick={() => setExpandedLibraryPkg(expandedLibraryPkg === lp.id ? null : lp.id)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${lp.content_type === 'video' ? 'bg-blue-900/30 text-blue-400' : 'bg-orange-900/30 text-orange-400'}`}>{lp.content_type}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-900/30 text-purple-400">{lp.creative_type}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{lp.funnel_stage?.toUpperCase()}</span>
                          <span className="text-[9px] text-slate-500">x{lp.quantity}</span>
                          {lp.hasWinner && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500 text-black font-bold">WINNER</span>}
                          {lp.version > 1 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-900/30 text-purple-400">v{lp.version}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white">{lp.product_title || 'No product'}</span>
                          {lp.offer && <span className="text-[10px] text-emerald-400">{lp.offer}</span>}
                          <span className="text-[10px] text-slate-600">{new Date(lp.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <svg className={`w-4 h-4 text-slate-500 transition-transform ${expandedLibraryPkg === lp.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedLibraryPkg === lp.id && (
                      <div className="border-t border-slate-800 px-4 py-3 space-y-3">
                        {/* Package items */}
                        {(lp.packages || []).map((lpkg: any, li: number) => (
                          <div key={li} className="bg-slate-800/50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">#{li + 1}</span>
                                <span className="text-xs text-white font-medium truncate">{lpkg.title || `Package ${li + 1}`}</span>
                              </div>
                              <div className="flex gap-1">
                                <button onClick={() => onShowWinnerModal({ pkg: lpkg, idx: li })}
                                  className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-medium rounded-lg">
                                  Save Winner
                                </button>
                                <button onClick={() => navigator.clipboard.writeText(JSON.stringify(lpkg, null, 2))}
                                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[9px] rounded-lg">
                                  Export
                                </button>
                              </div>
                            </div>
                            {lpkg.angle && <p className="text-[10px] text-slate-400 mb-1">Angle: {lpkg.angle || lpkg.conceptAngle}</p>}
                            {lpkg.hook && <p className="text-[10px] text-purple-300 mb-1">Hook: {lpkg.hook}</p>}
                            {lpkg.hookText && <p className="text-[10px] text-pink-300 mb-1">Hook: {lpkg.hookText}</p>}
                            {lpkg.script && <p className="text-[10px] text-slate-400 line-clamp-3">{lpkg.script}</p>}
                            {lpkg.headline && <p className="text-[10px] text-white font-medium">{lpkg.headline}</p>}
                            {lpkg.cta && <p className="text-[10px] text-emerald-400 mt-1">CTA: {lpkg.cta}</p>}
                            {lpkg.ctaText && <p className="text-[10px] text-emerald-400 mt-1">CTA: {lpkg.ctaText}</p>}
                          </div>
                        ))}
                        {/* Actions row */}
                        <div className="flex gap-2 pt-2 border-t border-slate-800">
                          <button onClick={() => onDuplicateSetup(lp)}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-medium rounded-lg">
                            Duplicate Setup
                          </button>
                          <button onClick={() => { onDuplicateSetup(lp); onSetTab('generator'); }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium rounded-lg">
                            Regenerate
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Rendered Creatives Section ── */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Rendered Creatives ({libraryCreatives.length})</h3>
            {libraryCreatives.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
                <p className="text-slate-500 text-sm">No rendered creatives found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {libraryCreatives.slice(0, 40).map(lc => {
                  // Stage B: only animated rows with parseable scenes get a "View Scenes" button.
                  const animatedScenes = lc.template_id === 'animated' ? parseAnimatedTemplateData(lc.template_data) : null;
                  return (
                  <div key={lc.id} className={`bg-slate-900 border rounded-xl overflow-hidden ${lc.isWinner ? 'border-amber-700/50' : 'border-slate-800'}`}>
                    {/* Thumbnail */}
                    {lc.file_url && lc.nb_status === 'completed' ? (
                      lc.type === 'video' ? (
                        <video src={mediaUrl(lc.file_url)} poster={mediaUrl(lc.thumbnail_url)} controls preload="none" className="w-full aspect-square object-contain bg-black" />
                      ) : (
                        <img src={mediaUrl(lc.file_url)} alt="" className="w-full aspect-square object-contain bg-black" />
                      )
                    ) : (
                      <div className="w-full aspect-square bg-slate-800 flex items-center justify-center">
                        <span className={`text-xs ${lc.nb_status === 'processing' ? 'text-yellow-400' : lc.nb_status === 'failed' ? 'text-red-400' : 'text-slate-500'}`}>{lc.nb_status || 'no media'}</span>
                      </div>
                    )}
                    <div className="p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        {lc.isWinner && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500 text-black font-bold">W</span>}
                        <h4 className="text-xs text-white font-medium truncate">{lc.title}</h4>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${lc.type === 'video' ? 'bg-blue-900/30 text-blue-400' : 'bg-purple-900/30 text-purple-400'}`}>{lc.type}</span>
                        {lc.template_id && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{lc.template_id}</span>}
                        {lc.format && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400">{lc.format}</span>}
                      </div>
                      <div className="flex gap-1.5">
                        {lc.file_url && lc.nb_status === 'completed' && (
                          <a href={mediaUrl(lc.file_url)} download target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-emerald-400 hover:text-emerald-300">Download</a>
                        )}
                        {!lc.isWinner ? (
                          <button onClick={() => onShowWinnerModal({ pkg: { title: lc.title, script: lc.description, angle: lc.angle }, idx: 0, creativeId: lc.id })}
                            className="text-[10px] text-amber-400 hover:text-amber-300">Save Winner</button>
                        ) : (
                          <button onClick={() => { const w = winners.find(w => w.creative_id === lc.id); if (w) onGenerateMoreLikeThis(w); }}
                            className="text-[10px] text-purple-400 hover:text-purple-300">More Like This</button>
                        )}
                        <button onClick={() => {
                          onSetSelectedCreativeIds(new Set([lc.id]));
                          onSetTab('generated');
                          setTimeout(() => onOpenBulkLaunchModal(), 100);
                        }}
                          className="text-[10px] text-blue-400 hover:text-blue-300">Relaunch</button>
                        {animatedScenes && (
                          <button onClick={() => setScenesModalCreativeId(lc.id)}
                            className="text-[10px] text-zinc-400 hover:text-white">View Scenes</button>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
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
