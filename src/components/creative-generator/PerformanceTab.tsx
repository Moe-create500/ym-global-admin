'use client';

import { cents } from '@/lib/format';
import type { Ad, CreativesTab } from '@/components/creative-generator/types';
import type { UsePerformanceStateReturn } from './hooks/usePerformanceState';
import { formatCta } from './utils';

export interface PerformanceTabProps {
  tab: CreativesTab;
  storeFilter: string;
  loading: boolean;
  performance: UsePerformanceStateReturn;
  onToggleExpand: (id: string) => void;
  onAnalyzeAdVideo: (ad: Ad, file?: File) => void;
  onOpenGenerateFromWinner: (ad: Ad) => void;
  onSetRecreateAd: React.Dispatch<React.SetStateAction<Ad | null>>;
  onSetRecreateProductId: React.Dispatch<React.SetStateAction<string>>;
}

export function PerformanceTab({
  tab,
  storeFilter,
  loading,
  performance,
  onToggleExpand,
  onAnalyzeAdVideo,
  onOpenGenerateFromWinner,
  onSetRecreateAd,
  onSetRecreateProductId,
}: PerformanceTabProps) {
  const {
    adSets,
    dateRange, setDateRange,
    sortBy, setSortBy,
    expanded,
    selectedAd, setSelectedAd,
    analyzingAdId,
    adAnalysis,
  } = performance;

  if (tab !== 'performance') return null;

  const totalSpend = adSets.reduce((s, a) => s + a.totalSpend, 0);
  const totalPurchases = adSets.reduce((s, a) => s + a.totalPurchases, 0);
  const winnerCount = adSets.reduce((s, a) => s + a.ads.filter(ad => ad.isWinner).length, 0);

  return (
    <>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1 bg-slate-900 p-0.5 rounded-lg">
          {[{ label: '7D', value: '7' }, { label: '14D', value: '14' }, { label: '30D', value: '30' }, { label: '60D', value: '60' }].map(opt => (
            <button
              key={opt.value}
              onClick={() => setDateRange(opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${dateRange === opt.value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none"
        >
          <option value="spend">Sort by Spend</option>
          <option value="roas">Sort by ROAS</option>
          <option value="purchases">Sort by Purchases</option>
        </select>
      </div>

      {/* Summary KPIs */}
      {adSets.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase mb-1">Total Spend</p>
            <p className="text-xl font-bold text-white">{cents(totalSpend)}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase mb-1">Purchases</p>
            <p className="text-xl font-bold text-emerald-400">{totalPurchases}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase mb-1">Ad Sets</p>
            <p className="text-xl font-bold text-white">{adSets.length}</p>
          </div>
          <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-4">
            <p className="text-xs text-emerald-500 uppercase mb-1">Winners</p>
            <p className="text-xl font-bold text-emerald-400">{winnerCount}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
      ) : !storeFilter ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">Select a store to view ad performance</p>
        </div>
      ) : adSets.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No ad data for this period</p>
          <p className="text-xs text-slate-500 mt-1">Sync Facebook ads first from the Connect page</p>
        </div>
      ) : (
        <div className="space-y-3">
          {adSets.map(set => (
            <div key={set.adSetId} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              {/* Ad Set Header */}
              <button
                onClick={() => onToggleExpand(set.adSetId)}
                className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-white truncate">{set.adSetName}</h3>
                    {set.ads.some(a => a.isWinner) && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 flex-shrink-0">
                        {set.ads.filter(a => a.isWinner).length} winner{set.ads.filter(a => a.isWinner).length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 truncate">{set.campaignName}</p>
                </div>
                <div className="flex items-center gap-4 sm:gap-6 flex-shrink-0 ml-4">
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500">Spend</p>
                    <p className="text-sm font-semibold text-white">{cents(set.totalSpend)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500">ROAS</p>
                    <p className={`text-sm font-semibold ${set.roas >= 2 ? 'text-emerald-400' : set.roas >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {set.roas.toFixed(2)}x
                    </p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-[10px] text-slate-500">CPA</p>
                    <p className="text-sm font-semibold text-white">{set.cpa > 0 ? cents(set.cpa) : '-'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500">Purch</p>
                    <p className="text-sm font-semibold text-white">{set.totalPurchases}</p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-[10px] text-slate-500">Ads</p>
                    <p className="text-sm font-semibold text-slate-400">{set.ads.length}</p>
                  </div>
                  <svg className={`w-5 h-5 text-slate-500 transition-transform ${expanded[set.adSetId] ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Expanded Ads */}
              {expanded[set.adSetId] && (
                <div className="border-t border-slate-800 px-5 py-3 space-y-2">
                  {set.ads.map(ad => (
                    <div key={ad.adId}>
                      {/* Ad row — clickable to expand full context */}
                      <div
                        onClick={() => setSelectedAd(selectedAd?.adId === ad.adId ? null : ad)}
                        className={`flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-colors ${
                          ad.isWinner ? 'bg-emerald-950/20 border border-emerald-900/30' : 'bg-slate-800/30 hover:bg-slate-800/50'
                        }`}
                      >
                        {/* Creative thumbnail */}
                        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-slate-800">
                          {ad.creativeUrl ? (
                            <img src={ad.creativeUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Ad info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-white truncate">{ad.adName}</p>
                            {ad.isWinner && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 flex-shrink-0">Winner</span>
                            )}
                            {ad.status && (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${
                                ad.status === 'ACTIVE' ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-700 text-slate-400'
                              }`}>{ad.status}</span>
                            )}
                          </div>
                          {ad.headline && <p className="text-xs text-slate-300 mt-0.5 truncate">{ad.headline}</p>}
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {ad.impressions.toLocaleString()} impr / {ad.clicks.toLocaleString()} clicks / {ad.reach.toLocaleString()} reach
                          </p>
                        </div>

                        {/* Metrics */}
                        <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0 flex-wrap justify-end">
                          <div className="text-right">
                            <p className="text-[10px] text-slate-500">Spend</p>
                            <p className="text-xs font-semibold text-white">{cents(ad.spend)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-slate-500">ROAS</p>
                            <p className={`text-xs font-semibold ${ad.roas >= 2 ? 'text-emerald-400' : ad.roas >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {ad.roas.toFixed(2)}x
                            </p>
                          </div>
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-slate-500">CPA</p>
                            <p className="text-xs font-semibold text-white">{ad.cpa > 0 ? cents(ad.cpa) : '-'}</p>
                          </div>
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-slate-500">CTR</p>
                            <p className="text-xs font-semibold text-blue-400">{ad.ctr.toFixed(2)}%</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-slate-500">Purch</p>
                            <p className="text-xs font-semibold text-emerald-400">{ad.purchases}</p>
                          </div>
                          <svg className={`w-4 h-4 text-slate-500 transition-transform ${selectedAd?.adId === ad.adId ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Full Ad Context — expanded detail panel */}
                      {selectedAd?.adId === ad.adId && (
                        <div className="ml-0 sm:ml-20 mt-1 mb-3 p-4 bg-slate-800/60 rounded-lg border border-slate-700/50">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Left: Creative Context */}
                            <div>
                              <h4 className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Ad Creative</h4>
                              {ad.creativeUrl && (
                                <img src={ad.creativeUrl} alt="" className="w-full max-w-xs rounded-lg mb-3" />
                              )}
                              {ad.headline && (
                                <div className="mb-2">
                                  <p className="text-[10px] text-slate-500 uppercase">Headline</p>
                                  <p className="text-sm text-white font-medium">{ad.headline}</p>
                                </div>
                              )}
                              {ad.body && (
                                <div className="mb-2">
                                  <p className="text-[10px] text-slate-500 uppercase">Primary Text</p>
                                  <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{ad.body}</p>
                                </div>
                              )}
                              {ad.cta && (
                                <div className="mb-2">
                                  <p className="text-[10px] text-slate-500 uppercase">CTA Button</p>
                                  <span className="inline-block px-3 py-1 bg-blue-600 text-white text-xs rounded mt-1">{formatCta(ad.cta)}</span>
                                </div>
                              )}
                              {ad.linkUrl && (
                                <div className="mb-2">
                                  <p className="text-[10px] text-slate-500 uppercase">Destination URL</p>
                                  <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 break-all">{ad.linkUrl}</a>
                                </div>
                              )}
                              {!ad.headline && !ad.body && !ad.cta && (
                                <p className="text-xs text-slate-500 italic">No creative context synced yet. Run a Facebook sync to pull full ad details.</p>
                              )}
                            </div>

                            {/* Right: Extended Metrics */}
                            <div>
                              <h4 className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Performance Metrics</h4>
                              <div className="grid grid-cols-3 gap-3">
                                <div className="bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[10px] text-slate-500">Spend</p>
                                  <p className="text-sm font-bold text-white">{cents(ad.spend)}</p>
                                </div>
                                <div className="bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[10px] text-slate-500">Revenue</p>
                                  <p className="text-sm font-bold text-emerald-400">{cents(ad.purchaseValue)}</p>
                                </div>
                                <div className="bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[10px] text-slate-500">ROAS</p>
                                  <p className={`text-sm font-bold ${ad.roas >= 2 ? 'text-emerald-400' : ad.roas >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>{ad.roas.toFixed(2)}x</p>
                                </div>
                                <div className="bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[10px] text-slate-500">Purchases</p>
                                  <p className="text-sm font-bold text-white">{ad.purchases}</p>
                                </div>
                                <div className="bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[10px] text-slate-500">CPA</p>
                                  <p className="text-sm font-bold text-white">{ad.cpa > 0 ? cents(ad.cpa) : '-'}</p>
                                </div>
                                <div className="bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[10px] text-slate-500">CTR</p>
                                  <p className="text-sm font-bold text-blue-400">{ad.ctr.toFixed(2)}%</p>
                                </div>
                                <div className="bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[10px] text-slate-500">CPM</p>
                                  <p className="text-sm font-bold text-white">{cents(ad.cpm)}</p>
                                </div>
                                <div className="bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[10px] text-slate-500">CPC</p>
                                  <p className="text-sm font-bold text-white">{cents(ad.cpc)}</p>
                                </div>
                                <div className="bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[10px] text-slate-500">Reach</p>
                                  <p className="text-sm font-bold text-white">{ad.reach.toLocaleString()}</p>
                                </div>
                              </div>

                              {/* Action buttons */}
                              <div className="flex flex-wrap gap-2 mt-4">
                                {ad.previewUrl && (
                                  <a
                                    href={ad.previewUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium rounded-lg"
                                  >
                                    View Ad Preview
                                  </a>
                                )}
                                {ad.fbVideoId ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onAnalyzeAdVideo(ad); }}
                                    disabled={analyzingAdId === ad.adId}
                                    className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg"
                                  >
                                    {analyzingAdId === ad.adId ? 'Analyzing...' : adAnalysis[ad.adId] ? 'Re-Analyze DNA' : 'Analyze Video DNA'}
                                  </button>
                                ) : (
                                  <label className={`px-3 py-1.5 ${analyzingAdId === ad.adId ? 'bg-orange-400 cursor-wait' : 'bg-orange-600 hover:bg-orange-700 cursor-pointer'} text-white text-[10px] font-medium rounded-lg`}>
                                    {analyzingAdId === ad.adId ? 'Analyzing...' : adAnalysis[ad.adId] ? 'Re-Analyze DNA' : 'Upload Video to Analyze'}
                                    <input
                                      type="file"
                                      accept="video/*"
                                      className="hidden"
                                      disabled={analyzingAdId === ad.adId}
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) onAnalyzeAdVideo(ad, f);
                                        e.target.value = '';
                                      }}
                                    />
                                  </label>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); onOpenGenerateFromWinner(ad); }}
                                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-medium rounded-lg"
                                >
                                  Generate Similar
                                </button>
                                {adAnalysis[ad.adId] && !adAnalysis[ad.adId].startsWith('Error') && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onSetRecreateAd(ad); onSetRecreateProductId(''); }}
                                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-[10px] font-medium rounded-lg"
                                  >
                                    Recreate with Product
                                  </button>
                                )}
                              </div>

                              {/* Video Analysis Display */}
                              {adAnalysis[ad.adId] && (
                                <div className={`mt-4 p-4 bg-slate-900/80 rounded-lg border ${adAnalysis[ad.adId].startsWith('Error') || adAnalysis[ad.adId].startsWith('Analysis timed out') ? 'border-red-900/30' : 'border-orange-900/30'}`}>
                                  <h4 className="text-[10px] text-orange-400 uppercase font-semibold mb-2">Video Creative DNA (Twelve Labs)</h4>
                                  <div className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                                    {adAnalysis[ad.adId]}
                                  </div>
                                  {/* Show file upload fallback when auto-resolve fails */}
                                  {(adAnalysis[ad.adId].includes('upload') || adAnalysis[ad.adId].includes('No video found') || adAnalysis[ad.adId].includes('Failed to fetch') || adAnalysis[ad.adId].includes('timed out')) && (
                                    <label className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-medium rounded-lg cursor-pointer">
                                      Upload Video File to Analyze
                                      <input
                                        type="file"
                                        accept="video/*"
                                        className="hidden"
                                        disabled={analyzingAdId === ad.adId}
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) onAnalyzeAdVideo(ad, f);
                                          e.target.value = '';
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
