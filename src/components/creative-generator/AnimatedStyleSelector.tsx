'use client';

import type { AnimationStyle } from '@/components/creative-generator/types';
import { STYLE_DEFINITIONS } from '@/lib/animation-styles';

export interface AnimatedStyleSelectorProps {
  value?: AnimationStyle;
  onChange: (style: AnimationStyle) => void;
  /** Optional: highlight recommended styles based on the current creativeType */
  recommendedStyles?: AnimationStyle[];
  disabled?: boolean;
}

const STYLES: AnimationStyle[] = [
  'claymation',
  '3d_motion_graphics',
  'pixar_3d',
  'scientific_explainer',
];

export function AnimatedStyleSelector({
  value,
  onChange,
  recommendedStyles = [],
  disabled = false,
}: AnimatedStyleSelectorProps) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">
        Animation Style
      </label>
      <div className="grid grid-cols-2 gap-2">
        {STYLES.map((styleId) => {
          const def = STYLE_DEFINITIONS[styleId];
          const isSelected = value === styleId;
          const isRecommended = recommendedStyles.includes(styleId);

          return (
            <button
              key={styleId}
              type="button"
              disabled={disabled}
              onClick={() => onChange(styleId)}
              className={`relative text-left px-3 py-2.5 rounded-lg border transition-colors ${
                isSelected
                  ? 'bg-purple-600 border-purple-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {isRecommended && !isSelected && (
                <span className="absolute -top-2 -right-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-600 text-white font-semibold">
                  Recommended
                </span>
              )}
              <div className="text-xs font-semibold">{def.label}</div>
              <div
                className={`text-[10px] mt-0.5 leading-snug ${
                  isSelected ? 'text-purple-100' : 'text-slate-500'
                }`}
              >
                {def.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
