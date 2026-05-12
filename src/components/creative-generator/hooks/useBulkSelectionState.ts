'use client';

// Owns the bulk-launch trigger/selection state for the Generated Creatives tab.
// page.tsx consumes it via:
//   const { selectedCreativeIds, setSelectedCreativeIds, ... } = useBulkSelectionState();

import { useState } from 'react';

export interface UseBulkSelectionStateReturn {
  selectedCreativeIds: Set<string>;
  setSelectedCreativeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  bulkLaunching: boolean;
  setBulkLaunching: React.Dispatch<React.SetStateAction<boolean>>;
  bulkLaunchResult: any;
  setBulkLaunchResult: React.Dispatch<React.SetStateAction<any>>;
  bulkLaunchError: string;
  setBulkLaunchError: React.Dispatch<React.SetStateAction<string>>;
  bulkLaunchLinkUrl: string;
  setBulkLaunchLinkUrl: React.Dispatch<React.SetStateAction<string>>;
  bulkLaunchProfileId: string;
  setBulkLaunchProfileId: React.Dispatch<React.SetStateAction<string>>;
  showBulkLaunchModal: boolean;
  setShowBulkLaunchModal: React.Dispatch<React.SetStateAction<boolean>>;
  bulkLaunchProgress: string;
  setBulkLaunchProgress: React.Dispatch<React.SetStateAction<string>>;
}

export function useBulkSelectionState(): UseBulkSelectionStateReturn {
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<Set<string>>(new Set());
  const [bulkLaunching, setBulkLaunching] = useState(false);
  const [bulkLaunchResult, setBulkLaunchResult] = useState<any>(null);
  const [bulkLaunchError, setBulkLaunchError] = useState('');
  const [bulkLaunchLinkUrl, setBulkLaunchLinkUrl] = useState('');
  const [bulkLaunchProfileId, setBulkLaunchProfileId] = useState('');
  const [showBulkLaunchModal, setShowBulkLaunchModal] = useState(false);
  const [bulkLaunchProgress, setBulkLaunchProgress] = useState('');

  return {
    selectedCreativeIds, setSelectedCreativeIds,
    bulkLaunching, setBulkLaunching,
    bulkLaunchResult, setBulkLaunchResult,
    bulkLaunchError, setBulkLaunchError,
    bulkLaunchLinkUrl, setBulkLaunchLinkUrl,
    bulkLaunchProfileId, setBulkLaunchProfileId,
    showBulkLaunchModal, setShowBulkLaunchModal,
    bulkLaunchProgress, setBulkLaunchProgress,
  };
}
