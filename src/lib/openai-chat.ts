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
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model || 'gpt-4o',
      messages,
      temperature: options.temperature ?? 0.8,
      max_tokens: options.maxTokens || 4096,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI Chat API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return {
    content: data.choices[0].message.content,
    model: data.model,
    usage: data.usage,
  };
}

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

export async function imagesToChatParts(urls: string[]): Promise<ChatContentPart[]> {
  const parts: ChatContentPart[] = [];
  for (const url of urls) {
    const base64 = await imageUrlToBase64Png(url);
    parts.push({
      type: 'image_url' as const,
      image_url: { url: base64 || url, detail: 'high' },
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
