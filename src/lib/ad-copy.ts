// Fable 5-powered Facebook ad copy for the launch workflow: primary text,
// headline, and description written from the product + generated audience.

import Anthropic from '@anthropic-ai/sdk';
import type { AudienceProfile } from '@/lib/static-ad-prompts';

export interface AdCopy {
  primaryText: string;
  headline: string;
  description: string;
}

/** Shrine-vibe product landing page HTML (goes into the Shopify product
 *  body_html). The page skeleton is a ready-made template in the repo
 *  (lib/lander-template.ts) — Fable 5 only writes the copy as small JSON, so
 *  this is fast and the layout is pixel-consistent across products. */
export async function generateLanderHtml(product: {
  brandName: string; productName: string; priceCents: number; brief: string;
}): Promise<{ html: string; copy: import('@/lib/lander-template').LanderCopy }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const { renderLander } = await import('@/lib/lander-template');
  const client = new Anthropic();

  const response = await client.beta.messages.create({
    model: 'claude-fable-5',
    max_tokens: 5000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: 'claude-opus-4-8' }],
    system: 'You are a world-class DTC landing-page copywriter. You respond with valid JSON only — no markdown, no explanation.',
    messages: [{
      role: 'user',
      content: `Write high-converting Shopify lander copy for this product. Compliant (no medical claims), no fabricated statistics or review counts, spell everything correctly.

BRAND: ${product.brandName}
PRODUCT: ${product.productName}
PRICE: $${(product.priceCents / 100).toFixed(2)}
ABOUT: ${product.brief.slice(0, 1500)}

Style reference: top-converting DTC supplement landers — emotive, second-person, specific to THIS product's pains and payoffs. Outcomes must be phrased as reported experiences ("Reported…", "Noticed…", "Experienced…"), never promises. The journey is a 3-phase emotional arc of what life looks like as the product becomes routine (no medical claims, no specific timeframes like "in 2 weeks").

Return EXACTLY this JSON shape:
{
  "headline": "bold benefit-led headline, max 9 words",
  "subhead": "one supporting line, max 20 words",
  "whyTitle": "e.g. Why Our <Product> Works Better.",
  "benefits": [{"icon": "one emoji", "title": "2-4 words", "text": "1-2 sentences"}, exactly 5 items],
  "outcomesTitle": "e.g. What Consistent Support Can Look Like",
  "outcomes": ["Reported/Noticed/Experienced-style outcome line", exactly 4 items],
  "journeyTitle": "e.g. Your Journey Ahead",
  "journey": [{"title": "emotive phase title, 4-7 words", "text": "3-4 sentence second-person paragraph about how this phase feels"}, exactly 3 items],
  "quotes": [{"headline": "dramatic 8-14 word quote headline", "text": "2-3 sentence story-style customer quote", "name": "realistic first name + last initial"}, exactly 3 items],
  "guaranteeTitle": "e.g. 30-Day Money-Back Guarantee",
  "guaranteeText": "1-2 reassuring sentences",
  "faqs": [{"q": "question", "a": "1-2 sentence answer"}, exactly 5 items]
}`,
    }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Model declined to write this lander');
  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text).join('').trim()
    .replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  let copy: any;
  try { copy = JSON.parse(raw); } catch { throw new Error(`Lander copy was not valid JSON: ${raw.slice(0, 120)}`); }
  if (!copy.headline || !Array.isArray(copy.benefits)) throw new Error('Lander copy JSON missing required fields');
  return { html: renderLander(copy), copy };
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
