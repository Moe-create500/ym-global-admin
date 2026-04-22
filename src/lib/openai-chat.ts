/**
 * OpenAI Chat Completions API wrapper
 * Reuses OPENAI_API_KEY from .env (shared with Sora)
 */

const BASE_URL = 'https://api.openai.com/v1';
const API_KEY = () => process.env.OPENAI_API_KEY || '';

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean; // default true for backward compat — set false for plain text responses
}

interface ChatResponse {
  content: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const key = API_KEY();
  if (!key) {
    const err = new Error('OPENAI_API_KEY not set') as any;
    err.isQuota = false;
    err.code = 'missing_key';
    throw err;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model || 'gpt-4o-mini',
        messages,
        temperature: options.temperature ?? 0.8,
        max_tokens: options.maxTokens || 2000,
        ...(options.jsonMode !== false ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch (netErr: any) {
    const err = new Error(`OpenAI network error: ${netErr.message}`) as any;
    err.code = 'network_error';
    err.status = 0;
    err.isQuota = false;
    throw err;
  }

  if (!res.ok) {
    // Safe text extraction — handles HTML/502 responses
    const rawText = await res.text().catch(() => '');
    let errorCode = 'api_error';
    let errorMessage = `OpenAI API error ${res.status}`;
    try {
      const parsed = JSON.parse(rawText);
      errorCode = parsed.error?.code || parsed.error?.type || errorCode;
      errorMessage = parsed.error?.message || errorMessage;
    } catch {
      // Non-JSON response (502 HTML page, etc.)
      errorMessage = `OpenAI error ${res.status}${res.status >= 500 ? ' (server error)' : ''}`;
    }
    const err = new Error(errorMessage) as any;
    err.code = errorCode;
    err.status = res.status;
    err.isQuota = errorCode === 'insufficient_quota' || res.status === 429;
    throw err;
  }

  // Safe JSON parse of successful response
  let data: any;
  try {
    data = await res.json();
  } catch {
    const err = new Error('OpenAI returned non-JSON response') as any;
    err.code = 'malformed_response';
    err.status = res.status;
    err.isQuota = false;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    const err = new Error('OpenAI returned empty content') as any;
    err.code = 'empty_response';
    err.status = res.status;
    err.isQuota = false;
    throw err;
  }

  return { content, model: data.model, usage: data.usage };
}

/**
 * Convert an image URL to a base64 data URI in PNG format.
 * Shopify CDN often serves AVIF/HEIC which OpenAI rejects — this fixes that.
 * Requires `sharp` to be available (it's in package.json).
 */
export async function imageUrlToBase64Png(url: string): Promise<string | null> {
  try {
    const sharp = (await import('sharp')).default;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const pngBuf = await sharp(buf).png().toBuffer();
    return `data:image/png;base64,${pngBuf.toString('base64')}`;
  } catch (err) {
    console.error('Failed to convert image to PNG base64:', url, err);
    return null;
  }
}

/**
 * Convert an array of image URLs to ChatContentPart[] with base64 PNGs.
 * Falls back to raw URL if conversion fails.
 */
export async function imagesToChatParts(urls: string[]): Promise<ChatContentPart[]> {
  const parts: ChatContentPart[] = [];
  for (const url of urls) {
    const base64 = await imageUrlToBase64Png(url);
    parts.push({
      type: 'image_url' as const,
      image_url: { url: base64 || url, detail: 'low' },
    });
  }
  return parts;
}

export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  options: ChatOptions = {}
): Promise<string> {
  const result = await chatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], options);
  return result.content;
}

// ═══════════════════════════════════════════════
// GEMINI CHAT COMPLETION (failover for OpenAI)
// ═══════════════════════════════════════════════

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || '';

/**
 * Gemini chat completion — same interface as OpenAI chatCompletion.
 * Used as failover when OpenAI quota is exceeded.
 */
export async function geminiChatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const key = GEMINI_KEY();
  if (!key) {
    const err = new Error('GEMINI_API_KEY not set') as any;
    err.isQuota = false;
    err.code = 'missing_key';
    throw err;
  }

  const model = 'gemini-2.5-flash';

  // Convert OpenAI message format to Gemini format
  const systemInstruction = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');

  const contents = userMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join('\n') }],
  }));

  // Gemini 2.5 Flash uses internal "thinking" tokens that count against maxOutputTokens.
  // We need a much higher limit than OpenAI to account for reasoning overhead.
  const geminiMaxTokens = Math.max((options.maxTokens || 2000) * 3, 8000);

  const body: any = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.8,
      maxOutputTokens: geminiMaxTokens,
      responseMimeType: options.jsonMode !== false ? 'application/json' : 'text/plain',
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: typeof systemInstruction.content === 'string' ? systemInstruction.content : '' }],
    };
  }

  let res: Response;
  try {
    res = await fetch(
      `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
  } catch (netErr: any) {
    const err = new Error(`Gemini network error: ${netErr.message}`) as any;
    err.code = 'network_error';
    err.status = 0;
    err.isQuota = false;
    throw err;
  }

  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    let errorMessage = `Gemini API error ${res.status}`;
    try { const p = JSON.parse(rawText); errorMessage = p.error?.message || errorMessage; } catch {
      errorMessage = `Gemini error ${res.status}${res.status >= 500 ? ' (server error)' : ''}`;
    }
    const err = new Error(errorMessage) as any;
    err.status = res.status;
    err.isQuota = res.status === 429 || errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('billing') || errorMessage.toLowerCase().includes('credit') || errorMessage.toLowerCase().includes('depleted');
    err.code = err.isQuota ? 'quota' : 'api_error';
    throw err;
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    const err = new Error('Gemini returned non-JSON response') as any;
    err.code = 'malformed_response';
    err.isQuota = false;
    throw err;
  }

  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!content) {
    const err = new Error('Gemini returned empty response') as any;
    err.code = 'empty_response';
    err.isQuota = false;
    throw err;
  }

  return {
    content,
    model,
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: data.usageMetadata?.totalTokenCount || 0,
    },
  };
}

/**
 * Multi-provider chat completion with automatic failover.
 * Tries OpenAI first, then Gemini. Returns the first successful result.
 * Only throws if ALL providers fail.
 */
export async function chatCompletionWithFailover(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResponse & { provider: string; failoverFrom?: string }> {
  const errors: { provider: string; error: string }[] = [];

  // Try Gemini first (cheaper, preserves OpenAI credits for Sora/DALL-E)
  try {
    const result = await geminiChatCompletion(messages, options);
    return { ...result, provider: 'gemini' };
  } catch (err: any) {
    const msg = err.message || 'Unknown error';
    console.error(`[FAILOVER] Gemini failed: ${msg}`);
    errors.push({ provider: 'gemini', error: msg });
  }

  // Fallback to OpenAI
  try {
    console.log('[FAILOVER] Switching to OpenAI...');
    const result = await chatCompletion(messages, options);
    return { ...result, provider: 'openai', failoverFrom: 'gemini' };
  } catch (err: any) {
    const msg = err.message || 'Unknown error';
    console.error(`[FAILOVER] OpenAI failed: ${msg}`);
    errors.push({ provider: 'openai', error: msg });
  }

  // All providers failed
  const allErrors = errors.map(e => `${e.provider}: ${e.error}`).join(' | ');
  const finalErr = new Error(`All AI providers failed: ${allErrors}`) as any;
  finalErr.isQuota = true;
  finalErr.code = 'all_providers_failed';
  finalErr.providerErrors = errors;
  throw finalErr;
}
