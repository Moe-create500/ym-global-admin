import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Plaid webhooks. Teller retired 2026-09-14; its payloads are acknowledged and ignored.
export async function POST(req: NextRequest) {
  // Webhook hardening (2026-09-09): this endpoint is necessarily public, and
  // a forged payload could mark connections broken or trigger syncs. When
  // YM_WEBHOOK_SECRET is set, the provider webhook URL must carry ?key=<secret>
  // — requests without it are rejected. (Plaid JWT signature verification is
  // the P1 follow-up; this closes forgery from anyone without the URL secret.)
  const secret = process.env.YM_WEBHOOK_SECRET;
  if (secret && req.nextUrl.searchParams.get('key') !== secret) {
    console.warn('[webhook] rejected: bad or missing key');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.text();
  if (body.length > 100_000) return NextResponse.json({ error: 'payload too large' }, { status: 413 });

  // Log the webhook for debugging
  console.log('[webhook] received:', body.substring(0, 500));

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = getDb();

  // ---- Plaid webhooks (authoritative connection evidence) -----------------
  if (payload.webhook_type) {
    const { ensureConnectionSchema } = await import('@/lib/connection-state');
    ensureConnectionSchema(db);
    const itemId = payload.item_id;
    const code = payload.webhook_code;
    if (payload.webhook_type === 'ITEM' && itemId) {
      switch (code) {
        case 'ERROR': {
          const errCode = payload.error?.error_code || 'UNKNOWN_ERROR';
          db.prepare(`UPDATE plaid_items SET provider_error_code = ?, provider_error_message = ?,
              error_detected_at = COALESCE(error_detected_at, datetime('now')), updated_at = datetime('now')
            WHERE item_id = ?`).run(errCode, String(payload.error?.error_message || '').slice(0, 300), itemId);
          console.log(`[plaid-webhook] ITEM ERROR ${errCode} on ${itemId}`);
          break;
        }
        case 'PENDING_EXPIRATION':
        case 'PENDING_DISCONNECT':
          db.prepare(`UPDATE plaid_items SET pending_disconnect_at = ?, updated_at = datetime('now') WHERE item_id = ?`)
            .run(payload.consent_expiration_time || new Date(Date.now() + 7 * 86400000).toISOString(), itemId);
          console.log(`[plaid-webhook] ${code} on ${itemId}`);
          break;
        case 'LOGIN_REPAIRED':
          db.prepare(`UPDATE plaid_items SET provider_error_code = NULL, provider_error_message = NULL,
              error_detected_at = NULL, pending_disconnect_at = NULL, updated_at = datetime('now') WHERE item_id = ?`).run(itemId);
          console.log(`[plaid-webhook] LOGIN_REPAIRED on ${itemId}`);
          break;
        case 'NEW_ACCOUNTS_AVAILABLE':
          db.prepare(`UPDATE plaid_items SET provider_error_code = 'NEW_ACCOUNTS_AVAILABLE',
              provider_error_message = 'The bank reports new accounts available for this login — update account selection',
              error_detected_at = COALESCE(error_detected_at, datetime('now')), updated_at = datetime('now') WHERE item_id = ?`).run(itemId);
          break;
        case 'USER_PERMISSION_REVOKED':
          db.prepare(`UPDATE plaid_items SET provider_error_code = 'USER_PERMISSION_REVOKED',
              provider_error_message = 'User revoked access at the bank', error_detected_at = COALESCE(error_detected_at, datetime('now')),
              updated_at = datetime('now') WHERE item_id = ?`).run(itemId);
          break;
        default:
          console.log(`[plaid-webhook] unhandled ITEM code ${code}`);
      }
    } else if ((payload.webhook_type === 'LIABILITIES' || payload.webhook_type === 'TRANSACTIONS') && itemId) {
      // Fresh data available at the provider — stamp the item so the next
      // sync cycle picks it up (sync is idempotent; no user action needed)
      db.prepare("UPDATE plaid_items SET updated_at = datetime('now') WHERE item_id = ?").run(itemId);
      console.log(`[plaid-webhook] ${payload.webhook_type}/${code} on ${itemId} — refresh flagged`);
    } else {
      console.log(`[plaid-webhook] ${payload.webhook_type}/${code} — no action needed`);
    }
    return NextResponse.json({ received: true });
  }

  // Not a Plaid payload (legacy Teller shape, or unknown). Acknowledge so the
  // sender stops retrying, but change nothing.
  console.log(`[webhook] ignored non-Plaid payload type=${payload.type || payload.event || '?'}`);
  return NextResponse.json({ received: true });
}
