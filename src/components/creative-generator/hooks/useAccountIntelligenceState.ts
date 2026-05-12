'use client';

// Owns the server-fetched account intelligence + concept analysis + billing
// gate state. All three values are hydrated by useEffects keyed on storeFilter
// and userRole; they feed the 11 Strategy Panel props plus the Generator's
// payment-method banner. Distinct lifecycle from package generation outputs —
// these are inputs/gates, not outputs of any generate event.
//
// page.tsx consumes via:
//   const { accountIntel, setAccountIntel, ... } = useAccountIntelligenceState();
//
// Part of the 5-way split of the audit's 24-value usePackageGeneratorState
// proposal — see useGenerationHistoryState, useMetaLaunchState,
// usePerPackageRenderState, usePackageGenerationState for the rest.

import { useState } from 'react';
import type { AccountIntelligence } from '@/components/creative-generator/types';

export interface UseAccountIntelligenceStateReturn {
  accountIntel: AccountIntelligence | null;
  setAccountIntel: React.Dispatch<React.SetStateAction<AccountIntelligence | null>>;
  conceptData: any;
  setConceptData: React.Dispatch<React.SetStateAction<any>>;
  clientHasCard: boolean | null;
  setClientHasCard: React.Dispatch<React.SetStateAction<boolean | null>>;
}

export function useAccountIntelligenceState(): UseAccountIntelligenceStateReturn {
  const [accountIntel, setAccountIntel] = useState<AccountIntelligence | null>(null);
  const [conceptData, setConceptData] = useState<any>(null);
  const [clientHasCard, setClientHasCard] = useState<boolean | null>(null); // null = loading, true/false = known

  return {
    accountIntel, setAccountIntel,
    conceptData, setConceptData,
    clientHasCard, setClientHasCard,
  };
}
