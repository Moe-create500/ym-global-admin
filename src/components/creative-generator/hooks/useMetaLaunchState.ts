'use client';

// Owns the Meta launch lifecycle for the Generator-tab LaunchToMetaPanel
// (distinct from BulkLaunchModal's three hooks). Mutated together by the
// launch handler. Read together by LaunchToMetaPanel.
//
// fbProfiles is also pass-through-read by BulkLaunchModal — that read happens
// at page.tsx prop-pass scope, so the hook stays in the parent and both
// consumer trees see the same destructured binding.
//
// page.tsx consumes via:
//   const { launching, setLaunching, ... } = useMetaLaunchState();
//
// Part of the 5-way split of the audit's 24-value usePackageGeneratorState
// proposal — see useAccountIntelligenceState, useGenerationHistoryState,
// usePerPackageRenderState, usePackageGenerationState for the rest.

import { useState } from 'react';

export interface UseMetaLaunchStateReturn {
  launching: boolean;
  setLaunching: React.Dispatch<React.SetStateAction<boolean>>;
  launchResult: any;
  setLaunchResult: React.Dispatch<React.SetStateAction<any>>;
  launchError: string;
  setLaunchError: React.Dispatch<React.SetStateAction<string>>;
  fbProfiles: any[];
  setFbProfiles: React.Dispatch<React.SetStateAction<any[]>>;
  selectedProfileId: string;
  setSelectedProfileId: React.Dispatch<React.SetStateAction<string>>;
  launchLinkUrl: string;
  setLaunchLinkUrl: React.Dispatch<React.SetStateAction<string>>;
}

export function useMetaLaunchState(): UseMetaLaunchStateReturn {
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<any>(null);
  const [launchError, setLaunchError] = useState('');
  const [fbProfiles, setFbProfiles] = useState<any[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [launchLinkUrl, setLaunchLinkUrl] = useState('');

  return {
    launching, setLaunching,
    launchResult, setLaunchResult,
    launchError, setLaunchError,
    fbProfiles, setFbProfiles,
    selectedProfileId, setSelectedProfileId,
    launchLinkUrl, setLaunchLinkUrl,
  };
}
