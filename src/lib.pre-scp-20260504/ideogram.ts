/**
 * Ideogram — AI Image Generation with Superior Text Rendering
 * https://developer.ideogram.ai/api-reference/generate-image
 *
 * Primary provider for text-heavy direct-response Meta statics.
 * Best at: readable headlines, offer stacks, review statics, social proof.
 */

const BASE_URL = 'https://api.ideogram.ai';
const API_KEY = () => process.env.IDEOGRAM_API_KEY || '';

export interface IdeogramImageResult {
  imageUrl: string;
  model: string;
}

export async function generateImage(
  prompt: string,
  options: {
    aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9' | '3:4' | '4:3';
    model?: 'V_2' | 'V_2_TURBO';
    magicPromptOption?: 'AUTO' | 'ON' | 'OFF';
    styleType?: 'GENERAL' | 'REALISTIC' | 'DESIGN' | 'RENDER_3D' | 'ANIME';
  } = {}
): Promise<IdeogramImageResult> {
  const key = API_KEY();
  if (!key) {
    const err = new Error('IDEOGRAM_API_KEY not set') as any;
    err.code = 'MISSING_KEY';
    err.retryable = false;
    err.failoverEligible = true;
    throw err;
  }

  const model = options.model || 'V_2A';
  const body = {
    image_request: {
      prompt: prompt.substring(0, 10000),
      model,
      aspect_ratio: 'ASPECT_3_4', // placeholder — overwritten below by arMap
      magic_prompt_option: options.magicPromptOption || 'AUTO',
      style_type: options.styleType || 'REALISTIC',
    },
  };

  // Map aspect ratio to Ideogram supported values
  // Supported: ASPECT_10_16, ASPECT_16_10, ASPECT_9_16, ASPECT_16_9,
  //            ASPECT_3_2, ASPECT_2_3, ASPECT_4_3, ASPECT_3_4,
  //            ASPECT_1_1, ASPECT_1_3, ASPECT_3_1
  // Note: 4:5 not supported — use 3:4 (closest portrait ratio for Meta)
  const arMap: Record<string, string> = {
    '1:1': 'ASPECT_1_1',
    '4:5': 'ASPECT_3_4',   // closest to 4:5 for Meta
    '3:4': 'ASPECT_3_4',
    '9:16': 'ASPECT_9_16',
    '16:9': 'ASPECT_16_9',
    '4:3': 'ASPECT_4_3',
    '3:2': 'ASPECT_3_2',
    '2:3': 'ASPECT_2_3',
  };
  body.image_request.aspect_ratio = arMap[options.aspectRatio || '4:5'] || 'ASPECT_3_4';

  console.log(`[IDEOGRAM] Generating image: model=${model}, aspect=${body.image_request.aspect_ratio}, prompt=${prompt.substring(0, 80)}...`);

  const res = await fetch(`${BASE_URL}/generate`, {
    method: 'POST',
    headers: {
      'Api-Key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    const err = new Error(`Ideogram API error ${res.status}: ${text.substring(0, 300)}`) as any;
    err.status = res.status;
    err.retryable = res.status >= 500;
    err.failoverEligible = true;
    err.isQuota = res.status === 429 || res.status === 402;
    throw err;
  }

  const data = await res.json();
  const imageUrl = data?.data?.[0]?.url;

  if (!imageUrl) {
    const err = new Error('Ideogram returned no image') as any;
    err.code = 'NO_IMAGE';
    err.retryable = true;
    err.failoverEligible = true;
    throw err;
  }

  return { imageUrl, model: `ideogram-${model.toLowerCase()}` };
}
