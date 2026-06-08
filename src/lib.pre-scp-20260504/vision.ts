/**
 * Vision utilities — describe a product image in detailed text so a
 * text-to-video engine can render the product faithfully without
 * using the image as a literal opening frame.
 *
 * Uses Gemini 2.5 Flash (cheap, fast). Falls back gracefully if
 * the API is unavailable — caller receives null.
 */

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || '';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Small in-memory cache so repeated launches in the same hour for the
// same cover image don't re-run vision. Key: imageUrl (stripped of query).
const descriptionCache = new Map<string, { description: string; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch an image URL and convert to base64 + mime type.
 * Falls back to null if the URL can't be fetched.
 */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    // Local /api/products/uploads files — read directly from disk (avoids auth + URL parse issues)
    if (url.startsWith('/api/products/uploads?file=') || url.startsWith('/api/products/uploads%3Ffile=')) {
      const { readFile } = await import('fs/promises');
      const path = await import('path');
      const filename = new URL(url, 'http://localhost').searchParams.get('file');
      if (!filename) return null;
      const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
      const buf = await readFile(filePath);
      const ext = filename.split('.').pop()?.toLowerCase() || 'png';
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
      console.log(`[VISION] Read local file: ${filename} (${buf.length} bytes)`);
      return { data: buf.toString('base64'), mimeType };
    }
    // Other local paths
    let fetchUrl = url;
    if (url.startsWith('/api/') || url.startsWith('/uploads/')) {
      fetchUrl = `http://localhost:${process.env.PORT || 3001}${url}`;
    }
    const res = await fetch(fetchUrl);
    if (!res.ok) {
      console.error(`[VISION] Failed to fetch image ${url.substring(0, 80)}: HTTP ${res.status}`);
      return null;
    }
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    const buf = await res.arrayBuffer();
    const data = Buffer.from(buf).toString('base64');
    return { data, mimeType };
  } catch (e: any) {
    console.error(`[VISION] fetch error: ${e.message}`);
    return null;
  }
}

/**
 * Describe a product image in tight visual detail for downstream text-to-video
 * prompts. Returns a ~2-4 sentence description OR null if vision failed.
 *
 * Deterministic — same image → same description (cached for 1h).
 */
export async function describeProductImage(
  imageUrl: string,
  productName?: string,
): Promise<string | null> {
  if (!imageUrl) return null;
  const cacheKey = imageUrl.split('?')[0];
  const cached = descriptionCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log(`[VISION] Cache hit for ${cacheKey.substring(0, 80)}`);
    return cached.description;
  }

  const key = GEMINI_KEY();
  if (!key) {
    console.error('[VISION] GEMINI_API_KEY not set — cannot describe image');
    return null;
  }

  const imgData = await fetchImageAsBase64(imageUrl);
  if (!imgData) return null;

  const productLabel = productName ? ` The product is "${productName}".` : '';
  const promptText = `You are describing a product photo so that another AI model can render the EXACT same product inside a video without seeing the original photo.${productLabel} Write a tight, concrete visual description (~3 sentences, 60-90 words). Cover: packaging shape and silhouette, dominant colors, label style and any distinctive text/logos visible, distinguishing marks or elements that let someone recognize this product. Do NOT describe the background. Do NOT invent details that aren't visible. Output ONLY the description — no preface, no bullet points.`;

  try {
    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: promptText },
          { inline_data: { mime_type: imgData.mimeType, data: imgData.data } },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
      },
    };
    const url = `${BASE_URL}/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      console.error(`[VISION] Gemini error ${res.status}: ${errText.substring(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map((p: any) => p.text || '').join(' ').trim();
    if (!text) {
      console.error('[VISION] Gemini returned empty description');
      return null;
    }
    const description = text.substring(0, 800);
    descriptionCache.set(cacheKey, { description, ts: Date.now() });
    // Evict old entries (max 200)
    if (descriptionCache.size > 200) {
      const oldest = [...descriptionCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) descriptionCache.delete(oldest[0]);
    }
    console.log(`[VISION] Described ${cacheKey.substring(0, 80)}: ${description.substring(0, 120)}...`);
    return description;
  } catch (e: any) {
    console.error(`[VISION] Describe error: ${e.message}`);
    return null;
  }
}

/**
 * Product image classification types.
 * Used to block back_label and low_quality images from being used as primary.
 */
export type ImageClassification = 'front' | 'lifestyle' | 'infographic' | 'back_label' | 'low_quality' | 'unknown';

// Classification cache — keyed by image URL (stripped of query params)
const classificationCache = new Map<string, { label: ImageClassification; ts: number }>();
const CLASS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — images rarely change classification

/**
 * Classify a product image as front/lifestyle/infographic/back_label/low_quality.
 * Uses Gemini Vision. Cached for 24h. Returns 'unknown' if classification fails.
 */
export async function classifyProductImage(imageUrl: string): Promise<ImageClassification> {
  if (!imageUrl) return 'unknown';
  const cacheKey = imageUrl.split('?')[0];
  const cached = classificationCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CLASS_CACHE_TTL) return cached.label;

  const key = GEMINI_KEY();
  if (!key) return 'unknown';

  const imgData = await fetchImageAsBase64(imageUrl);
  if (!imgData) return 'unknown';

  try {
    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: 'Classify this product image into EXACTLY ONE of these categories. Reply with only the category label, nothing else:\n- front (product front face, label/brand clearly visible)\n- lifestyle (product in a lifestyle scene, person using it, or styled photo)\n- infographic (nutritional facts chart, ingredient list, feature callout graphic)\n- back_label (back or side of packaging, supplement facts panel, barcode, small print)\n- low_quality (blurry, badly lit, unprofessional)\n\nReply with ONLY the label word.' },
          { inline_data: { mime_type: imgData.mimeType, data: imgData.data } },
        ],
      }],
      generationConfig: { temperature: 0.0, maxOutputTokens: 20 },
    };
    const url = `${BASE_URL}/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return 'unknown';
    const data = await res.json();
    const raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
    const valid: ImageClassification[] = ['front', 'lifestyle', 'infographic', 'back_label', 'low_quality'];
    const label: ImageClassification = valid.includes(raw as any) ? raw as ImageClassification : 'unknown';
    classificationCache.set(cacheKey, { label, ts: Date.now() });
    console.log(`[VISION] Classified ${cacheKey.substring(0, 80)} → ${label}`);
    return label;
  } catch (e: any) {
    console.error(`[VISION] Classification error: ${e.message}`);
    return 'unknown';
  }
}
