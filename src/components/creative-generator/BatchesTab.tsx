'use client';

import { cents } from '@/lib/format';
import type { CreativesTab, Product } from '@/components/creative-generator/types';
import type { UseBatchWizardStateReturn } from './hooks/useBatchWizardState';
import { mediaUrl } from './utils';

export interface BatchesTabProps {
  tab: CreativesTab;
  storeFilter: string;
  loading: boolean;
  batchWizard: UseBatchWizardStateReturn;
  products: Product[];
  expiredVideos: Set<string>;
  onSetExpiredVideos: React.Dispatch<React.SetStateAction<Set<string>>>;
  onStartWizard: () => void;
  onWizCreateBatch: () => void;
  onWizRegeneratePrompts: () => void;
  onWizStartGeneration: () => void;
  onLoadBatches: () => void;
  onLoadBatchDetail: (batchId: string) => void;
  onHandleDoubleDown: (batchId: string) => void;
}

export function BatchesTab({
  tab,
  storeFilter,
  loading,
  batchWizard,
  products,
  expiredVideos,
  onSetExpiredVideos,
  onStartWizard,
  onWizCreateBatch,
  onWizRegeneratePrompts,
  onWizStartGeneration,
  onLoadBatches,
  onLoadBatchDetail,
  onHandleDoubleDown,
}: BatchesTabProps) {
  const {
    batches,
    expandedBatch, setExpandedBatch,
    batchCreatives,
    showWizard, setShowWizard,
    wizardStep,
    wizProductId, setWizProductId,
    wizOffer, setWizOffer,
    wizName, setWizName,
    wizVideoPrompts, setWizVideoPrompts,
    wizLoading,
    wizError,
    doublingDown,
  } = batchWizard;

  if (tab !== 'batches') return null;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div />
        <button
          onClick={onStartWizard}
          disabled={!storeFilter}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
        >
          + New Batch
        </button>
      </div>

      {/* Wizard Modal */}
      {showWizard && (
        <div className="bg-slate-900 border border-purple-900/50 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">
              New Batch — Step {wizardStep} of 3
            </h2>
            <button onClick={() => setShowWizard(false)} className="text-slate-400 hover:text-white text-sm">Close</button>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-5">
            {['Review', 'Prompts', 'Generate'].map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  wizardStep > i + 1 ? 'bg-emerald-600 text-white' :
                  wizardStep === i + 1 ? 'bg-purple-600 text-white' :
                  'bg-slate-800 text-slate-500'
                }`}>{i + 1}</div>
                <span className={`text-xs ${wizardStep === i + 1 ? 'text-white' : 'text-slate-500'}`}>{label}</span>
                {i < 2 && <div className="w-8 h-px bg-slate-700" />}
              </div>
            ))}
          </div>

          {wizError && (
            <div className="mb-4 px-3 py-2 bg-red-900/20 border border-red-800 rounded-lg text-xs text-red-400">{wizError}</div>
          )}

          {/* Step 1: Review */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase mb-1">Batch Name *</label>
                  <input
                    type="text"
                    value={wizName}
                    onChange={(e) => setWizName(e.target.value)}
                    placeholder="e.g. Product X - UGC Test"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase mb-1">Product</label>
                  <select
                    value={wizProductId}
                    onChange={(e) => setWizProductId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="">Select product...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.title} — {cents(p.price_cents)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1">Offer / Bundle</label>
                <input
                  type="text"
                  value={wizOffer}
                  onChange={(e) => setWizOffer(e.target.value)}
                  placeholder="e.g. Buy 2 Get 1 Free, 50% Off Today"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                <p className="text-[10px] text-slate-500 uppercase mb-1">Winning Angles</p>
                <p className="text-xs text-slate-400">Auto-extracted from your top performing ads — AI will analyze what concepts are converting and double down on them.</p>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onWizCreateBatch}
                  disabled={!wizName || wizLoading}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                >
                  {wizLoading ? 'Generating Prompts...' : 'Next: Generate Prompts →'}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Review/Edit Prompts */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Video Prompts (Sora) — 5 videos</h3>
                {wizVideoPrompts.map((p, i) => (
                  <div key={i} className="mb-3 p-3 bg-slate-800/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400">V{i + 1}</span>
                      <input
                        type="text"
                        value={p.angle}
                        onChange={(e) => {
                          const updated = [...wizVideoPrompts];
                          updated[i] = { ...updated[i], angle: e.target.value };
                          setWizVideoPrompts(updated);
                        }}
                        className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[10px] text-purple-400 w-32"
                      />
                      <input
                        type="text"
                        value={p.headline}
                        onChange={(e) => {
                          const updated = [...wizVideoPrompts];
                          updated[i] = { ...updated[i], headline: e.target.value };
                          setWizVideoPrompts(updated);
                        }}
                        placeholder="Headline"
                        className="flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white"
                      />
                    </div>
                    <textarea
                      value={p.prompt}
                      onChange={(e) => {
                        const updated = [...wizVideoPrompts];
                        updated[i] = { ...updated[i], prompt: e.target.value };
                        setWizVideoPrompts(updated);
                      }}
                      rows={4}
                      className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-slate-300 resize-y mb-1"
                    />
                    <textarea
                      value={p.adCopy}
                      onChange={(e) => {
                        const updated = [...wizVideoPrompts];
                        updated[i] = { ...updated[i], adCopy: e.target.value };
                        setWizVideoPrompts(updated);
                      }}
                      rows={1}
                      placeholder="Ad copy..."
                      className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[10px] text-slate-400 resize-none"
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={onWizRegeneratePrompts}
                  disabled={wizLoading}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs rounded-lg"
                >
                  {wizLoading ? 'Regenerating...' : 'Regenerate Prompts'}
                </button>
                <button
                  onClick={onWizStartGeneration}
                  disabled={wizLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                >
                  {wizLoading ? 'Starting...' : 'Start Generation →'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Generating */}
          {wizardStep === 3 && (
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-400 mx-auto mb-4" />
              <p className="text-white font-medium mb-1">Generation Started</p>
              <p className="text-xs text-slate-400 mb-4">{wizVideoPrompts.length} video{wizVideoPrompts.length !== 1 ? 's' : ''} are being generated with enriched prompts.</p>
              <p className="text-xs text-slate-500">You can close this modal. Check progress in the batch list below.</p>
              <button
                onClick={() => { setShowWizard(false); onLoadBatches(); }}
                className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}

      {/* Batch List */}
      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
      ) : !storeFilter ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">Select a store to view batches</p>
        </div>
      ) : batches.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No batches yet</p>
          <p className="text-xs text-slate-500 mt-1">Create a batch to auto-generate 5 videos from winning ad patterns</p>
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map(b => {
            let angles: string[] = [];
            try { angles = b.winning_angles ? JSON.parse(b.winning_angles) : []; } catch { angles = []; }
            const isExpanded = expandedBatch === b.id;
            const bc = batchCreatives[b.id] || [];

            return (
              <div key={b.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => {
                    if (isExpanded) { setExpandedBatch(null); }
                    else { setExpandedBatch(b.id); onLoadBatchDetail(b.id); }
                  }}
                  className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">#{b.batch_number}</span>
                      <h3 className="text-sm font-semibold text-white truncate">{b.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        b.status === 'active' ? 'bg-emerald-900/30 text-emerald-400' :
                        b.status === 'generating' || b.status === 'generating_prompts' ? 'bg-yellow-900/30 text-yellow-400' :
                        b.status === 'prompts_ready' ? 'bg-blue-900/30 text-blue-400' :
                        b.status === 'failed' ? 'bg-red-900/30 text-red-400' :
                        'bg-slate-800 text-slate-400'
                      }`}>{b.status}</span>
                      {b.parent_batch_id && (
                        <span className="text-[10px] text-slate-500">doubled down</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                      {b.product_title && <span>{b.product_title}</span>}
                      {angles.length > 0 && <span>Angles: {angles.join(', ')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-5 flex-shrink-0 ml-4">
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500">Videos</p>
                      <p className="text-sm font-semibold text-white">{b.completed_videos}/{b.total_videos}</p>
                    </div>
                    {/* Images removed — videos only */}
                    {b.avg_roas > 0 && (
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500">ROAS</p>
                        <p className={`text-sm font-semibold ${b.avg_roas >= 2 ? 'text-emerald-400' : b.avg_roas >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {b.avg_roas.toFixed(2)}x
                        </p>
                      </div>
                    )}
                    <svg className={`w-5 h-5 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Expanded batch detail */}
                {isExpanded && (
                  <div className="border-t border-slate-800 px-5 py-4">
                    {/* Pipeline progress */}
                    <div className="flex items-center gap-1 mb-4 text-[10px]">
                      {['Review', 'Prompts', 'Videos', 'Track', 'Double Down'].map((step, i) => {
                        const statusOrder: Record<string, number> = {
                          pending: 0, generating_prompts: 1, prompts_ready: 2,
                          generating: 3, active: 4, completed: 5, failed: -1,
                        };
                        const stepThresholds = [1, 2, 4, 4, 5]; // min ordinal for each step to be "done"
                        const currentOrdinal = statusOrder[b.status] ?? -1;
                        const isFailed = b.status === 'failed';
                        const isDone = !isFailed && currentOrdinal >= stepThresholds[i];
                        return (
                          <div key={step} className="flex items-center gap-1">
                            <span className={`px-2 py-1 rounded ${
                              isFailed ? 'bg-red-900/30 text-red-400' :
                              isDone ? 'bg-emerald-900/30 text-emerald-400' :
                              'bg-slate-800 text-slate-500'
                            }`}>{step}</span>
                            {i < 4 && <span className="text-slate-700">→</span>}
                          </div>
                        );
                      })}
                    </div>

                    {/* Videos */}
                    {bc.filter(c => c.type === 'video').length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Videos</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                          {bc.filter(c => c.type === 'video').map(c => (
                            <div key={c.id} className="bg-slate-800/50 rounded-lg overflow-hidden">
                              <div className="aspect-[9/16] bg-black flex items-center justify-center relative">
                                {c.nb_status === 'completed' && c.file_url && !expiredVideos.has(c.id) ? (
                                  <video
                                    src={mediaUrl(c.file_url)}
                                    poster={mediaUrl(c.thumbnail_url)}
                                    controls
                                    preload="metadata"
                                    className="w-full h-full object-contain"
                                    onError={() => onSetExpiredVideos(prev => new Set(prev).add(c.id))}
                                  />
                                ) : c.nb_status === 'completed' && expiredVideos.has(c.id) ? (
                                  <div className="text-center px-2">
                                    <svg className="w-8 h-8 text-slate-600 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    <p className="text-[10px] text-slate-500">Video expired</p>
                                    <p className="text-[9px] text-slate-600">Sora URLs are temporary</p>
                                  </div>
                                ) : c.nb_status === 'processing' ? (
                                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-400" />
                                ) : c.nb_status === 'failed' ? (
                                  <span className="text-[10px] text-red-400">Failed</span>
                                ) : (
                                  <span className="text-[10px] text-slate-600">Pending</span>
                                )}
                              </div>
                              <div className="p-2">
                                <p className="text-[10px] text-white truncate">{c.title}</p>
                                {c.angle && <span className="text-[9px] text-purple-400">{c.angle}</span>}
                                <div className="flex items-center justify-between mt-1">
                                  <span className={`text-[9px] ${
                                    c.nb_status === 'completed' ? 'text-emerald-400' :
                                    c.nb_status === 'processing' ? 'text-yellow-400' :
                                    'text-red-400'
                                  }`}>{c.nb_status}</span>
                                  {c.file_url && c.nb_status === 'completed' && (
                                    <a href={mediaUrl(c.file_url)} download className="text-[9px] text-blue-400 hover:text-blue-300">Download</a>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      {(b.status === 'generating' || b.status === 'active') && (
                        <button
                          onClick={() => onLoadBatchDetail(b.id)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium rounded-lg"
                        >
                          Refresh Status
                        </button>
                      )}
                      {b.status === 'active' && (
                        <button
                          onClick={() => onHandleDoubleDown(b.id)}
                          disabled={doublingDown === b.id}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg"
                        >
                          {doublingDown === b.id ? 'Doubling Down...' : 'Double Down on Winners'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
