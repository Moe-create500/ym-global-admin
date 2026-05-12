'use client';

import type { UseBulkSelectionStateReturn } from './hooks/useBulkSelectionState';
import type { UsePageSelectorStateReturn } from './hooks/usePageSelectorState';
import type { UseScaleModeStateReturn } from './hooks/useScaleModeState';

export interface BulkLaunchModalProps {
  bulkSelection: UseBulkSelectionStateReturn;
  pageSelector: UsePageSelectorStateReturn;
  scaleMode: UseScaleModeStateReturn;
  fbProfiles: any[];
  getSelectedConcepts: () => string[];
  onLoadCampaignsForProfile: (profileId: string) => void;
  onLoadAdSetsForCampaign: (profileId: string, campaignId: string) => void;
  onLoadPagesForProfile: (profileId: string) => void;
  onBulkLaunchToFB: () => void;
}

export function BulkLaunchModal({
  bulkSelection,
  pageSelector,
  scaleMode,
  fbProfiles,
  getSelectedConcepts,
  onLoadCampaignsForProfile,
  onLoadAdSetsForCampaign,
  onLoadPagesForProfile,
  onBulkLaunchToFB,
}: BulkLaunchModalProps) {
  const {
    selectedCreativeIds,
    bulkLaunching,
    bulkLaunchResult,
    bulkLaunchError,
    bulkLaunchLinkUrl, setBulkLaunchLinkUrl,
    bulkLaunchProfileId, setBulkLaunchProfileId,
    showBulkLaunchModal, setShowBulkLaunchModal,
    bulkLaunchProgress,
  } = bulkSelection;
  const {
    availablePages,
    loadingPages,
    selectedPageId, setSelectedPageId,
    currentProfilePageId,
    currentProfilePageName,
    savePageAsDefault, setSavePageAsDefault,
  } = pageSelector;
  const {
    launchMode, setLaunchMode,
    fbCampaigns,
    selectedCampaignId, setSelectedCampaignId,
    fbAdSets,
    loadingCampaigns,
    loadingAdSets,
    conceptAdSetMap, setConceptAdSetMap,
    budgetStrategy, setBudgetStrategy,
    dailyBudgetCents, setDailyBudgetCents,
    adSetCount, setAdSetCount,
    distribution, setDistribution,
  } = scaleMode;

  const conceptCount = getSelectedConcepts().length;
  const effectiveAdSetCount = adSetCount ?? conceptCount;

  if (!showBulkLaunchModal) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !bulkLaunching && setShowBulkLaunchModal(false)}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Launch to Facebook Ads</h3>
          <button onClick={() => !bulkLaunching && setShowBulkLaunchModal(false)} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="mb-4 p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg">
          <p className="text-sm text-blue-300">{selectedCreativeIds.size} creative{selectedCreativeIds.size !== 1 ? 's' : ''} selected ({conceptCount} concept{conceptCount !== 1 ? 's' : ''})</p>
          {launchMode === 'new' ? (
            <p className="text-[10px] text-blue-400 mt-1">Configure campaign budget + ad set distribution below. Existing ad sets are auto-reused. Broad 18–65 US targeting. All ads land PAUSED.</p>
          ) : (
            <p className="text-[10px] text-yellow-400 mt-1">SCALE MODE: adds new ads into existing ad sets. No new campaign or ad sets will be created. New ads land PAUSED.</p>
          )}
        </div>

        {/* Mode toggle */}
        <div className="mb-4">
          <label className="text-[10px] text-slate-500 mb-2 block uppercase font-semibold">Launch Mode</label>
          <div className="flex gap-2">
            <button onClick={() => {
              setLaunchMode('new');
              setConceptAdSetMap({});
            }}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${launchMode === 'new' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
              New Campaign
              <div className="text-[9px] font-normal opacity-80 mt-0.5">Fresh ad sets for testing</div>
            </button>
            <button onClick={() => {
              setLaunchMode('scale');
              if (bulkLaunchProfileId) onLoadCampaignsForProfile(bulkLaunchProfileId);
            }}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${launchMode === 'scale' ? 'bg-yellow-600 border-yellow-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
              Scale Existing
              <div className="text-[9px] font-normal opacity-80 mt-0.5">Add to winning ad sets</div>
            </button>
          </div>
        </div>

        {/* ═══ NEW CAMPAIGN config — budget strategy, budget, ad set count, distribution ═══ */}
        {launchMode === 'new' && (
          <div className="mb-4 p-3 bg-slate-800/50 border border-slate-700 rounded-lg space-y-3">
            <p className="text-[10px] text-slate-400 uppercase font-semibold">New Campaign Config</p>

            {/* Budget strategy + amount */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">Budget Strategy</label>
                <div className="flex gap-1">
                  {(['ABO', 'CBO'] as const).map(s => (
                    <button key={s} onClick={() => setBudgetStrategy(s)}
                      className={`flex-1 px-2 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        budgetStrategy === s ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-1">{budgetStrategy === 'CBO' ? 'One budget at campaign level, Meta distributes' : 'Per-ad-set budget'}</p>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">
                  Daily Budget {budgetStrategy === 'CBO' ? '(campaign)' : '(per ad set)'}
                </label>
                <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2">
                  <span className="text-slate-500 text-sm">$</span>
                  <input type="number" min={1} step={1}
                    value={Math.round(dailyBudgetCents / 100)}
                    onChange={e => {
                      const dollars = parseInt(e.target.value, 10);
                      if (!isNaN(dollars) && dollars > 0) setDailyBudgetCents(dollars * 100);
                    }}
                    className="flex-1 bg-transparent py-2 text-sm text-white focus:outline-none" />
                  <span className="text-[10px] text-slate-500">/day</span>
                </div>
              </div>
            </div>

            {/* Distribution + ad set count */}
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">Concept Distribution</label>
              <div className="grid grid-cols-3 gap-1">
                {([
                  { key: 'one-per-adset' as const, label: '1 per ad set', desc: '1 concept = 1 ad set' },
                  { key: 'mixed' as const, label: 'Mix', desc: 'Round-robin into N ad sets' },
                  { key: 'all-in-each' as const, label: 'All in each', desc: 'Every concept in every ad set' },
                ]).map(d => (
                  <button key={d.key} onClick={() => setDistribution(d.key)}
                    className={`px-2 py-2 rounded-lg text-[10px] font-semibold border transition-colors text-center ${
                      distribution === d.key ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}>
                    {d.label}
                    <div className="text-[8px] font-normal opacity-70 mt-0.5">{d.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Ad set count — only meaningful when distribution != one-per-adset */}
            {distribution !== 'one-per-adset' && (
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">
                  Number of Ad Sets {adSetCount === null && <span className="text-slate-600 normal-case">(default = {conceptCount})</span>}
                </label>
                <input type="number" min={1} step={1}
                  value={adSetCount ?? conceptCount}
                  onChange={e => {
                    const n = parseInt(e.target.value, 10);
                    setAdSetCount(!isNaN(n) && n > 0 ? n : null);
                  }}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white" />
                <p className="text-[9px] text-slate-500 mt-1">
                  {distribution === 'mixed'
                    ? `Round-robin distributes ${conceptCount} concept${conceptCount !== 1 ? 's' : ''} across ${effectiveAdSetCount} ad set${effectiveAdSetCount !== 1 ? 's' : ''}`
                    : `${effectiveAdSetCount} ad set${effectiveAdSetCount !== 1 ? 's' : ''} created, each containing all ${conceptCount} concept${conceptCount !== 1 ? 's' : ''}`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Ad Account selector */}
        <div className="mb-3">
          <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">Ad Account</label>
          <select value={bulkLaunchProfileId} onChange={e => {
            setBulkLaunchProfileId(e.target.value);
            onLoadPagesForProfile(e.target.value);
            if (launchMode === 'scale') onLoadCampaignsForProfile(e.target.value);
          }}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white">
            {fbProfiles.length === 0 && <option value="">No ad accounts linked</option>}
            {fbProfiles.map((p: any) => (
              <option key={p.id} value={p.id}>{p.ad_account_name || p.profile_name}</option>
            ))}
          </select>
        </div>

        {/* ═══ SCALE MODE: Campaign + Concept→AdSet mapping ═══ */}
        {launchMode === 'scale' && (
          <>
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-slate-500 uppercase font-semibold">Existing Campaign</label>
                {loadingCampaigns && <span className="text-[10px] text-slate-500">Loading...</span>}
              </div>
              <select value={selectedCampaignId} onChange={e => {
                setSelectedCampaignId(e.target.value);
                if (bulkLaunchProfileId && e.target.value) onLoadAdSetsForCampaign(bulkLaunchProfileId, e.target.value);
              }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white">
                {fbCampaigns.length === 0 && <option value="">No campaigns — click Scale button to load</option>}
                {fbCampaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name} [{c.status}]</option>
                ))}
              </select>
            </div>

            {/* Concept → Ad Set mapping */}
            {fbAdSets.length > 0 && (
              <div className="mb-3">
                <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">Concept → Ad Set Mapping</label>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {getSelectedConcepts().map(concept => {
                    const mapped = conceptAdSetMap[concept];
                    const mappedAdSet = fbAdSets.find(a => a.id === mapped);
                    const wouldExceed = mappedAdSet && mappedAdSet.adCount >= 8;
                    return (
                      <div key={concept} className="p-2 bg-slate-800/50 border border-slate-700 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-white font-medium truncate flex-1" title={concept}>{concept}</span>
                          {mapped && !wouldExceed && <span className="text-[9px] text-emerald-400">✓ matched</span>}
                          {wouldExceed && <span className="text-[9px] text-red-400">⚠ full</span>}
                          {!mapped && <span className="text-[9px] text-red-400">no match</span>}
                        </div>
                        <select value={mapped || ''} onChange={e => setConceptAdSetMap(prev => ({ ...prev, [concept]: e.target.value }))}
                          className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-white">
                          <option value="">— select ad set —</option>
                          {fbAdSets.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.adCount} ads{a.adCount >= 8 ? ' — FULL' : ''})
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {loadingAdSets && <p className="text-[10px] text-slate-500 mb-3">Loading ad sets...</p>}
          </>
        )}

        {/* Page selector — CRITICAL: shows exactly which page will be used */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-slate-500 uppercase font-semibold">Facebook Page (ad creative)</label>
            {loadingPages && <span className="text-[10px] text-slate-500">Loading pages...</span>}
          </div>
          {!loadingPages && availablePages.length === 0 && (
            <div className="px-3 py-2 bg-red-900/20 border border-red-800 rounded-lg text-xs text-red-400">
              No pages accessible with this ad account's token.
            </div>
          )}
          {availablePages.length > 0 && (
            <select value={selectedPageId} onChange={e => setSelectedPageId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white">
              {availablePages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id}){p.id === currentProfilePageId ? ' ← stored' : ''}
                </option>
              ))}
            </select>
          )}
          {/* Show which page will be used */}
          {selectedPageId && (
            <p className="text-[10px] text-emerald-400 mt-1">
              Will use: {availablePages.find(p => p.id === selectedPageId)?.name} ({selectedPageId})
            </p>
          )}
          {/* Warning if different from stored */}
          {selectedPageId && currentProfilePageId && selectedPageId !== currentProfilePageId && (
            <div className="mt-2 flex items-center gap-2">
              <input type="checkbox" id="savePageDefault" checked={savePageAsDefault}
                onChange={e => setSavePageAsDefault(e.target.checked)}
                className="w-3 h-3" />
              <label htmlFor="savePageDefault" className="text-[10px] text-yellow-400">
                Save this page as the default for this ad account (overwrites stored {currentProfilePageName || currentProfilePageId})
              </label>
            </div>
          )}
        </div>

        {/* Landing page URL */}
        <div className="mb-4">
          <label className="text-[10px] text-slate-500 mb-1 block uppercase font-semibold">Landing Page URL</label>
          <input type="url" value={bulkLaunchLinkUrl} onChange={e => setBulkLaunchLinkUrl(e.target.value)}
            placeholder="https://yourdomain.com/product"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600" />
        </div>

        {bulkLaunching && bulkLaunchProgress && (
          <div className="mb-3 px-3 py-2 bg-blue-900/20 border border-blue-800 rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <p className="text-xs text-blue-300">{bulkLaunchProgress}</p>
          </div>
        )}
        {bulkLaunchError && (
          <div className="mb-3 px-3 py-2 bg-red-900/20 border border-red-800 rounded-lg text-xs text-red-400">{bulkLaunchError}</div>
        )}
        {bulkLaunchResult && (
          <div className={`mb-3 px-3 py-2 border rounded-lg ${bulkLaunchResult.partial ? 'bg-yellow-900/20 border-yellow-800' : 'bg-emerald-900/20 border-emerald-800'}`}>
            <p className={`text-xs font-medium ${bulkLaunchResult.partial ? 'text-yellow-400' : 'text-emerald-400'}`}>
              {bulkLaunchResult.partial ? 'Partial success: ' : 'Launched: '}
              {bulkLaunchResult.summary?.adsCreated} ads in {bulkLaunchResult.summary?.adSetsCreated} ad sets
            </p>
            {(bulkLaunchResult.summary?.adSetsReused > 0 || bulkLaunchResult.summary?.adSetsNewlyCreated > 0) && (
              <p className="text-[10px] text-slate-300 mt-1">
                {bulkLaunchResult.summary?.adSetsReused > 0 && `${bulkLaunchResult.summary.adSetsReused} reused`}
                {bulkLaunchResult.summary?.adSetsReused > 0 && bulkLaunchResult.summary?.adSetsNewlyCreated > 0 && ', '}
                {bulkLaunchResult.summary?.adSetsNewlyCreated > 0 && `${bulkLaunchResult.summary.adSetsNewlyCreated} newly created`}
              </p>
            )}
            <p className="text-[10px] text-slate-400 mt-1">
              Campaign: {bulkLaunchResult.campaign?.name} ({bulkLaunchResult.summary?.status})
            </p>
            {bulkLaunchResult.summary?.errorsCount > 0 && (
              <p className="text-[10px] text-yellow-400 mt-1">{bulkLaunchResult.summary.errorsCount} errors — check Ads Manager</p>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={() => !bulkLaunching && setShowBulkLaunchModal(false)} disabled={bulkLaunching}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onBulkLaunchToFB}
            disabled={bulkLaunching || !bulkLaunchProfileId || !bulkLaunchLinkUrl || !selectedPageId || (launchMode === 'scale' && (!selectedCampaignId || getSelectedConcepts().some(c => !conceptAdSetMap[c])))}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {bulkLaunching ? 'Launching...' : `Launch ${selectedCreativeIds.size} to Facebook`}
          </button>
        </div>
      </div>
    </div>
  );
}
