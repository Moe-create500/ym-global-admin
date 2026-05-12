'use client';

// Owns the Batches tab state — batch list, expansion, and the New Batch
// wizard's three-step state machine — plus the per-batch double-down loading
// flag. page.tsx consumes it via:
//   const { batches, setBatches, ... } = useBatchWizardState();
// The hook is called in page.tsx (parent) so that loadBatches, startWizard,
// wizCreateBatch, wizRegeneratePrompts, wizStartGeneration, loadBatchDetail,
// handleDoubleDown, and the related useEffect at line ~695 all see the same
// destructured local bindings as BatchesTab.

import { useState } from 'react';
import type { Batch, Creative, PromptItem } from '@/components/creative-generator/types';

export interface UseBatchWizardStateReturn {
  // Batch list data
  batches: Batch[];
  setBatches: React.Dispatch<React.SetStateAction<Batch[]>>;
  expandedBatch: string | null;
  setExpandedBatch: React.Dispatch<React.SetStateAction<string | null>>;
  batchCreatives: Record<string, Creative[]>;
  setBatchCreatives: React.Dispatch<React.SetStateAction<Record<string, Creative[]>>>;
  // Wizard
  showWizard: boolean;
  setShowWizard: React.Dispatch<React.SetStateAction<boolean>>;
  wizardStep: number;
  setWizardStep: React.Dispatch<React.SetStateAction<number>>;
  wizProductId: string;
  setWizProductId: React.Dispatch<React.SetStateAction<string>>;
  wizOffer: string;
  setWizOffer: React.Dispatch<React.SetStateAction<string>>;
  wizName: string;
  setWizName: React.Dispatch<React.SetStateAction<string>>;
  wizVideoPrompts: PromptItem[];
  setWizVideoPrompts: React.Dispatch<React.SetStateAction<PromptItem[]>>;
  wizImagePrompts: PromptItem[];
  setWizImagePrompts: React.Dispatch<React.SetStateAction<PromptItem[]>>;
  wizBatchId: string;
  setWizBatchId: React.Dispatch<React.SetStateAction<string>>;
  wizLoading: boolean;
  setWizLoading: React.Dispatch<React.SetStateAction<boolean>>;
  wizError: string;
  setWizError: React.Dispatch<React.SetStateAction<string>>;
  // Double down loading
  doublingDown: string | null;
  setDoublingDown: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useBatchWizardState(): UseBatchWizardStateReturn {
  // Batch list data
  const [batches, setBatches] = useState<Batch[]>([]);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [batchCreatives, setBatchCreatives] = useState<Record<string, Creative[]>>({});

  // Wizard
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizProductId, setWizProductId] = useState('');
  const [wizOffer, setWizOffer] = useState('');
  const [wizName, setWizName] = useState('');
  const [wizVideoPrompts, setWizVideoPrompts] = useState<PromptItem[]>([]);
  const [wizImagePrompts, setWizImagePrompts] = useState<PromptItem[]>([]);
  const [wizBatchId, setWizBatchId] = useState('');
  const [wizLoading, setWizLoading] = useState(false);
  const [wizError, setWizError] = useState('');

  // Double down loading
  const [doublingDown, setDoublingDown] = useState<string | null>(null);

  return {
    batches, setBatches,
    expandedBatch, setExpandedBatch,
    batchCreatives, setBatchCreatives,
    showWizard, setShowWizard,
    wizardStep, setWizardStep,
    wizProductId, setWizProductId,
    wizOffer, setWizOffer,
    wizName, setWizName,
    wizVideoPrompts, setWizVideoPrompts,
    wizImagePrompts, setWizImagePrompts,
    wizBatchId, setWizBatchId,
    wizLoading, setWizLoading,
    wizError, setWizError,
    doublingDown, setDoublingDown,
  };
}
