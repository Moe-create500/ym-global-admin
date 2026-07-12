// Fable 5-powered Facebook ad copy for the launch workflow: primary text,
// headline, and description written from the product + generated audience.

import Anthropic from '@anthropic-ai/sdk';
import type { AudienceProfile } from '@/lib/static-ad-prompts';

export interface AdCopy {
  primaryText: string;
  headline: string;
  description: string;
}

export async function generateAdCopy(
  product: { title: string; description?: string | null; price_cents?: number | null },
  audience: AudienceProfile,
): Promise<AdCopy> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic();

  const price = product.price_cents ? `$${(product.price_cents / 100).toFixed(2)}` : 'unknown';

  const response = await client.beta.messages.create({
    model: 'claude-fable-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: 'claude-opus-4-8' }],
    system: 'You are a world-class direct-response Facebook ad copywriter. You respond with valid JSON only — no markdown, no explanation.',
    messages: [{
      role: 'user',
      content: `PRODUCT
Title: ${product.title}
Price: ${price}
Description: ${(product.description || '').slice(0, 2000)}

AUDIENCE: ${audience.name}
Pain points: ${audience.pain_points.join('; ')}
Desires: ${audience.desires.join('; ')}
Objections: ${audience.objections.join('; ')}
Mindset: ${audience.mindset || 'N/A'}

Write the Facebook ad copy for this product aimed at this audience. Scroll-stopping, specific, compliant (no medical claims, no before/after promises, no "you" statements about personal attributes).

Return exactly:
{
  "primaryText": "the primary text above the image — 3-6 short lines, hook first, benefit-led, ends with a soft CTA (max 800 chars)",
  "headline": "punchy headline under the image (max 40 chars)",
  "description": "supporting line under the headline (max 60 chars)"
}`,
    }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Model declined to write this ad copy');

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text).join('');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in model response');
  const parsed = JSON.parse(text.slice(start, end + 1));

  return {
    primaryText: String(parsed.primaryText || '').slice(0, 2000),
    headline: String(parsed.headline || product.title).slice(0, 255),
    description: String(parsed.description || '').slice(0, 255),
  };
}
