'use client';

// Owns the core package-generation lifecycle (regular + Higgsfield path).
// genStrategy is the strategy snapshot returned BY generation (output), not
// the upstream account intel — distinct lifecycle from useAccountIntelligenceState.
// genCurrentId, genVersion, expandedPackage track the current generation's UI
// position. higgsPackJob is the Higgsfield-specific output container — the
// regular path writes genPackages/genCurrentId/genVersion/etc., the Higgsfield
// path writes higgsPackJob; both share the entry handler (handleGeneratePackage
// dispatches to handleHiggsfieldPack on engine === 'higgsfield'), the in-flight
// flag (generatingPackage), and the error state (genPackageError).
//
// page.tsx consumes via:
//   const { genPackages, setGenPackages, ... } = usePackageGenerationState();
//
// Part of the 5-way split of the audit's 24-value usePackageGeneratorState
// proposal — see useAccountIntelligenceState, useGenerationHistoryState,
// useMetaLaunchState, usePerPackageRenderState for the rest.

import { useState } from 'react';
import type { CreativePackage } from '@/components/creative-generator/types';

export interface HiggsPackJob {
  jobId: string;
  status: string;
  progress?: string;
  videoUrl?: string;
  scenes?: any[];
}

// Clone-ad Tutorial Mode result — populated when the route returns
// { mode: 'tutorial', videoUrl, ... }. When set, GeneratorOutputArea renders
// the video directly and bypasses the package-review grid.
export interface TutorialVideoResult {
  videoUrl: string;
  prompt: string;
  requestId: string;
  referenceImageUrl: string;
  sourceDuration: number;
  generatedDuration: number;
}

export interface UsePackageGenerationStateReturn {
  genPackages: CreativePackage[];
  setGenPackages: React.Dispatch<React.SetStateAction<CreativePackage[]>>;
  genPackageConfig: any;
  setGenPackageConfig: React.Dispatch<React.SetStateAction<any>>;
  generatingPackage: boolean;
  setGeneratingPackage: React.Dispatch<React.SetStateAction<boolean>>;
  genPackageError: string;
  setGenPackageError: React.Dispatch<React.SetStateAction<string>>;
  genCurrentId: string | null;
  setGenCurrentId: React.Dispatch<React.SetStateAction<string | null>>;
  genVersion: number;
  setGenVersion: React.Dispatch<React.SetStateAction<number>>;
  genStrategy: any;
  setGenStrategy: React.Dispatch<React.SetStateAction<any>>;
  expandedPackage: number | null;
  setExpandedPackage: React.Dispatch<React.SetStateAction<number | null>>;
  higgsPackJob: HiggsPackJob | null;
  setHiggsPackJob: React.Dispatch<React.SetStateAction<HiggsPackJob | null>>;
  tutorialVideoResult: TutorialVideoResult | null;
  setTutorialVideoResult: React.Dispatch<React.SetStateAction<TutorialVideoResult | null>>;
}

export function usePackageGenerationState(): UsePackageGenerationStateReturn {
  const [genPackages, setGenPackages] = useState<CreativePackage[]>([]);
  const [genPackageConfig, setGenPackageConfig] = useState<any>(null);
  const [generatingPackage, setGeneratingPackage] = useState(false);
  const [genPackageError, setGenPackageError] = useState('');
  const [genCurrentId, setGenCurrentId] = useState<string | null>(null);
  const [genVersion, setGenVersion] = useState(1);
  const [genStrategy, setGenStrategy] = useState<any>(null);
  const [expandedPackage, setExpandedPackage] = useState<number | null>(null);
  const [higgsPackJob, setHiggsPackJob] = useState<HiggsPackJob | null>(null);
  const [tutorialVideoResult, setTutorialVideoResult] = useState<TutorialVideoResult | null>(null);

  return {
    genPackages, setGenPackages,
    genPackageConfig, setGenPackageConfig,
    generatingPackage, setGeneratingPackage,
    genPackageError, setGenPackageError,
    genCurrentId, setGenCurrentId,
    genVersion, setGenVersion,
    genStrategy, setGenStrategy,
    expandedPackage, setExpandedPackage,
    higgsPackJob, setHiggsPackJob,
    tutorialVideoResult, setTutorialVideoResult,
  };
}
