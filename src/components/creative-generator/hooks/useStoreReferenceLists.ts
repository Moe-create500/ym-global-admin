'use client';

// This hook owns the fetch lifecycle for store-scoped reference lists.
// Unlike the pure state-container hooks (useBatchWizardState, useLibraryState, etc.),
// this hook contains a useEffect that re-fetches whenever storeFilter changes.
// Pattern precedent: useGeneratorState owns its localStorage-persistence effect.
// Optimistic updates from page.tsx handlers (saveAsWinner, removeWinner, saveTemplate,
// delete-template) write via the exposed setters.
//
// page.tsx consumes via:
//   const { winners, setWinners, setupTemplates, setSetupTemplates } =
//     useStoreReferenceLists(storeFilter);

import { useEffect, useState } from 'react';

export interface UseStoreReferenceListsReturn {
  winners: any[];
  setWinners: React.Dispatch<React.SetStateAction<any[]>>;
  setupTemplates: any[];
  setSetupTemplates: React.Dispatch<React.SetStateAction<any[]>>;
}

export function useStoreReferenceLists(storeFilter: string): UseStoreReferenceListsReturn {
  const [winners, setWinners] = useState<any[]>([]);
  const [setupTemplates, setSetupTemplates] = useState<any[]>([]);

  useEffect(() => {
    if (storeFilter) {
      fetch(`/api/creatives/winners?storeId=${encodeURIComponent(storeFilter)}`)
        .then(r => r.json()).then(d => setWinners(d.winners || [])).catch(() => {});
      fetch(`/api/creatives/templates?storeId=${encodeURIComponent(storeFilter)}`)
        .then(r => r.json()).then(d => setSetupTemplates(d.templates || [])).catch(() => {});
    }
  }, [storeFilter]);

  return { winners, setWinners, setupTemplates, setSetupTemplates };
}
