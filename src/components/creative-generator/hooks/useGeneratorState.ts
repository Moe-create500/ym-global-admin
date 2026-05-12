'use client';

// Owns the genConfig state + its full localStorage persistence lifecycle
// (read-on-mount + write-on-change). page.tsx consumes it via:
//   const { genConfig, setGenConfig } = useGeneratorState();
//
// GeneratorConfig lives in page.tsx (type-only import here — no runtime
// coupling). This will be revisited when the generator types are moved
// to src/lib/schemas/ alongside CreativeBrief.

import { useEffect, useState } from 'react';
import type { GeneratorConfig } from '@/components/creative-generator/types';

const GEN_CONFIG_KEY = 'ym-gen-config';

const defaultGenConfig: GeneratorConfig = {
  conceptSource: 'generate_new', quantity: 3, creativesPerConcept: 3,
  engine: 'seedance-scenes', genMode: 'new', contentMix: 'video', funnelStructure: 'tof',
  contentMode: 'product',
  productId: '', coverImageUrl: '', conceptAngle: '', videosPerConcept: 3, imagesPerConcept: 3,
  contentType: 'video', creativeType: 'testimonial', funnelStage: 'tof',
  hookStyle: 'curiosity', avatarStyle: 'female_ugc', generationGoal: 'new_concept',
  platformTarget: 'meta', offer: '', baseAdId: '',
  dimension: '9:16', videoDuration: 15,
};

// Shared alias so per-control components don't repeat the full Dispatch type.
export type SetGenConfig = React.Dispatch<React.SetStateAction<GeneratorConfig>>;

export interface UseGeneratorStateReturn {
  genConfig: GeneratorConfig;
  setGenConfig: SetGenConfig;
}

export function useGeneratorState(): UseGeneratorStateReturn {
  const [genConfig, setGenConfig] = useState<GeneratorConfig>(() => {
    if (typeof window === 'undefined') return defaultGenConfig;
    try {
      const saved = localStorage.getItem(GEN_CONFIG_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge saved values on top of defaults so new fields added later still get their defaults
        return { ...defaultGenConfig, ...parsed };
      }
    } catch {}
    return defaultGenConfig;
  });

  // Save genConfig to localStorage on every change (debounce-free — object is small)
  useEffect(() => {
    try { localStorage.setItem(GEN_CONFIG_KEY, JSON.stringify(genConfig)); } catch {}
  }, [genConfig]);

  return { genConfig, setGenConfig };
}
