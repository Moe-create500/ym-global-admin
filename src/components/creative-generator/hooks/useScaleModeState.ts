'use client';

// Owns the launch-config state used by the bulk-launch modal:
//   - launchMode (new vs scale) and scale-mode-specific selection
//   - new-campaign launch knobs (budget strategy, daily budget, ad set count, distribution)
// page.tsx consumes it via:
//   const { launchMode, setLaunchMode, ... } = useScaleModeState();

import { useState } from 'react';

export interface FbCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
}

export interface FbAdSet {
  id: string;
  name: string;
  status: string;
  adCount: number;
}

export type BudgetStrategy = 'ABO' | 'CBO';
export type DistributionMode = 'one-per-adset' | 'mixed' | 'all-in-each';

export interface UseScaleModeStateReturn {
  launchMode: 'new' | 'scale';
  setLaunchMode: React.Dispatch<React.SetStateAction<'new' | 'scale'>>;
  fbCampaigns: FbCampaign[];
  setFbCampaigns: React.Dispatch<React.SetStateAction<FbCampaign[]>>;
  selectedCampaignId: string;
  setSelectedCampaignId: React.Dispatch<React.SetStateAction<string>>;
  fbAdSets: FbAdSet[];
  setFbAdSets: React.Dispatch<React.SetStateAction<FbAdSet[]>>;
  loadingCampaigns: boolean;
  setLoadingCampaigns: React.Dispatch<React.SetStateAction<boolean>>;
  loadingAdSets: boolean;
  setLoadingAdSets: React.Dispatch<React.SetStateAction<boolean>>;
  conceptAdSetMap: Record<string, string>;
  setConceptAdSetMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  // ── New Campaign launch config (ignored in scale mode) ──
  budgetStrategy: BudgetStrategy;
  setBudgetStrategy: React.Dispatch<React.SetStateAction<BudgetStrategy>>;
  dailyBudgetCents: number;
  setDailyBudgetCents: React.Dispatch<React.SetStateAction<number>>;
  // null = "use number of unique concepts" (today's default behavior)
  adSetCount: number | null;
  setAdSetCount: React.Dispatch<React.SetStateAction<number | null>>;
  distribution: DistributionMode;
  setDistribution: React.Dispatch<React.SetStateAction<DistributionMode>>;
}

export function useScaleModeState(): UseScaleModeStateReturn {
  const [launchMode, setLaunchMode] = useState<'new' | 'scale'>('new');
  const [fbCampaigns, setFbCampaigns] = useState<FbCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [fbAdSets, setFbAdSets] = useState<FbAdSet[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdSets, setLoadingAdSets] = useState(false);
  const [conceptAdSetMap, setConceptAdSetMap] = useState<Record<string, string>>({});
  const [budgetStrategy, setBudgetStrategy] = useState<BudgetStrategy>('ABO');
  const [dailyBudgetCents, setDailyBudgetCents] = useState<number>(3000);
  const [adSetCount, setAdSetCount] = useState<number | null>(null);
  const [distribution, setDistribution] = useState<DistributionMode>('one-per-adset');

  return {
    launchMode, setLaunchMode,
    fbCampaigns, setFbCampaigns,
    selectedCampaignId, setSelectedCampaignId,
    fbAdSets, setFbAdSets,
    loadingCampaigns, setLoadingCampaigns,
    loadingAdSets, setLoadingAdSets,
    conceptAdSetMap, setConceptAdSetMap,
    budgetStrategy, setBudgetStrategy,
    dailyBudgetCents, setDailyBudgetCents,
    adSetCount, setAdSetCount,
    distribution, setDistribution,
  };
}
