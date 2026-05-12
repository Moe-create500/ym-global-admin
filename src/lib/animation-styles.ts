import type { AnimationStyle } from '@/components/creative-generator/types';

export interface StyleDefinition {
  id: AnimationStyle;
  label: string;
  description: string;
  /** Style descriptor used in storyboard image prompts */
  visualStyleGuide: string;
  /** Whether this style typically features characters that need consistency across frames */
  requiresCharacterConsistency: boolean;
  /** Recommended creative types this style pairs well with (used for UI badges) */
  recommendedCreativeTypes: string[];
  /** Default scene count if user doesn't override */
  defaultSceneCount: number;
}

export const STYLE_DEFINITIONS: Record<AnimationStyle, StyleDefinition> = {
  claymation: {
    id: 'claymation',
    label: 'Claymation',
    description: 'Stop-motion clay aesthetic. Handcrafted, tactile, charming.',
    visualStyleGuide: 'Stop-motion claymation aesthetic. Visible clay texture, slightly imperfect handcrafted look, soft studio lighting, shallow depth of field, warm color palette. Aardman Animations / Wallace and Gromit visual style.',
    requiresCharacterConsistency: true,
    recommendedCreativeTypes: ['testimonial', 'lifestyle', 'hook_viral', 'founder_story'],
    defaultSceneCount: 4,
  },
  '3d_motion_graphics': {
    id: '3d_motion_graphics',
    label: '3D Motion Graphics',
    description: 'Product-only 3D animation. Reveals, transformations, mechanism visualizations. No characters.',
    visualStyleGuide: 'Polished 3D motion graphics. Clean studio environment, no human characters, dynamic camera movement around the product, dramatic lighting with hero shots, subtle particle effects, gradient backgrounds. Apple product reveal aesthetic.',
    requiresCharacterConsistency: false,
    recommendedCreativeTypes: ['product_demo', 'before_after', 'problem_solution'],
    defaultSceneCount: 3,
  },
  pixar_3d: {
    id: 'pixar_3d',
    label: 'Pixar Style',
    description: 'Stylized 3D characters with expressive faces. Best for character-driven testimonials and stories.',
    visualStyleGuide: 'Pixar-style 3D animation. Stylized character with large expressive eyes and exaggerated features, soft warm lighting, cinematic depth of field, clean rendered surfaces, Disney/Pixar visual language. NOT photorealistic. Friendly cartoon proportions.',
    requiresCharacterConsistency: true,
    recommendedCreativeTypes: ['testimonial', 'founder_story', 'pov_relatable', 'hook_viral'],
    defaultSceneCount: 4,
  },
  scientific_explainer: {
    id: 'scientific_explainer',
    label: 'Scientific Explainer',
    description: 'Animated B-roll showing how the product works. Molecular animations, cross-sections, mechanism of action.',
    visualStyleGuide: 'Scientific explainer animation. Cross-section diagrams, molecular structure visualizations, animated B-roll showing mechanism of action, clinical clean aesthetic, blue and white color palette with brand color accents, label callouts, semi-realistic rendering of biological/chemical concepts. Educational documentary visual style.',
    requiresCharacterConsistency: false,
    recommendedCreativeTypes: ['educational', 'product_demo', 'problem_solution'],
    defaultSceneCount: 4,
  },
};

/**
 * Returns recommended animation styles for a given creative type, ranked by fit.
 */
export function getRecommendedStyles(creativeType: string): AnimationStyle[] {
  return (Object.values(STYLE_DEFINITIONS) as StyleDefinition[])
    .filter(s => s.recommendedCreativeTypes.includes(creativeType))
    .map(s => s.id);
}

/**
 * Returns the default scene count for a given style.
 */
export function getDefaultSceneCount(style: AnimationStyle): number {
  return STYLE_DEFINITIONS[style].defaultSceneCount;
}

/**
 * Returns the visual style guide for a given style — used in storyboard image prompts.
 */
export function getVisualStyleGuide(style: AnimationStyle): string {
  return STYLE_DEFINITIONS[style].visualStyleGuide;
}
