/**
 * Safe provider fetch utility.
 * Handles non-JSON responses, 5xx errors, timeouts, and malformed responses
 * consistently across all AI providers.
 */

export interface ProviderError {
  provider: string;
  code: string;
  message: string;
  status?: number;
  retryable: boolean;
  failoverEligible: boolean;
  rawResponse?: string;
}

/**
 * Create a typed ProviderError that can be thrown.
 */
export function createProviderError(opts: ProviderError): Error & ProviderError {
  const err = new Error(opts.message) as Error & ProviderError;
  err.provider = opts.provider;
  err.code = opts.code;
  err.status = opts.status;
  err.retryable = opts.retryable;
  err.failoverEligible = opts.failoverEligible;
  err.rawResponse = opts.rawResponse;
  // Legacy compat fields used by existing error checks
  (err as any).isQuota = opts.code === 'QUOTA' || opts.code === 'BILLING';
  return err;
}

/**
 * Safely parse a provider API response.
 * - Checks res.ok FIRST
 * - Checks content-type before parsing JSON
 * - Never crashes on HTML/text responses
 * - Returns a clean ProviderError on failure
 */
export async function safeProviderFetch(
  url: string,
  options: RequestInit,
  provider: string,
): Promise<{ ok: true; data: any; status: number } | { ok: false; error: ProviderError }> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err: any) {
    return {
      ok: false,
      error: createProviderError({
        provider,
        code: 'NETWORK',
        message: `Network error: ${err.message || 'Connection failed'}`,
        retryable: true,
        failoverEligible: true,
      }),
    };
  }

  // Check HTTP status first
  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    const truncated = rawText.substring(0, 500);

    // Classify the error
    if (res.status === 429) {
      return { ok: false, error: createProviderError({ provider, code: 'RATE_LIMIT', message: extractErrorMessage(truncated, `Rate limited (429)`), status: 429, retryable: true, failoverEligible: true }) };
    }
    if (res.status === 402) {
      return { ok: false, error: createProviderError({ provider, code: 'BILLING', message: extractErrorMessage(truncated, `Billing error (402)`), status: 402, retryable: false, failoverEligible: true }) };
    }
    if (res.status >= 500) {
      return { ok: false, error: createProviderError({ provider, code: `PROVIDER_${res.status}`, message: extractErrorMessage(truncated, `Server error (${res.status})`), status: res.status, retryable: true, failoverEligible: true }) };
    }
    // 4xx errors (not 429/402)
    const msg = extractErrorMessage(truncated, `API error (${res.status})`);
    const isQuota = msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('billing') || msg.toLowerCase().includes('hard limit');
    return { ok: false, error: createProviderError({ provider, code: isQuota ? 'QUOTA' : `HTTP_${res.status}`, message: msg, status: res.status, retryable: false, failoverEligible: isQuota }) };
  }

  // Response is ok — now safely parse the body
  const contentType = res.headers.get('content-type') || '';

  // For binary responses (images from Stability AI)
  if (contentType.includes('image/')) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, data: { _binary: true, buffer: buf, contentType }, status: res.status };
  }

  // JSON response
  if (contentType.includes('application/json') || contentType.includes('text/json')) {
    try {
      const data = await res.json();
      return { ok: true, data, status: res.status };
    } catch {
      const rawText = await res.clone().text().catch(() => '');
      return { ok: false, error: createProviderError({ provider, code: 'MALFORMED_JSON', message: `Provider returned invalid JSON`, status: res.status, retryable: true, failoverEligible: true, rawResponse: rawText.substring(0, 200) }) };
    }
  }

  // Attempt JSON parse even without JSON content-type (some providers don't set it)
  const rawText = await res.text().catch(() => '');
  try {
    const data = JSON.parse(rawText);
    return { ok: true, data, status: res.status };
  } catch {
    // Not JSON — could be HTML error page
    if (rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
      return { ok: false, error: createProviderError({ provider, code: 'HTML_RESPONSE', message: `Provider returned HTML instead of JSON (likely 502/CDN error)`, status: res.status, retryable: true, failoverEligible: true }) };
    }
    return { ok: false, error: createProviderError({ provider, code: 'UNEXPECTED_RESPONSE', message: `Unexpected response format: ${rawText.substring(0, 100)}`, status: res.status, retryable: true, failoverEligible: true }) };
  }
}

/**
 * Extract a readable error message from a provider response body.
 * Tries to parse JSON error, falls back to truncated text.
 */
function extractErrorMessage(rawText: string, fallback: string): string {
  if (!rawText) return fallback;
  try {
    const parsed = JSON.parse(rawText);
    return parsed.error?.message || parsed.message || parsed.error || fallback;
  } catch {
    // Strip HTML tags if it's an HTML error page
    if (rawText.includes('<')) {
      return fallback;
    }
    return rawText.substring(0, 200) || fallback;
  }
}
