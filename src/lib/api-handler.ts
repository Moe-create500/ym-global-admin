/**
 * API route handler wrapper.
 *
 * Wraps any route handler to guarantee:
 * 1. Always returns JSON (never HTML)
 * 2. Catches all unhandled exceptions
 * 3. Normalizes error format
 * 4. Logs errors with route context
 *
 * Usage:
 *   export const GET = withApiHandler('my-route GET', async (req) => {
 *     // your handler — can throw freely
 *     return jsonSuccess({ data: ... });
 *   });
 */

import { NextRequest, NextResponse } from 'next/server';

export function jsonSuccess(data: any, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

export function jsonError(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

type Handler = (req: NextRequest, ctx?: any) => Promise<NextResponse | Response>;

/**
 * Wrap a route handler with global error catching.
 * Any unhandled throw becomes a structured JSON 500 response.
 */
export function withApiHandler(routeName: string, handler: Handler): Handler {
  return async (req: NextRequest, ctx?: any) => {
    try {
      const result = await handler(req, ctx);
      return result;
    } catch (err: any) {
      console.error(`[API ${routeName}] Unhandled error:`, err);

      // Normalize error message
      const message = err?.message || 'Unknown server error';
      const code = err?.code || 'INTERNAL_ERROR';
      const status = err?.status || 500;

      return NextResponse.json({
        success: false,
        error: {
          code,
          message: String(message).substring(0, 500),
          ...(process.env.NODE_ENV === 'development' && err?.stack ? { stack: String(err.stack).substring(0, 1000) } : {}),
        },
      }, { status: typeof status === 'number' && status >= 400 && status < 600 ? status : 500 });
    }
  };
}
