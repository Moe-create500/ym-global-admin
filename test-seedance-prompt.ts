import { parsePromptIntoScenes } from './src/lib/seedance-pipeline';
import { chunkScriptForSeedance, buildLanguageEnforcement } from './src/lib/voice-pipeline';

// Simulate a typical UGC ad prompt from generate-package
const samplePrompt = `UGC selfie video. Young woman talking directly to camera in natural morning light. Soft, golden-hour bedroom lighting. Casual, authentic feel. iPhone selfie mode. 9:16 vertical.

PRODUCT VISUAL: Show the product bottle clearly in hand. Close-up of label. Before/after skin comparison.

"I used to spend hundreds on skincare that did nothing for my dry skin."
"Then my friend told me about this serum and I was honestly skeptical."
"But after two weeks, my skin feels completely different. It's actually glowing."
"If you're struggling with dry skin, you need to try this. Link in my bio."

CAMERA: Start with close-up face, pull back to show product, end with smile.
RULES: Keep it natural. No filters. Real person energy.`;

const scenes = parsePromptIntoScenes(samplePrompt, 10, true);

// Merge scenes like generate/route.ts does
const mergedScene = {
  sceneIndex: 0,
  spokenScript: scenes.map(s => s.spokenScript).join(' '),
  visualPrompt: scenes[0]?.visualPrompt || 'UGC selfie video.',
  duration: 10,
  productVisible: true,
  productInHand: true,
  productNearFace: false,
};

console.log('=== PARSED SCENES ===');
for (const s of scenes) {
  console.log(`\nScene ${s.sceneIndex}:`);
  console.log(`  spoken: "${s.spokenScript}"`);
  console.log(`  visual: "${s.visualPrompt.substring(0, 80)}..."`);
}

console.log('\n=== MERGED SPOKEN SCRIPT ===');
console.log(mergedScene.spokenScript);

console.log('\n=== CHUNKED FOR SEEDANCE ===');
console.log(chunkScriptForSeedance(mergedScene.spokenScript));

// Build the full prompt exactly like renderScene does
const productPlacement = 'Person is holding the product.';
const promptParts: string[] = [];
promptParts.push(`[SCENE DIRECTION — DO NOT SPEAK: ${mergedScene.visualPrompt}]`);
promptParts.push(`[VISUAL ONLY: ${productPlacement}]`);
promptParts.push(chunkScriptForSeedance(mergedScene.spokenScript));
const finalPrompt = promptParts.join('\n\n');

console.log('\n=== FINAL SEEDANCE PROMPT ===');
console.log(finalPrompt);
console.log(`\n=== PROMPT LENGTH: ${finalPrompt.length} chars ===`);
