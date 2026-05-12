'use client';

// TODO (cleanup audit): expandedLibraryCreative was declared in page.tsx but had no readers or writers at the time of extraction. Preserved here to avoid behavior change. If still unused after Phase 3B, remove in a dedicated dead-state-cleanup commit.

// Owns the Library tab's filter/search/expansion state plus the data slots
// populated by loadLibrary(). page.tsx consumes it via:
//   const { libraryPackages, setLibraryPackages, ... } = useLibraryState();
// The hook is called in page.tsx (parent) so that both LibraryTab and the
// sidebar tab badge (which reads libraryCounts.totalWinners) can see the same
// state through the destructured local bindings.

import { useState } from 'react';

export interface LibraryCounts {
  totalPackages: number;
  totalCreatives: number;
  totalWinners: number;
}

export interface LibraryFilters {
  contentType?: string;
  creativeType?: string;
  funnelStage?: string;
  provider?: string;
  winnerOnly?: boolean;
  launchedOnly?: boolean;
}

export interface UseLibraryStateReturn {
  libraryPackages: any[];
  setLibraryPackages: React.Dispatch<React.SetStateAction<any[]>>;
  libraryCreatives: any[];
  setLibraryCreatives: React.Dispatch<React.SetStateAction<any[]>>;
  libraryWinners: any[];
  setLibraryWinners: React.Dispatch<React.SetStateAction<any[]>>;
  libraryCounts: LibraryCounts;
  setLibraryCounts: React.Dispatch<React.SetStateAction<LibraryCounts>>;
  libraryLoading: boolean;
  setLibraryLoading: React.Dispatch<React.SetStateAction<boolean>>;
  librarySearch: string;
  setLibrarySearch: React.Dispatch<React.SetStateAction<string>>;
  libraryFilters: LibraryFilters;
  setLibraryFilters: React.Dispatch<React.SetStateAction<LibraryFilters>>;
  expandedLibraryPkg: string | null;
  setExpandedLibraryPkg: React.Dispatch<React.SetStateAction<string | null>>;
  expandedLibraryCreative: string | null;
  setExpandedLibraryCreative: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useLibraryState(): UseLibraryStateReturn {
  const [libraryPackages, setLibraryPackages] = useState<any[]>([]);
  const [libraryCreatives, setLibraryCreatives] = useState<any[]>([]);
  const [libraryWinners, setLibraryWinners] = useState<any[]>([]);
  const [libraryCounts, setLibraryCounts] = useState<LibraryCounts>({ totalPackages: 0, totalCreatives: 0, totalWinners: 0 });
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilters>({});
  const [expandedLibraryPkg, setExpandedLibraryPkg] = useState<string | null>(null);
  const [expandedLibraryCreative, setExpandedLibraryCreative] = useState<string | null>(null);

  return {
    libraryPackages, setLibraryPackages,
    libraryCreatives, setLibraryCreatives,
    libraryWinners, setLibraryWinners,
    libraryCounts, setLibraryCounts,
    libraryLoading, setLibraryLoading,
    librarySearch, setLibrarySearch,
    libraryFilters, setLibraryFilters,
    expandedLibraryPkg, setExpandedLibraryPkg,
    expandedLibraryCreative, setExpandedLibraryCreative,
  };
}
