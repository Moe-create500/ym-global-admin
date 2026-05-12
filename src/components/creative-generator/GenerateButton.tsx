'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';

export interface GenerateButtonProps {
  generatingPackage: boolean;
  clientHasCard: boolean | null;
  genMode: GeneratorConfig['genMode'];
  quantity: GeneratorConfig['quantity'];
  creativesPerConcept: GeneratorConfig['creativesPerConcept'];
  onClick: () => void;
}

export function GenerateButton({ generatingPackage, clientHasCard, genMode, quantity, creativesPerConcept, onClick }: GenerateButtonProps) {
  return (
    <button onClick={onClick} disabled={generatingPackage || clientHasCard === null}
      className="w-full px-4 py-4 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-purple-900/30">
      {generatingPackage ? 'Generating...' : clientHasCard === null ? 'Checking billing...' : (() => {
        if (genMode === 'clone_ad') return 'Clone Ad from Reference';
        const total = quantity * creativesPerConcept;
        return `Generate ${total} Creative${total > 1 ? 's' : ''}`;
      })()}
    </button>
  );
}
