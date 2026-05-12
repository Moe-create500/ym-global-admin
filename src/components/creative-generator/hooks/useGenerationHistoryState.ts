'use client';

// Owns the generator's history-list lifecycle. genHistory + genHistoryLoading
// are populated by loadGenHistory; viewingHistory is set when the user clicks
// a history item (loadHistoryItem). Read together by GenerationHistoryPanel;
// viewingHistory also informs StrategyDisplay's "(Saved)" vs "(Current)"
// header.
//
// page.tsx consumes via:
//   const { genHistory, setGenHistory, ... } = useGenerationHistoryState();
//
// Part of the 5-way split of the audit's 24-value usePackageGeneratorState
// proposal — see useAccountIntelligenceState, useMetaLaunchState,
// usePerPackageRenderState, usePackageGenerationState for the rest.

import { useState } from 'react';

export interface UseGenerationHistoryStateReturn {
  genHistory: any[];
  setGenHistory: React.Dispatch<React.SetStateAction<any[]>>;
  genHistoryLoading: boolean;
  setGenHistoryLoading: React.Dispatch<React.SetStateAction<boolean>>;
  viewingHistory: string | null;
  setViewingHistory: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useGenerationHistoryState(): UseGenerationHistoryStateReturn {
  const [genHistory, setGenHistory] = useState<any[]>([]);
  const [genHistoryLoading, setGenHistoryLoading] = useState(false);
  const [viewingHistory, setViewingHistory] = useState<string | null>(null);

  return {
    genHistory, setGenHistory,
    genHistoryLoading, setGenHistoryLoading,
    viewingHistory, setViewingHistory,
  };
}
