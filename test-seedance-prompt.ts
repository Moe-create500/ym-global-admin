import { parsePromptIntoScenes } from './src/lib/seedance-pipeline';
import { normalizeScript } from './src/lib/voice-pipeline';

// Simulate the NEW Seedance prompt from frontend (clean — just quoted dialogue)
const samplePrompt = `"My skin was so angry. Then I found this serum. It helps skin feel calm. You need to try this."

Female UGC, front-camera selfie style. Natural indoor lighting. Casual home setting.`;

const scenes = parsePromptIntoScenes(samplePrompt, 15, true);

const mergedScene = {
  sceneIndex: 0,
  spokenScript: scenes.map(s => s.spokenScript).join(' '),
  visualPrompt: scenes[0]?.visualPrompt || '',
  duration: 15,
  productVisible: true,
  productInHand: true,
  productNearFace: false,
};

console.log('=== PARSED ===');
console.log(`Spoken: "${mergedScene.spokenScript}"`);
console.log(`Visual: "${mergedScene.visualPrompt.substring(0, 100)}"`);

// Now simulate what renderScene() builds
const cleanDialogue = normalizeScript(mergedScene.spokenScript).trim();
const allSentences = cleanDialogue.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 3);
const chunks: string[] = [];
for (const sent of allSentences) {
  const words = sent.trim().split(/\s+/);
  if (words.length <= 10) {
    chunks.push(sent.trim());
  } else {
    let buf: string[] = [];
    for (const w of words) {
      buf.push(w);
      if (buf.length >= 7 && (/[,;]$/.test(w) || buf.length >= 10)) {
        let t = buf.join(' ');
        if (!/[.!?]$/.test(t)) t += '.';
        chunks.push(t);
        buf = [];
      }
    }
    if (buf.length > 0) {
      let t = buf.join(' ');
      if (!/[.!?]$/.test(t)) t += '.';
      chunks.push(t);
    }
  }
}

console.log('\n=== DIALOGUE CHUNKS ===');
chunks.forEach((c, i) => console.log(`  ${i}: "${c}" (${c.split(/\s+/).length} words)`));

// Build the action-sequence prompt
const productDescription = 'skincare serum bottle';
const emotions = ['looks at camera and says:', 'earnestly says:', 'smiles and says:', 'nods and says:'];
const actions = ['She holds up the product.', 'She shows the label to camera.', 'She touches her skin gently.', 'She applies product to her hand.'];

const promptParts: string[] = [];
promptParts.push(`UGC creator, iPhone, natural lighting, medium close-up. A young woman holding a ${productDescription} in a bright room.`);

if (chunks.length === 1) {
  promptParts.push(`She looks at camera and says: "${chunks[0]}"`);
} else if (chunks.length > 1) {
  promptParts.push(`She looks at camera and says: "${chunks[0]}"`);
  for (let i = 1; i < chunks.length - 1 && i < 4; i++) {
    promptParts.push(actions[i - 1]);
    promptParts.push(`She ${emotions[i % emotions.length]} "${chunks[i]}"`);
  }
  promptParts.push(`She smiles and says: "${chunks[chunks.length - 1]}"`);
}
promptParts.push('Dialogue clean and prominent, no music, no text on screen.');

const finalPrompt = promptParts.join(' ');

console.log('\n=== FINAL SEEDANCE PROMPT ===');
console.log(finalPrompt);
console.log(`\n=== ${finalPrompt.length} chars ===`);

// Quality checks
const hasLabels = /\b(Hook|Line \d|CTA|SCENE|VISUAL|PRODUCT REFERENCE|Creative style|Presenter|Script|FAST-PACED|CRITICAL PACING):/i.test(finalPrompt);
const hasBrackets = /\[.*?\]/.test(finalPrompt);
const maxWordsPerLine = chunks.reduce((max, c) => Math.max(max, c.split(/\s+/).length), 0);
console.log(`\n=== QUALITY ===`);
console.log(`  No labels: ${!hasLabels ? 'PASS' : 'FAIL'}`);
console.log(`  No brackets: ${!hasBrackets ? 'PASS' : 'FAIL'}`);
console.log(`  Max words per chunk: ${maxWordsPerLine} ${maxWordsPerLine <= 10 ? 'PASS' : 'WARN'}`);
console.log(`  Has emotion labels: ${/earnestly|smiles|looks at camera/.test(finalPrompt) ? 'PASS' : 'FAIL'}`);
console.log(`  Has action beats: ${/holds up|shows the label|touches/.test(finalPrompt) ? 'PASS' : 'FAIL'}`);
console.log(`  Has audio directive: ${/no music/.test(finalPrompt) ? 'PASS' : 'FAIL'}`);
