'use client';

import type React from 'react';

export interface LaunchToMetaPanelProps {
  fbProfiles: any[];
  selectedProfileId: string;
  setSelectedProfileId: React.Dispatch<React.SetStateAction<string>>;
  launchLinkUrl: string;
  setLaunchLinkUrl: React.Dispatch<React.SetStateAction<string>>;
  launching: boolean;
  launchError: string;
  launchResult: any;
  completedAdCount: number;
  onLaunch: () => void;
}

export function LaunchToMetaPanel({
  fbProfiles,
  selectedProfileId,
  setSelectedProfileId,
  launchLinkUrl,
  setLaunchLinkUrl,
  launching,
  launchError,
  launchResult,
  completedAdCount,
  onLaunch,
}: LaunchToMetaPanelProps) {
  return (
    <div className="bg-slate-900 border border-blue-900/30 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <h4 className="text-xs font-semibold text-white">Launch to Meta Ads</h4>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400">ABO • $30/ad set/day</span>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        {/* Ad Account selector */}
        <div className="flex-1 min-w-[180px]">
          <label className="text-[10px] text-slate-500 mb-1 block">Ad Account</label>
          <select value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)}
            className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
            {fbProfiles.length === 0 && <option value="">No ad accounts linked</option>}
            {fbProfiles.map((p: any) => (
              <option key={p.id} value={p.id}>{p.ad_account_name || p.profile_name} {p.fb_page_id ? '' : '(no page)'}</option>
            ))}
          </select>
        </div>
        {/* Landing page URL */}
        <div className="flex-1 min-w-[220px]">
          <label className="text-[10px] text-slate-500 mb-1 block">Landing Page URL</label>
          <input type="url" value={launchLinkUrl} onChange={e => setLaunchLinkUrl(e.target.value)}
            placeholder="https://yourdomain.com/product"
            className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600" />
        </div>
        {/* Launch button */}
        <button onClick={onLaunch}
          disabled={launching || !selectedProfileId || !launchLinkUrl}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg whitespace-nowrap">
          {launching ? 'Launching...' : `Launch ${completedAdCount} Ads`}
        </button>
      </div>
      {launchError && (
        <div className="mt-2 px-3 py-1.5 bg-red-900/20 border border-red-800 rounded-lg text-[10px] text-red-400">{launchError}</div>
      )}
      {launchResult && (
        <div className="mt-2 px-3 py-2 bg-emerald-900/20 border border-emerald-800 rounded-lg">
          <p className="text-[10px] text-emerald-400 font-medium mb-1">
            Launched: {launchResult.summary?.adsCreated} ads in {launchResult.summary?.adSetsCreated} ad sets
          </p>
          <p className="text-[10px] text-slate-400">
            Campaign: {launchResult.campaign?.name} ({launchResult.summary?.status}) • {launchResult.summary?.budgetPerAdSet} per ad set
          </p>
          {launchResult.summary?.errorsCount > 0 && (
            <p className="text-[10px] text-yellow-400 mt-1">{launchResult.summary.errorsCount} error(s) — check Ads Manager</p>
          )}
        </div>
      )}
    </div>
  );
}
