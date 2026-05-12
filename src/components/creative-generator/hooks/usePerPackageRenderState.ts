'use client';

// Owns per-package in-flight tracking + comparison-selection state. Three
// values are render trackers (video gen in-flight by index, video status by
// index, image render jobs by index); comparingPackages is the comparison
// selection set keyed by the same indices. All four are mutated by per-package
// handlers (fireVideoJob, fireRenderJob, handleGenerateAll, comparison
// toggles) and read together by PackageList.
//
// page.tsx consumes via:
//   const { generatingIdxSet, setGeneratingIdxSet, ... } = usePerPackageRenderState();
//
// Part of the 5-way split of the audit's 24-value usePackageGeneratorState
// proposal — see useAccountIntelligenceState, useGenerationHistoryState,
// useMetaLaunchState, usePackageGenerationState for the rest.

import { useState } from 'react';
import type { RenderJob } from '@/components/creative-generator/types';

export interface PackageVideoStatus {
  id: string;
  status: string;
  engine: string;
  reason?: string;
}

export interface UsePerPackageRenderStateReturn {
  generatingIdxSet: Set<number>;
  setGeneratingIdxSet: React.Dispatch<React.SetStateAction<Set<number>>>;
  packageVideoStatus: Record<number, PackageVideoStatus>;
  setPackageVideoStatus: React.Dispatch<React.SetStateAction<Record<number, PackageVideoStatus>>>;
  renderJobs: Record<number, RenderJob>;
  setRenderJobs: React.Dispatch<React.SetStateAction<Record<number, RenderJob>>>;
  comparingPackages: number[];
  setComparingPackages: React.Dispatch<React.SetStateAction<number[]>>;
}

export function usePerPackageRenderState(): UsePerPackageRenderStateReturn {
  const [generatingIdxSet, setGeneratingIdxSet] = useState<Set<number>>(new Set());
  const [packageVideoStatus, setPackageVideoStatus] = useState<Record<number, PackageVideoStatus>>({});
  const [renderJobs, setRenderJobs] = useState<Record<number, RenderJob>>({});
  const [comparingPackages, setComparingPackages] = useState<number[]>([]);

  return {
    generatingIdxSet, setGeneratingIdxSet,
    packageVideoStatus, setPackageVideoStatus,
    renderJobs, setRenderJobs,
    comparingPackages, setComparingPackages,
  };
}
