'use client';

// Owns the Performance tab's filter, expansion, and analysis state. page.tsx
// consumes it via:
//   const { adSets, setAdSets, ... } = usePerformanceState();
// The hook is called in page.tsx (parent) so that loadPerformance,
// toggleExpand, analyzeAdVideo, and the related useEffect at line 695 all see
// the same destructured local bindings as PerformanceTab.

import { useState } from 'react';
import type { Ad, AdSet } from '@/components/creative-generator/types';

export interface UsePerformanceStateReturn {
  adSets: AdSet[];
  setAdSets: React.Dispatch<React.SetStateAction<AdSet[]>>;
  dateRange: string;
  setDateRange: React.Dispatch<React.SetStateAction<string>>;
  sortBy: string;
  setSortBy: React.Dispatch<React.SetStateAction<string>>;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectedAd: Ad | null;
  setSelectedAd: React.Dispatch<React.SetStateAction<Ad | null>>;
  analyzingAdId: string | null;
  setAnalyzingAdId: React.Dispatch<React.SetStateAction<string | null>>;
  adAnalysis: Record<string, string>;
  setAdAnalysis: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function usePerformanceState(): UsePerformanceStateReturn {
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [dateRange, setDateRange] = useState('14');
  const [sortBy, setSortBy] = useState('spend');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [analyzingAdId, setAnalyzingAdId] = useState<string | null>(null);
  const [adAnalysis, setAdAnalysis] = useState<Record<string, string>>({});

  return {
    adSets, setAdSets,
    dateRange, setDateRange,
    sortBy, setSortBy,
    expanded, setExpanded,
    selectedAd, setSelectedAd,
    analyzingAdId, setAnalyzingAdId,
    adAnalysis, setAdAnalysis,
  };
}
