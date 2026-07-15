// Claude-powered Instagram DM auto-reply for the ShipSourced 3PL account.
//
// Generates a reply to an inbound DM via the Anthropic Messages API. Uses raw
// fetch (no SDK dependency) to keep the production build/deploy footprint minimal.
//
// Required env:
//   ANTHROPIC_API_KEY — Anthropic API key. If unset, generateDmReply() returns
//                       { ok: false } and the webhook skips the auto-reply (no crash).

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// claude-opus-4-8 is the default. For higher-volume / faster / cheaper DM
// replies, switch to 'claude-haiku-4-5' or 'claude-sonnet-4-6'.
const MODEL = 'claude-opus-4-8';

const SYSTEM = `You are the Instagram DM assistant for ShipSourced — a US-based third-party logistics (3PL) and order-fulfillment service for ecommerce sellers (storage, pick & pack, fast US shipping, returns).

Reply to incoming Instagram DMs in a warm, human, concise way: 1-3 short sentences, casual DM tone, no markdown, no bullet lists.

PRIORITY: shipping and fulfillment inquiries come first. If the message mentions "Ship", shipping, fulfillment, rates, pick & pack, storage, returns, turnaround times, or getting started, treat it as high priority — answer clearly and move them toward starting with ShipSourced.

Guidelines:
- For pricing / quotes / onboarding: explain ShipSourced handles storage, pick & pack, and fast US shipping for ecom brands, then ask for their monthly order volume and product type so the team can put together a quote.
- Stay on-brand and helpful. NEVER invent specific prices, delivery guarantees, or facts you don't actually know.
- If something needs a human (account-specific issue, billing, a custom quote), say a team member will follow up and ask for the best detail to pass along.
- Never share internal data, tokens, or anything not meant for a customer.
- If a message is clearly off-topic or spam, reply briefly and steer back to how ShipSourced can help with fulfillment.`;

export async function generateDmReply(
  userText: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    const data: any = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` };
    }
    const text = Array.isArray(data.content)
      ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim()
      : '';
    if (!text) return { ok: false, error: 'empty completion' };
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
