import { parsePromptIntoScenes } from './src/lib/seedance-pipeline';
import { normalizeScript } from './src/lib/voice-pipeline';

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
  console.log(`  visual: "${s.visualPrompt.substring(0, 120)}..."`);
}

console.log('\n=== MERGED SPOKEN SCRIPT ===');
console.log(mergedScene.spokenScript);

// Build the full prompt exactly like the NEW renderScene does
const productPlacement = 'Person is holding the product.';

const visualClean = (mergedScene.visualPrompt || '')
  .split('\n')
  .filter(l => !/^(PRODUCT VISUAL|CAMERA|LIGHTING|STYLE|TECHNICAL|RULES|FORMAT|COMPOSITION|VISUAL|OPENING|CTA|HOOK)\s*:/i.test(l.trim()))
  .join(' ')
  .replace(/\b(UGC|9:16|16:9|4:5|1:1|480p|720p|iPhone|selfie mode|aspect ratio|vertical|horizontal)\b/gi, '')
  .replace(/\s+/g, ' ').trim();
const visualSentences = visualClean.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 3).slice(0, 2);
const visualBrief = visualSentences.join(' ').trim();

const promptParts: string[] = [];
if (visualBrief) {
  promptParts.push(visualBrief.endsWith('.') ? visualBrief : visualBrief + '.');
}
promptParts.push(productPlacement);

const cleanDialogue = normalizeScript(mergedScene.spokenScript).trim();
if (cleanDialogue) {
  promptParts.push(`Speaking to camera: "${cleanDialogue}"`);
}

const finalPrompt = promptParts.join(' ');

console.log('\n=== FINAL SEEDANCE PROMPT ===');
console.log(finalPrompt);
console.log(`\n=== PROMPT LENGTH: ${finalPrompt.length} chars ===`);

// Verify: no brackets, no labels, no meta-instructions
const hasBrackets = /\[.*?\]/.test(finalPrompt);
const hasLabels = /\b(Hook|Line \d|CTA|SCENE DIRECTION|VISUAL ONLY|SPOKEN DIALOGUE):/i.test(finalPrompt);
const hasMeta = /DO NOT SPEAK|read each line|exactly as written/i.test(finalPrompt);
console.log(`\n=== QUALITY CHECKS ===`);
console.log(`  No brackets: ${!hasBrackets ? 'PASS' : 'FAIL'}`);
console.log(`  No labels: ${!hasLabels ? 'PASS' : 'FAIL'}`);
console.log(`  No meta-instructions: ${!hasMeta ? 'PASS' : 'FAIL'}`);
