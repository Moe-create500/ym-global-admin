'use client';

// Owns the Generator tab's UI state — toggles, form-input values, banner
// state, and the Product Foundation collapsible's full lifecycle. All 11
// values are read exclusively inside the Generator tab JSX (LEFT column form
// + RIGHT column Strategy panels), and mutated either inline (toggle state)
// or by Generator-tab-scoped handlers in page.tsx (handleGeneratePackage,
// handleConceptAction, loadFoundation, saveFoundation, applyTemplate,
// handleGenerateMoreLikeThis, handleGenerateHiggsfieldPack).
//
// This hook absorbs what the original queue audit had separated as
// useFoundationState (productFoundation, showFoundation, foundationLoading,
// foundationSaving). Recon revealed Foundation is a Generator-tab UI feature,
// not a standalone cluster, so its state lives here.
//
// Two values were originally deferred from useWinnerTemplateModalState
// (commit 2dd9bc0) with a TODO targeting "a future Generator-tab hook":
// showAdvanced and matchedWinnerRef. They land here as planned.
//
// page.tsx consumes via:
//   const { showAdvanced, setShowAdvanced, ... } = useGeneratorTabState();

import { useState } from 'react';

export interface ProductFoundation {
  beliefs: string[];
  uniqueMechanism: string;
  avatarSummary: string;
  offerBrief: string;
  researchNotes: string;
}

export interface UseGeneratorTabStateReturn {
  showAdvanced: boolean;
  setShowAdvanced: React.Dispatch<React.SetStateAction<boolean>>;
  matchedWinnerRef: any;
  setMatchedWinnerRef: React.Dispatch<React.SetStateAction<any>>;
  selectedExistingConcept: any;
  setSelectedExistingConcept: React.Dispatch<React.SetStateAction<any>>;
  activeConceptAction: string;
  setActiveConceptAction: React.Dispatch<React.SetStateAction<string>>;
  higgsStyle: string;
  setHiggsStyle: React.Dispatch<React.SetStateAction<string>>;
  productSearch: string;
  setProductSearch: React.Dispatch<React.SetStateAction<string>>;
  referenceVideoUrl: string;
  setReferenceVideoUrl: React.Dispatch<React.SetStateAction<string>>;
  // Clone-ad upload path state — Stage A1 added the upload ingest option
  // alongside the existing URL input. Mutually exclusive: when the user
  // toggles ingestMode, the other input's state is cleared in CloneAdForm.
  referenceVideoFile: File | null;
  setReferenceVideoFile: React.Dispatch<React.SetStateAction<File | null>>;
  ingestMode: 'url' | 'upload';
  setIngestMode: React.Dispatch<React.SetStateAction<'url' | 'upload'>>;
  // Clone-ad output mode — 'standard' returns 3 prompt packages for manual
  // review, 'tutorial' dispatches a single Higgsfield Seedance R2V generation
  // and renders the resulting video directly (bypasses package-review grid).
  cloneAdOutputMode: 'standard' | 'tutorial';
  setCloneAdOutputMode: React.Dispatch<React.SetStateAction<'standard' | 'tutorial'>>;
  // Pattern 1 — shared character image for multi-scene engines (seedance-scenes,
  // animated). 'auto' = pipeline generates via Nano Banana before scene loop;
  // 'upload' = user-supplied file. Visible only when contentType=video AND a
  // scene-based engine is selected.
  characterImageMode: 'auto' | 'upload';
  setCharacterImageMode: React.Dispatch<React.SetStateAction<'auto' | 'upload'>>;
  characterImageFile: File | null;
  setCharacterImageFile: React.Dispatch<React.SetStateAction<File | null>>;
  productFoundation: ProductFoundation | null;
  setProductFoundation: React.Dispatch<React.SetStateAction<ProductFoundation | null>>;
  showFoundation: boolean;
  setShowFoundation: React.Dispatch<React.SetStateAction<boolean>>;
  foundationLoading: boolean;
  setFoundationLoading: React.Dispatch<React.SetStateAction<boolean>>;
  foundationSaving: boolean;
  setFoundationSaving: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useGeneratorTabState(): UseGeneratorTabStateReturn {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [matchedWinnerRef, setMatchedWinnerRef] = useState<any>(null);
  const [selectedExistingConcept, setSelectedExistingConcept] = useState<any>(null);
  const [activeConceptAction, setActiveConceptAction] = useState('');
  const [higgsStyle, setHiggsStyle] = useState('product_showcase');
  const [productSearch, setProductSearch] = useState('');
  const [referenceVideoUrl, setReferenceVideoUrl] = useState('');
  const [referenceVideoFile, setReferenceVideoFile] = useState<File | null>(null);
  const [ingestMode, setIngestMode] = useState<'url' | 'upload'>('url');
  const [cloneAdOutputMode, setCloneAdOutputMode] = useState<'standard' | 'tutorial'>('standard');
  const [characterImageMode, setCharacterImageMode] = useState<'auto' | 'upload'>('auto');
  const [characterImageFile, setCharacterImageFile] = useState<File | null>(null);
  const [productFoundation, setProductFoundation] = useState<ProductFoundation | null>(null);
  const [showFoundation, setShowFoundation] = useState(false);
  const [foundationLoading, setFoundationLoading] = useState(false);
  const [foundationSaving, setFoundationSaving] = useState(false);

  return {
    showAdvanced, setShowAdvanced,
    matchedWinnerRef, setMatchedWinnerRef,
    selectedExistingConcept, setSelectedExistingConcept,
    activeConceptAction, setActiveConceptAction,
    higgsStyle, setHiggsStyle,
    productSearch, setProductSearch,
    referenceVideoUrl, setReferenceVideoUrl,
    referenceVideoFile, setReferenceVideoFile,
    ingestMode, setIngestMode,
    cloneAdOutputMode, setCloneAdOutputMode,
    characterImageMode, setCharacterImageMode,
    characterImageFile, setCharacterImageFile,
    productFoundation, setProductFoundation,
    showFoundation, setShowFoundation,
    foundationLoading, setFoundationLoading,
    foundationSaving, setFoundationSaving,
  };
}
