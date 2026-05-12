/**
 * Tutorial Mode — clone an ad end-to-end via Higgsfield Seedance 2.0.
 *
 * Self-contained on purpose. higgsfield.ts is owned by the ym-global-admin
 * sibling repo (see deploy-creative.sh comments + CLAUDE.md SCOPE LOCK), so
 * Tutorial Mode keeps fetch/auth/error logic local to this Creative-Tab-owned
 * file. The ~30 LOC duplicated from higgsfield.ts is the agreed tradeoff for
 * cross-repo isolation.
 *
 * Endpoint shape was extracted via FastAPI 422 validation responses from
 * platform.higgsfield.ai. Key schema quirks vs. the dop-turbo path:
 *   - model: 'seedance_pro' | 'seedance_lite'   (underscore variant, NOT 'seedance-2.0')
 *   - resolution: '480' | '720' | '1080'        (bare digit string, NOT '720p')
 *   - input_image: { type, image_url }          (singular object, NOT array)
 */

const HIGGSFIELD_BASE = 'https://platform.higgsfield.ai';
const CREDENTIALS = () => process.env.HIGGSFIELD_API_KEY || '';

export interface SeedanceVideoResult {
  requestId: string;
  statusUrl: string;
}

export interface SeedanceVideoStatus {
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw';
  videoUrl: string | null;
  error: string | null;
}

export interface CreateSeedanceOptions {
  duration?: number;
  aspectRatio?: string;
  resolution?: '480' | '720' | '1080';
  generateAudio?: boolean;
  model?: 'seedance_pro' | 'seedance_lite';
}

/**
 * Error code conventions surfaced via err.code:
 *   AUTH_FAILED   — 401/403, bad/missing key
 *   SCHEMA_ERROR  — 422, body violates Higgsfield's Pydantic schema (err.validation has detail)
 *   API_ERROR     — other 4xx
 *   SERVER_ERROR  — 5xx
 *   NETWORK_ERROR — fetch threw (timeout, DNS, etc.)
 */
export async function createSeedanceVideo(
  prompt: string,
  imageUrl: string,
  options: CreateSeedanceOptions = {},
): Promise<SeedanceVideoResult> {
  const creds = CREDENTIALS();
  if (!creds) {
    const err = new Error('HIGGSFIELD_API_KEY not set (format: KEY_ID:KEY_SECRET)') as any;
    err.code = 'AUTH_FAILED';
    throw err;
  }

  // Higgsfield's /v1/image2video/seedance enforces duration 3-12 inclusive
  // (integer enum). Per smoke test 2026-05-12: schema_error if outside this
  // range — initial assumption of 1-15s was wrong. Math.round (not floor/ceil)
  // keeps the generated clip closest to the source duration.
  const duration = Math.max(3, Math.min(12, Math.round(options.duration ?? 5)));

  const body = {
    params: {
      model: options.model ?? 'seedance_pro',
      prompt: prompt.substring(0, 5000),
      input_image: { type: 'image_url', image_url: imageUrl },
      duration,
      aspect_ratio: options.aspectRatio ?? '9:16',
      resolution: options.resolution ?? '720',
      generate_audio: options.generateAudio ?? true,
    },
  };

  console.log(
    `[HIGGSFIELD-SEEDANCE] POST /v1/image2video/seedance dur=${duration}s ar=${body.params.aspect_ratio} res=${body.params.resolution} prompt=${prompt.substring(0, 80)}…`,
  );

  let res: Response;
  try {
    res = await fetch(`${HIGGSFIELD_BASE}/v1/image2video/seedance`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${creds}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e: any) {
    const err = new Error(`Higgsfield network error: ${e?.message || 'fetch failed'}`) as any;
    err.code = 'NETWORK_ERROR';
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();

    let code = 'API_ERROR';
    if (res.status === 401 || res.status === 403) code = 'AUTH_FAILED';
    else if (res.status === 422) code = 'SCHEMA_ERROR';
    else if (res.status >= 500) code = 'SERVER_ERROR';

    const msg = parsed?.detail
      ? (typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail))
      : text.substring(0, 300) || `Higgsfield ${res.status}`;

    console.error(`[HIGGSFIELD-SEEDANCE] ${code} (${res.status}): ${msg.substring(0, 300)}`);

    const err = new Error(`Higgsfield Seedance ${code}: ${msg}`) as any;
    err.code = code;
    err.status = res.status;
    if (code === 'SCHEMA_ERROR') err.validation = parsed?.detail;
    throw err;
  }

  const data = await res.json();
  const requestId = data.request_id || data.id;
  if (!requestId) {
    const err = new Error('Higgsfield Seedance: no request_id in response') as any;
    err.code = 'API_ERROR';
    throw err;
  }
  console.log(`[HIGGSFIELD-SEEDANCE] queued requestId=${requestId}`);
  return {
    requestId,
    statusUrl: data.status_url || `${HIGGSFIELD_BASE}/requests/${requestId}/status`,
  };
}

export async function getSeedanceStatus(requestId: string): Promise<SeedanceVideoStatus> {
  const creds = CREDENTIALS();
  if (!creds) {
    const err = new Error('HIGGSFIELD_API_KEY not set') as any;
    err.code = 'AUTH_FAILED';
    throw err;
  }

  const res = await fetch(`${HIGGSFIELD_BASE}/requests/${requestId}/status`, {
    headers: { 'Authorization': `Key ${creds}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Higgsfield status ${res.status}: ${text.substring(0, 200)}`) as any;
    err.code = res.status >= 500 ? 'SERVER_ERROR' : 'API_ERROR';
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  if (data.status === 'completed') {
    const videoUrl = data.video?.url || data.output?.[0] || null;
    return { status: 'completed', videoUrl, error: null };
  }
  if (data.status === 'failed' || data.status === 'nsfw') {
    return { status: data.status, videoUrl: null, error: data.failure || data.error || 'Generation failed' };
  }
  return { status: data.status, videoUrl: null, error: null };
}

/**
 * Build Alex Robinson's beat-by-beat prompt from extracted scene analyses.
 * Order: Format → Personalism → On-screen text → Beat-by-beat → Why it works →
 * Overall. If assembled prompt exceeds 5000 chars (Seedance cap), the
 * "Why it works" section is trimmed first; hard-truncate is the final fallback.
 */
export function buildTutorialPrompt(
  sceneAnalyses: string[],
  sourceDuration: number,
  productName: string,
  transcript?: string,
): string {
  const valid = sceneAnalyses.filter(a => a && !a.includes('[analysis failed]'));
  if (valid.length === 0) {
    return `Vertical UGC ad for "${productName}". Single take, handheld phone, natural lighting. ${Math.round(sourceDuration)}s duration.`;
  }

  const f0 = valid[0];
  const camera = f0.match(/CAMERA:\s*([^\n]+)/i)?.[1]?.trim() || 'handheld';
  const subject = f0.match(/SUBJECT:\s*([^\n]+)/i)?.[1]?.trim() || 'presenter on-camera';
  const environment = f0.match(/ENVIRONMENT:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const lighting = f0.match(/LIGHTING:\s*([^\n]+)/i)?.[1]?.trim() || 'natural light';

  const segmentDur = sourceDuration / valid.length;
  const beats = valid.map((a, i) => {
    const start = Math.round(segmentDur * i);
    const end = Math.round(segmentDur * (i + 1));
    const cam = a.match(/CAMERA:\s*([^\n]+)/i)?.[1]?.trim() || '';
    const act = a.match(/ACTION:\s*([^\n]+)/i)?.[1]?.trim() || '';
    const env = a.match(/ENVIRONMENT:\s*([^\n]+)/i)?.[1]?.trim() || '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `0:${pad(start)} – 0:${pad(end)}  ${cam}, ${act}${env ? `, ${env}` : ''}`;
  });

  const moods = valid.map(a => a.match(/MOOD:\s*([^\n]+)/i)?.[1]?.trim() || '').filter(Boolean);
  const why: string[] = [];
  why.push(`Pattern interrupt hook — ${subject} in opening frame`);
  if (environment) why.push(`Authentic setting reframe (${environment}) removes ad feel`);
  if (moods.length) why.push(`Consistent mood across scenes: ${moods.slice(0, 3).join(' / ')}`);

  const overall = `UGC framework — opening hook + product demo + payoff. Tight execution at ${Math.round(sourceDuration)}s.`;

  const parts: string[] = [];
  parts.push(`Vertical UGC ad – "${productName}"`);
  parts.push('');
  parts.push(`Format: Vertical 720x1280, ${camera}, ${environment || 'indoor setting'}`);
  parts.push(`Personalism: ${subject}`);
  parts.push(transcript ? `On-screen text: ${transcript.substring(0, 200)}` : 'On-screen text: (none detected)');
  parts.push('');
  parts.push('Beat-by-beat:');
  beats.forEach(b => parts.push(`  ${b}`));
  parts.push('');
  parts.push(`Lighting: ${lighting}`);
  parts.push('');
  parts.push('Why it works (ad theory):');
  why.forEach(w => parts.push(`  ✓ ${w}`));
  parts.push('');
  parts.push(`Overall: ${overall}`);

  let prompt = parts.join('\n');

  if (prompt.length > 5000) {
    const whyIdx = prompt.indexOf('Why it works');
    const overallIdx = whyIdx > 0 ? prompt.indexOf('Overall:', whyIdx) : -1;
    if (whyIdx > 0 && overallIdx > 0) {
      prompt = prompt.substring(0, whyIdx) + prompt.substring(overallIdx);
    }
    if (prompt.length > 5000) prompt = prompt.substring(0, 4990) + '…';
  }

  return prompt;
}

export interface DispatchTutorialOpts {
  firstFrameUrl: string;
  prompt: string;
  duration: number;
  productName: string;
}

/**
 * Run a Tutorial Mode generation end-to-end:
 *   create → poll until terminal → return { videoUrl, requestId, prompt }.
 *
 * Poll interval = 5s, max polls = 144 → 12-minute ceiling. Alex's tutorial
 * cites "6-10 minutes" for generation; 12m gives 20-100% headroom for queue
 * delays. Transient status-fetch errors don't kill the job — we log and keep
 * polling. Terminal failures (failed/nsfw) and final timeout throw with
 * categorized err.code so the route handler can surface them in jsonError.
 */
export async function dispatchTutorialGeneration(
  opts: DispatchTutorialOpts,
): Promise<{ videoUrl: string; requestId: string; prompt: string }> {
  const { firstFrameUrl, prompt, duration } = opts;

  const { requestId } = await createSeedanceVideo(prompt, firstFrameUrl, {
    duration,
    aspectRatio: '9:16',
    resolution: '720',
    generateAudio: true,
    model: 'seedance_pro',
  });

  const POLL_INTERVAL_MS = 5000;
  const MAX_POLLS = 144;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    let status: SeedanceVideoStatus;
    try {
      status = await getSeedanceStatus(requestId);
    } catch (e: any) {
      console.warn(`[HIGGSFIELD-SEEDANCE] poll ${i + 1}/${MAX_POLLS} status fetch failed: ${e?.message}`);
      continue;
    }
    if (status.status === 'completed' && status.videoUrl) {
      console.log(`[HIGGSFIELD-SEEDANCE] completed requestId=${requestId} videoUrl=${status.videoUrl.substring(0, 80)}…`);
      return { videoUrl: status.videoUrl, requestId, prompt };
    }
    if (status.status === 'failed' || status.status === 'nsfw') {
      const err = new Error(`Seedance ${status.status}: ${status.error || 'unknown'}`) as any;
      err.code = status.status === 'nsfw' ? 'NSFW' : 'GENERATION_FAILED';
      err.requestId = requestId;
      throw err;
    }
  }

  const err = new Error(`Seedance generation timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 1000}s`) as any;
  err.code = 'TIMEOUT';
  err.requestId = requestId;
  throw err;
}
