// Fable 5-powered audience generation for the Picture Ads system.
//
// Given only a product (title/description/price), Claude derives a complete
// bottom-of-funnel audience profile: who they are, psychographics, the
// moments they'd use the product, objections, and the solutions/claims they
// need to hear. Works for any product — no pasted research required.
//
// Requires ANTHROPIC_API_KEY in env.

import Anthropic from '@anthropic-ai/sdk';

export interface GeneratedAudience {
  name: string;
  description: string | null;
  painPoints: string[];
  desires: string[];
  objections: string[];
  failedSolutions: string[];
  mindset: string | null;
  demographics: string | null;
  creativeAngles: string[];
  usageMoments: string[];
  bofReasoning: string | null;
}

export async function generateAudienceFromProduct(product: {
  title: string;
  description?: string | null;
  price_cents?: number | null;
}, opts?: { avoidNames?: string[] }): Promise<GeneratedAudience> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const client = new Anthropic();

  const price = product.price_cents ? `$${(product.price_cents / 100).toFixed(2)}` : 'unknown';

  const response = await client.beta.messages.create({
    model: 'claude-fable-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: 'claude-opus-4-8' }],
    system: `You are a world-class direct-response media buyer and consumer psychologist. Given a product, you construct the single highest-value bottom-of-funnel buyer audience for it — real people with money in hand who are actively looking for this solution.

You respond with valid JSON only. No markdown, no explanation, no code fences.`,
    messages: [{
      role: 'user',
      content: `PRODUCT
Title: ${product.title}
Price: ${price}
Description: ${(product.description || 'No description available — infer everything from the title.').slice(0, 3000)}

Build the highest-converting bottom-of-funnel audience profile for this product. Be specific and vivid — these fields feed ad-creative generation, so every entry should be concrete enough to write an ad from.
${opts?.avoidNames?.length ? `
ALREADY USED — take a DISTINCTLY different buyer angle from all of these (different life situation, motivation, or demographic; not a rewording):
${opts.avoidNames.slice(0, 10).map(n => `- ${n}`).join('\n')}` : ''}

Return exactly this JSON structure:
{
  "name": "short memorable audience name (max 6 words)",
  "description": "2-3 sentence portrait of who this person is",
  "painPoints": ["5-7 specific pains, in their own words"],
  "desires": ["5-7 specific outcomes they want"],
  "objections": ["4-6 objections stopping them from buying, and doubts about products like this"],
  "failedSolutions": ["3-5 things they already tried that disappointed them"],
  "mindset": "what they are thinking right now, first person, 2-3 sentences",
  "demographics": "age range, gender skew, income, lifestyle markers",
  "usageMoments": ["5-7 vivid specific moments/situations where they would use this product or feel the need for it"],
  "creativeAngles": ["5-7 ad angles: the solutions and claims they NEED to hear to buy — each one sentence"],
  "bofReasoning": "why this audience is bottom-of-funnel and ready to buy now, 2-3 sentences"
}`,
    }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Model declined to generate this audience profile');
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Tolerate stray text around the JSON object
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in model response');

  const parsed = JSON.parse(text.slice(start, end + 1));

  return {
    name: parsed.name || `${product.title.slice(0, 40)} Buyers`,
    description: parsed.description || null,
    painPoints: parsed.painPoints || [],
    desires: parsed.desires || [],
    objections: parsed.objections || [],
    failedSolutions: parsed.failedSolutions || [],
    mindset: parsed.mindset || null,
    demographics: parsed.demographics || null,
    creativeAngles: parsed.creativeAngles || [],
    usageMoments: parsed.usageMoments || [],
    bofReasoning: parsed.bofReasoning || null,
  };
}
