'use client';

// Owns the transient UI state for the Winner Save Modal and the Template Save
// Modal — the two save dialogs that share a save/cancel/in-flight lifecycle.
// page.tsx consumes it via:
//   const { showWinnerModal, setShowWinnerModal, ... } = useWinnerTemplateModalState();

import { useState } from 'react';

export interface WinnerModalArg {
  pkg: any;
  idx: number;
  creativeId?: string;
}

export interface UseWinnerTemplateModalStateReturn {
  showWinnerModal: WinnerModalArg | null;
  setShowWinnerModal: React.Dispatch<React.SetStateAction<WinnerModalArg | null>>;
  savingWinner: string | null;
  setSavingWinner: React.Dispatch<React.SetStateAction<string | null>>;
  winnerNotes: string;
  setWinnerNotes: React.Dispatch<React.SetStateAction<string>>;
  showTemplateSave: boolean;
  setShowTemplateSave: React.Dispatch<React.SetStateAction<boolean>>;
  templateName: string;
  setTemplateName: React.Dispatch<React.SetStateAction<string>>;
}

export function useWinnerTemplateModalState(): UseWinnerTemplateModalStateReturn {
  const [showWinnerModal, setShowWinnerModal] = useState<WinnerModalArg | null>(null);
  const [savingWinner, setSavingWinner] = useState<string | null>(null);
  const [winnerNotes, setWinnerNotes] = useState('');
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [templateName, setTemplateName] = useState('');

  return {
    showWinnerModal, setShowWinnerModal,
    savingWinner, setSavingWinner,
    winnerNotes, setWinnerNotes,
    showTemplateSave, setShowTemplateSave,
    templateName, setTemplateName,
  };
}
