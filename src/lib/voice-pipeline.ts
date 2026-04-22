/**
 * Universal Voice Pipeline — Platform-wide TTS preparation.
 *
 * Works across ALL products, stores, and creative types.
 * No category-specific assumptions. No product-specific hacks.
 *
 * Pipeline: raw script → universal cleaner → TTS-ready text
 *
 * Voice provider: OpenAI TTS (interim) → ElevenLabs (when key available)
 * Voice: nova (clear American English female)
 * Model: tts-1-hd (highest quality)
 * Language: en-US ONLY
 * Speed: 1.0
 */

// ═══════════════════════════════════════════════════════════
// UNIVERSAL SCRIPT NORMALIZER
// Converts ANY script into clean spoken English.
// No product-specific logic — works for supplements, skincare,
// 3PL, beauty, fashion, food, tech, or any vertical.
// ═══════════════════════════════════════════════════════════

const NUMBER_WORDS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen',
  '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
  '18': 'eighteen', '19': 'nineteen', '20': 'twenty', '25': 'twenty five',
  '30': 'thirty', '40': 'forty', '45': 'forty five', '50': 'fifty',
  '60': 'sixty', '75': 'seventy five', '90': 'ninety',
  '100': 'one hundred', '200': 'two hundred', '500': 'five hundred',
  '1000': 'one thousand',
};

// Universal abbreviation dictionary — NOT product-specific.
// These are abbreviations that appear across many industries.
const ABBREVIATION_MAP: Record<string, string> = {
  // Scientific / supplement
  'GLP-1': 'G L P one', 'glp-1': 'G L P one',
  'NAD+': 'N A D plus', 'nad+': 'N A D plus',
  'CoQ10': 'co Q ten', 'coq10': 'co Q ten',
  // Vitamins
  'B12': 'B twelve', 'b12': 'B twelve',
  'B6': 'B six', 'b6': 'B six',
  'D3': 'D three', 'd3': 'D three',
  'K2': 'K two', 'k2': 'K two',
  // Beauty / skincare
  'SPF': 'S P F', 'spf': 'S P F',
  'pH': 'P H', 'ph': 'P H',
  'UV': 'U V', 'uv': 'U V',
  // Marketing
  'UGC': 'U G C', 'DTC': 'D T C', 'CTA': 'C T A',
  'BOGO': 'buy one get one', 'bogo': 'buy one get one',
  'ROAS': 'return on ad spend',
  'ROI': 'R O I',
  // Units
  'mg': 'milligrams', 'mcg': 'micrograms',
  'oz': 'ounces', 'fl oz': 'fluid ounces',
  'ml': 'milliliters', 'lbs': 'pounds', 'kg': 'kilograms',
  // Common
  'vs': 'versus', 'w/': 'with', 'w/o': 'without',
  'btw': 'by the way', 'tbh': 'to be honest',
  'imo': 'in my opinion', 'fyi': 'for your information',
  'FAQ': 'frequently asked questions',
  'AI': 'A I',
};

/**
 * Universal script normalizer — works for ANY product/brand.
 * Converts raw ad scripts into clean, speakable American English.
 */
export function normalizeScript(script: string): string {
  let s = script;

  // 1. Remove emojis and special unicode
  s = s.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{FE0F}\u{2764}\u{2022}\u{25CF}\u{25CB}\u{2605}\u{2B50}]/gu, '');

  // 2. Replace typographic characters with plain equivalents
  s = s.replace(/[–—]/g, ', ')
    .replace(/…/g, '.')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[™®©]/g, '')
    .replace(/\|/g, ', ')
    .replace(/[•·]/g, ', ');

  // 3. Convert dollar amounts: $49 → forty nine dollars
  s = s.replace(/\$(\d+(?:\.\d{2})?)/g, (_, amount) => {
    const num = parseFloat(amount);
    if (Number.isInteger(num) && NUMBER_WORDS[String(num)]) {
      return `${NUMBER_WORDS[String(num)]} dollars`;
    }
    return `${amount} dollars`;
  });

  // 4. Convert percentages: 20% → twenty percent
  s = s.replace(/(\d+)%/g, (_, n) => `${NUMBER_WORDS[n] || n} percent`);

  // 5. Replace abbreviations (longest first)
  const sortedAbbrevs = Object.entries(ABBREVIATION_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [abbrev, spoken] of sortedAbbrevs) {
    const escaped = abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\b${escaped}\\b`, 'g'), spoken);
  }

  // 6. Convert "X-in-Y" patterns: 12-in-1 → twelve in one
  s = s.replace(/(\d+)-in-(\d+)/gi, (_, a, b) => `${NUMBER_WORDS[a] || a} in ${NUMBER_WORDS[b] || b}`);

  // 7. Convert standalone small numbers to words
  s = s.replace(/\b(\d{1,3})\b/g, (match) => NUMBER_WORDS[match] || match);

  // 8. Remove hashtags but keep the word
  s = s.replace(/#(\w+)/g, '$1');

  // 9. Remove URLs
  s = s.replace(/https?:\/\/\S+/gi, '');

  // 10. Remove ALL CAPS spam (3+ consecutive uppercase words)
  s = s.replace(/\b([A-Z]{2,}\s+){3,}/g, (match) =>
    match.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  );

  // 11. Remove excessive punctuation
  s = s.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?').replace(/\.{4,}/g, '...');

  // 12. Remove stage directions and brackets
  s = s.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '');

  // 13. Remove technical prompt language that shouldn't be spoken
  s = s.replace(/^(CAMERA|LIGHTING|STYLE|TECHNICAL|RULES|COMPOSITION|VISUAL|HOOK|CTA|OPENING|PRODUCT VISUAL|PRONUNCIATION|VOICE AND LANGUAGE)[:].*/gm, '');
  s = s.replace(/^(Script|Scene \d+|Shot \d+).*?:/gmi, '');

  // 14. Break into short sentences (max ~15 words per sentence)
  // Split on periods, exclamations, questions
  const rawSentences = s.split(/(?<=[.!?])\s+/).filter(t => t.trim().length > 2);
  const shortSentences: string[] = [];
  for (const sent of rawSentences) {
    const words = sent.trim().split(/\s+/);
    if (words.length <= 15) {
      shortSentences.push(sent.trim());
    } else {
      // Split long sentences at natural break points
      let chunk: string[] = [];
      for (const word of words) {
        chunk.push(word);
        if (chunk.length >= 10 && /[,;:]/.test(word)) {
          shortSentences.push(chunk.join(' '));
          chunk = [];
        }
      }
      if (chunk.length > 0) shortSentences.push(chunk.join(' '));
    }
  }
  s = shortSentences.join(' ');

  // 15. Final cleanup
  s = s.replace(/\s+/g, ' ').replace(/\s+([.!?,])/g, '$1').trim();

  return s;
}

// ═══════════════════════════════════════════════════════════
// UNIVERSAL TTS FORMATTER
// Outputs clean, spoken-ready text with natural pacing.
// ═══════════════════════════════════════════════════════════

/**
 * Format a normalized script for TTS output.
 * Adds natural pauses and pacing without product-specific assumptions.
 */
export function formatForTTS(script: string): string {
  let s = script;

  // Add brief pauses before key transition words
  const pauseWords = ['but', 'however', 'actually', 'finally', 'here is the thing', 'the truth is', 'what if'];
  for (const word of pauseWords) {
    s = s.replace(new RegExp(`\\b(${word})\\b`, 'gi'), '. $1');
  }

  // Add pause before CTA phrases
  const ctaPhrases = ['shop now', 'try it', 'get yours', 'click below', 'link in bio', 'order now', 'buy now', 'learn more', 'see why', 'find out'];
  for (const phrase of ctaPhrases) {
    s = s.replace(new RegExp(`(${phrase})`, 'gi'), '. $1');
  }

  // Clean up artifacts
  s = s.replace(/\.\s*\./g, '.').replace(/,\s*\./g, '.').replace(/\s+/g, ' ').trim();

  return s;
}

// ═══════════════════════════════════════════════════════════
// VOICE SETTINGS — locked to clear American English
// ═══════════════════════════════════════════════════════════

export const VOICE_CONFIG = {
  provider: 'openai-tts' as const,  // swap to 'elevenlabs' when key available
  voice: 'nova' as const,           // clear American English female
  model: 'tts-1-hd' as const,       // highest quality
  speed: 1.0,                       // natural pace
  language: 'en-US',
  // DO NOT CHANGE without explicit user request:
  // - no auto-switching voices
  // - no multilingual models
  // - no experimental voices
};

/**
 * Build language enforcement block for video generation prompts.
 * Injected into Seedance/Sora prompts to guide the visual acting.
 */
export function buildLanguageEnforcement(): string {
  return `
LANGUAGE RULES (STRICT — DO NOT BREAK):
- Language: American English only. en-US.
- Every spoken word must be a real English word.
- Do not generate phonetic sounds, gibberish, or non-English speech.
- Do not drift into other languages mid-sentence.
- All dialogue must be clear, natural, and understandable on first listen.
- Voice: confident, energetic American female.`;
}

/**
 * Chunk a spoken script into short, simple segments for Seedance.
 *
 * Seedance audio drifts into gibberish on long or complex text.
 * This function breaks the script into Hook / Body / CTA chunks,
 * each under ~12 words, with no compound ideas.
 *
 * Returns a formatted block like:
 *   SPOKEN DIALOGUE (read exactly as written):
 *   Hook: "Wait. Nobody told me this."
 *   Line 1: "This balm changed how my skin feels."
 *   Line 2: "It absorbs fast and locks in moisture."
 *   CTA: "Try this. Link below."
 */
export function chunkScriptForSeedance(script: string): string {
  // First normalize through the standard pipeline
  let clean = normalizeScript(script);

  // Aggressively simplify problematic patterns
  // Remove any remaining abbreviation-like patterns the normalizer missed
  clean = clean.replace(/\b[A-Z]-\d+\b/g, '');               // "G L P one" leftover
  clean = clean.replace(/\b\w+-in-\w+\b/gi, (m) => {         // any remaining X-in-Y
    return m.replace(/-/g, ' ');
  });
  clean = clean.replace(/\d+\.\d+/g, '');                     // decimal numbers
  clean = clean.replace(/\b\d{4,}\b/g, '');                   // large numbers (4+ digits)
  clean = clean.replace(/[\/\\&+=#@^~`{}[\]<>]/g, ' ');       // symbols that cause drift
  clean = clean.replace(/\s*[,;:]\s*(?:and|but|or|which|that|where|when|because|since|while|although)\s/gi, '. ');  // break compound sentences

  // Split into sentences
  const rawSentences = clean
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 3 && /[a-zA-Z]/.test(s));

  // Further split any sentence over 10 words (strict limit for Seedance body safety)
  const shortSentences: string[] = [];
  for (const sent of rawSentences) {
    const words = sent.split(/\s+/);
    if (words.length <= 10) {
      shortSentences.push(sent);
    } else {
      // Split at comma or at 8 words max
      let chunk: string[] = [];
      for (const word of words) {
        chunk.push(word);
        if (chunk.length >= 6 && (word.endsWith(',') || chunk.length >= 10)) {
          let text = chunk.join(' ');
          if (!text.match(/[.!?]$/)) text += '.';
          shortSentences.push(text);
          chunk = [];
        }
      }
      if (chunk.length > 0) {
        let text = chunk.join(' ');
        if (!text.match(/[.!?]$/)) text += '.';
        shortSentences.push(text);
      }
    }
  }

  if (shortSentences.length === 0) {
    return `SPOKEN DIALOGUE (read exactly as written, in English):\nHook: "Check out this product."\nCTA: "Try it today."`;
  }

  // Assign roles: first = Hook, last = CTA, middle = Body lines
  const hook = shortSentences[0];
  const cta = shortSentences.length > 1 ? shortSentences[shortSentences.length - 1] : 'Try it today.';
  const bodyLines = shortSentences.length > 2 ? shortSentences.slice(1, -1) : [];

  // Build the chunked format
  const lines: string[] = [
    `SPOKEN DIALOGUE (read each line exactly as written, in clear American English):`,
    `Hook: "${hook}"`,
  ];

  for (let i = 0; i < bodyLines.length && i < 4; i++) {
    lines.push(`Line ${i + 1}: "${bodyLines[i]}"`);
  }

  lines.push(`CTA: "${cta}"`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════
// MASTER PIPELINE — the single entry point
// ═══════════════════════════════════════════════════════════

/**
 * Process any script through the universal voice pipeline.
 * Returns clean, TTS-ready spoken English.
 *
 * Works for: supplements, skincare, 3PL, beauty, fashion, food, tech,
 * offer ads, testimonials, educational content — anything.
 */
export function processVoicePipeline(
  script: string,
  options: { funnelStage?: string } = {}
): string {
  // Step 1: Universal normalization
  let processed = normalizeScript(script);

  // Step 2: Format for TTS (natural pacing)
  processed = formatForTTS(processed);

  // Step 3: Final quality check — reject if too short or nonsensical
  if (processed.length < 10) {
    console.warn('[VOICE] Script too short after normalization:', processed);
    return script; // return original as fallback
  }

  console.log(`[VOICE] Processed script: ${processed.length} chars, original: ${script.length} chars`);
  return processed;
}

/**
 * Extract ONLY the spoken dialogue from a video generation prompt.
 * Aggressively strips ALL technical directions, camera instructions,
 * pacing notes, product references, and prompt engineering text.
 * Returns ONLY the words that should be spoken aloud by the TTS voice.
 */
export function extractSpokenScript(prompt: string): string {
  // 1. Try to find an explicit "Script" section with the actual dialogue
  const scriptPatterns = [
    /Script\s*\([^)]*\)\s*:\s*([\s\S]+?)(?=\n\s*\n|\nScene\s|OPENING|TECHNICAL|VOICE|CAMERA|RULES|PRODUCT|STYLE|$)/i,
    /Script[^:]*:\s*([\s\S]+?)(?=\n\s*\n|\nScene\s|OPENING|TECHNICAL|VOICE|CAMERA|RULES|PRODUCT|STYLE|$)/i,
    /(?:speak|say|dialogue|voiceover)\s*:\s*([\s\S]+?)(?=\n\s*\n|$)/i,
  ];
  for (const pattern of scriptPatterns) {
    const match = prompt.match(pattern);
    if (match?.[1]?.trim() && match[1].trim().length > 20) {
      return normalizeScript(match[1].trim());
    }
  }

  // 2. No explicit script section — aggressively strip ALL non-spoken content
  let lines = prompt.split('\n');

  // Remove lines that are clearly technical/prompt directions
  lines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.length < 5) return false;

    // Kill any line starting with technical keywords
    if (/^(CAMERA|LIGHTING|STYLE|TECHNICAL|RULES|COMPOSITION|VISUAL|PRODUCT|OPENING|PRONUNCIATION|VOICE|CRITICAL|IMPORTANT|AVOID|LAYOUT|TEXT|Hook|Proof|CTA|Offer|Colors|FORMAT|FAST-PACED|This is a|PRODUCT VISUAL|PRODUCT REFERENCE|Scene timing|B-roll|Presenter|BRAND FIDELITY|RULES:|UGC|Handheld|iPhone|Do NOT|Do not|Generate|Match|Aspect ratio|Photorealistic|Selfie mode|Output:|OPENING:)/i.test(trimmed)) return false;

    // Kill bullet points and numbered lists
    if (/^[-•*]\s/.test(trimmed)) return false;
    if (/^\d+\.\s/.test(trimmed)) return false;

    // Kill lines with colons that look like key:value pairs
    if (/^[A-Z][A-Z\s]{2,}:/.test(trimmed)) return false;

    // Kill lines mentioning technical terms
    if (/\b(aspect ratio|resolution|pacing|lighting|camera|frame|thumbnail|scroll-stop|mobile-first|UGC|direct-response|conversion|CTA button)\b/i.test(trimmed)) return false;

    // Kill prompt instructions
    if (/\b(do not|must be|should be|make sure|ensure|avoid|never|always|critical|important|strict)\b/i.test(trimmed) && trimmed.length < 80) return false;

    // Kill duration/timing references
    if (/\b(\d+-second|\d+s\b|seconds|duration|aspect|9:16|16:9|4:5|480p|720p)\b/i.test(trimmed)) return false;

    return true;
  });

  let spoken = lines.join(' ').trim();

  // 3. If nothing meaningful survived, try a last resort: find quoted speech
  if (spoken.length < 20) {
    const quotes = prompt.match(/"([^"]{10,200})"/g);
    if (quotes && quotes.length > 0) {
      spoken = quotes.map(q => q.replace(/"/g, '')).join('. ');
    }
  }

  // 4. Final fallback: first 3 non-technical sentences from the prompt
  if (spoken.length < 20) {
    const sentences = prompt.split(/[.!?]+/).filter(s => {
      const t = s.trim();
      return t.length > 10 && !/^(This is|CAMERA|PRODUCT|RULES|Do not|Generate|Make|Create|Use the)/i.test(t);
    });
    spoken = sentences.slice(0, 3).join('. ').trim();
  }

  if (spoken.length < 10) {
    console.warn('[VOICE] Could not extract spoken script — text too short after filtering');
    return 'Check out this amazing product. You have to try it.';
  }

  return normalizeScript(spoken);
}
