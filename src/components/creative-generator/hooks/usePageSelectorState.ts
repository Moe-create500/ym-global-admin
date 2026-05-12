'use client';

// Owns the Facebook Page selector state used by the bulk-launch modal.
// page.tsx consumes it via:
//   const { availablePages, setAvailablePages, ... } = usePageSelectorState();

import { useState } from 'react';

export interface AvailablePage {
  id: string;
  name: string;
  canCreateAds?: boolean;
}

export interface UsePageSelectorStateReturn {
  availablePages: AvailablePage[];
  setAvailablePages: React.Dispatch<React.SetStateAction<AvailablePage[]>>;
  loadingPages: boolean;
  setLoadingPages: React.Dispatch<React.SetStateAction<boolean>>;
  selectedPageId: string;
  setSelectedPageId: React.Dispatch<React.SetStateAction<string>>;
  currentProfilePageId: string;
  setCurrentProfilePageId: React.Dispatch<React.SetStateAction<string>>;
  currentProfilePageName: string;
  setCurrentProfilePageName: React.Dispatch<React.SetStateAction<string>>;
  savePageAsDefault: boolean;
  setSavePageAsDefault: React.Dispatch<React.SetStateAction<boolean>>;
}

export function usePageSelectorState(): UsePageSelectorStateReturn {
  const [availablePages, setAvailablePages] = useState<AvailablePage[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [currentProfilePageId, setCurrentProfilePageId] = useState('');
  const [currentProfilePageName, setCurrentProfilePageName] = useState('');
  const [savePageAsDefault, setSavePageAsDefault] = useState(false);

  return {
    availablePages, setAvailablePages,
    loadingPages, setLoadingPages,
    selectedPageId, setSelectedPageId,
    currentProfilePageId, setCurrentProfilePageId,
    currentProfilePageName, setCurrentProfilePageName,
    savePageAsDefault, setSavePageAsDefault,
  };
}
