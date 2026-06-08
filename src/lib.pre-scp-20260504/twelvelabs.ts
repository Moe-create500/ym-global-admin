/**
 * Twelve Labs — Video Understanding API
 * https://docs.twelvelabs.io/api-reference/
 *
 * Uses Pegasus 1.2 to analyze video ad creatives and extract
 * creative DNA: hooks, pacing, energy, transitions, camera work, etc.
 */

const BASE_URL = 'https://api.twelvelabs.io/v1.3';
const API_KEY = () => process.env.TWELVELABS_API_KEY || '';

async function tlFetch(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any) {
  const key = API_KEY();
  if (!key) throw new Error('TWELVELABS_API_KEY not set');

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      'x-api-key': key,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Twelve Labs API error ${res.status}: ${text}`);
  }

  return res.json();
}

/** Upload using multipart/form-data (required for tasks endpoint) */
async function tlFormUpload(endpoint: string, formData: FormData) {
  const key = API_KEY();
  if (!key) throw new Error('TWELVELABS_API_KEY not set');

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'x-api-key': key },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Twelve Labs API error ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Index Management ──

export async function createIndex(name: string): Promise<string> {
  const data = await tlFetch('/indexes', 'POST', {
    index_name: name,
    models: [
      {
        model_name: 'pegasus1.2',
        model_options: ['visual', 'audio'],
      },
    ],
  });
  return data._id;
}

export async function listIndexes(): Promise<any[]> {
  const data = await tlFetch('/indexes?page=1&page_limit=10');
  return data.data || [];
}

export async function getOrCreateIndex(name: string): Promise<string> {
  const indexes = await listIndexes();
  const existing = indexes.find((i: any) => i.index_name === name);
  if (existing) return existing._id;
  return createIndex(name);
}

// ── Video Upload & Indexing ──

/**
 * Download a video from URL and upload to Twelve Labs as multipart form-data.
 * Facebook preview URLs redirect to pages, so we follow redirects to find the actual video.
 */
export async function indexVideoByUrl(indexId: string, videoUrl: string): Promise<{ taskId: string; videoId: string }> {
  // Download the video file first
  const videoRes = await fetch(videoUrl, { redirect: 'follow' });
  if (!videoRes.ok) {
    throw new Error(`Failed to download video: ${videoRes.status} ${videoRes.statusText}`);
  }

  const videoArrayBuffer = await videoRes.arrayBuffer();
  const contentType = videoRes.headers.get('content-type') || 'video/mp4';

  // Determine file extension
  let ext = 'mp4';
  if (contentType.includes('webm')) ext = 'webm';
  else if (contentType.includes('quicktime') || contentType.includes('mov')) ext = 'mov';

  // Upload as multipart form-data
  const formData = new FormData();
  formData.append('index_id', indexId);
  formData.append('video_file', new Blob([new Uint8Array(videoArrayBuffer)], { type: contentType }), `video.${ext}`);

  const data = await tlFormUpload('/tasks', formData);
  return { taskId: data._id, videoId: data.video_id };
}

/**
 * Index a video from a local file buffer.
 */
export async function indexVideoFromBuffer(
  indexId: string,
  buffer: Buffer,
  filename: string = 'video.mp4',
  mimeType: string = 'video/mp4'
): Promise<{ taskId: string; videoId: string }> {
  const formData = new FormData();
  formData.append('index_id', indexId);
  formData.append('video_file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

  const data = await tlFormUpload('/tasks', formData);
  return { taskId: data._id, videoId: data.video_id };
}

export async function getTaskStatus(taskId: string): Promise<{ status: string; videoId: string }> {
  const data = await tlFetch(`/tasks/${taskId}`);
  return { status: data.status, videoId: data.video_id };
}

/** Poll until task is ready or failed. Timeout after maxWaitMs. */
export async function waitForTask(taskId: string, maxWaitMs: number = 120000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { status, videoId } = await getTaskStatus(taskId);
    if (status === 'ready') return videoId;
    if (status === 'failed') throw new Error('Video indexing failed');
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Video indexing timed out');
}

// ── Video Analysis (Pegasus) ──

const AD_ANALYSIS_PROMPT = `You are analyzing a Facebook/Meta video advertisement. Break down EVERY creative element in exhaustive detail. This analysis will be used to recreate similar high-performing ads.

Analyze the following in extreme detail:

1. THE HOOK (First 1-3 seconds):
- What EXACTLY happens in the first 1-3 seconds that stops the scroll?
- Is it a visual shock, a bold text overlay, a question, a dramatic action, an unboxing, a face-to-camera moment?
- Describe the exact visual frame-by-frame

2. CONTENT CREATOR / PERSON:
- Who is on screen? Age, gender, appearance, energy level
- Are they talking to camera (UGC style) or shown in a lifestyle scene?
- What is their emotional state? Excited, calm, skeptical, enthusiastic?
- Body language — are they holding the product, pointing, gesturing?
- Speaking style — fast/slow, casual/professional, loud/soft?

3. PACING & EDIT RHYTHM:
- How many cuts are in the video? Fast cuts (<1s) or slow takes?
- Where do cuts happen — on action, on dialogue, on product reveals?
- Does the pacing speed up or slow down at certain moments?
- Are there any slow-motion or speed-ramp moments?

4. CAMERA WORK:
- What angles are used? (close-up, medium, wide, overhead, POV, selfie)
- Is it handheld/shaky or stable/tripod?
- Any camera movements? (pan, tilt, zoom, tracking, whip pan)
- Is it shot vertically (9:16) or horizontally?

5. TRANSITIONS:
- What transition types are used? (jump cut, dissolve, swipe, zoom, whip pan, match cut)
- How do scenes connect to each other?

6. LIGHTING & COLOR:
- Natural light or artificial? Warm or cool tones?
- Indoor or outdoor? What time of day does it look like?
- Any color grading? Saturated, desaturated, warm filter?

7. PRODUCT PLACEMENT:
- When does the product first appear? How much screen time?
- How is it shown? In hand, on table, being used, close-up of packaging?
- Is the product the hero or the person the hero?

8. TEXT OVERLAYS & GRAPHICS:
- List ALL on-screen text word-for-word
- What style? (bold, handwritten, animated, static)
- Colors and positioning of text
- Any graphics, icons, stickers, or emojis?

9. EMOTIONAL ARC:
- Map the emotional journey second-by-second
- Where is the tension? The relief? The excitement? The CTA moment?
- What feeling does the viewer walk away with?

10. AUDIO & MUSIC:
- Is there background music? What genre/energy?
- Voiceover or speaking to camera?
- Any sound effects (ding, whoosh, pop)?
- How does audio reinforce the visual message?

11. CTA & CLOSE:
- How does the video end?
- What is the call-to-action? Verbal, text, or both?
- How urgent is the closing — countdown, limited offer, social proof?

12. OVERALL CREATIVE STRATEGY:
- What marketing angle is this? (UGC, testimonial, comparison, problem-solution, before/after, listicle, native content)
- What makes this ad effective? Why would someone stop scrolling AND click?
- What emotional triggers are being pulled?

Be extremely specific and detailed. Describe what you SEE, not what you assume.`;

export interface VideoAnalysis {
  videoId: string;
  analysis: string;
}

export async function analyzeVideo(videoId: string, prompt?: string): Promise<VideoAnalysis> {
  const data = await tlFetch('/analyze', 'POST', {
    video_id: videoId,
    prompt: prompt || AD_ANALYSIS_PROMPT,
    stream: false,
    temperature: 0.2,
    max_tokens: 4096,
  });

  return {
    videoId,
    analysis: data.data || '',
  };
}

/**
 * Full pipeline: upload video URL → wait for indexing → analyze creative DNA.
 * Returns the detailed analysis text.
 */
export async function analyzeVideoFromUrl(
  videoUrl: string,
  indexId?: string
): Promise<VideoAnalysis> {
  const idx = indexId || await getOrCreateIndex('ad-creatives');
  const { taskId } = await indexVideoByUrl(idx, videoUrl);
  const videoId = await waitForTask(taskId, 180000); // 3 min timeout
  return analyzeVideo(videoId);
}
