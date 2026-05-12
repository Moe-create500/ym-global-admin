'use client';

// Owns the standalone Generate Modal's state — engine choice, prompt/title/angle
// inputs, resolution/duration knobs, the in-flight generating flag, the most
// recent genResult banner, and the prefill ad name banner. page.tsx consumes
// it via:
//   const { showGenerate, setShowGenerate, ... } = useGenerateModalState();
// The hook is called in page.tsx (parent) so handleGenerate, openGenerateFromWinner,
// and the toolbar trigger that opens the modal all see the same destructured
// local bindings as GenerateModal.

import { useState } from 'react';

export type GenerateEngine = 'sora' | 'veo' | 'minimax' | 'minimax-image' | 'nanobanana';
export type GenerateType = 'text-to-video' | 'image-to-video';

export interface UseGenerateModalStateReturn {
  showGenerate: boolean;
  setShowGenerate: React.Dispatch<React.SetStateAction<boolean>>;
  genType: GenerateType;
  setGenType: React.Dispatch<React.SetStateAction<GenerateType>>;
  genPrompt: string;
  setGenPrompt: React.Dispatch<React.SetStateAction<string>>;
  genTitle: string;
  setGenTitle: React.Dispatch<React.SetStateAction<string>>;
  genAngle: string;
  setGenAngle: React.Dispatch<React.SetStateAction<string>>;
  genImageUrls: string;
  setGenImageUrls: React.Dispatch<React.SetStateAction<string>>;
  genEngine: GenerateEngine;
  setGenEngine: React.Dispatch<React.SetStateAction<GenerateEngine>>;
  genResolution: string;
  setGenResolution: React.Dispatch<React.SetStateAction<string>>;
  genDuration: string;
  setGenDuration: React.Dispatch<React.SetStateAction<string>>;
  generating: boolean;
  setGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  genResult: any;
  setGenResult: React.Dispatch<React.SetStateAction<any>>;
  prefillAdName: string;
  setPrefillAdName: React.Dispatch<React.SetStateAction<string>>;
}

export function useGenerateModalState(): UseGenerateModalStateReturn {
  const [showGenerate, setShowGenerate] = useState(false);
  const [genType, setGenType] = useState<GenerateType>('text-to-video');
  const [genPrompt, setGenPrompt] = useState('');
  const [genTitle, setGenTitle] = useState('');
  const [genAngle, setGenAngle] = useState('');
  const [genImageUrls, setGenImageUrls] = useState('');
  const [genEngine, setGenEngine] = useState<GenerateEngine>('sora');
  const [genResolution, setGenResolution] = useState('720p');
  const [genDuration, setGenDuration] = useState('5');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<any>(null);
  const [prefillAdName, setPrefillAdName] = useState('');

  return {
    showGenerate, setShowGenerate,
    genType, setGenType,
    genPrompt, setGenPrompt,
    genTitle, setGenTitle,
    genAngle, setGenAngle,
    genImageUrls, setGenImageUrls,
    genEngine, setGenEngine,
    genResolution, setGenResolution,
    genDuration, setGenDuration,
    generating, setGenerating,
    genResult, setGenResult,
    prefillAdName, setPrefillAdName,
  };
}
