import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccountBalance, getAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Teller sends webhooks for enrollment.disconnected, transactions.processed, etc.
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
  console.log('[teller-webhook] Received:', body.substring(0, 500));

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = getDb();

  // ---- Plaid webhooks (authoritative connection evidence) -----------------
  // Plaid payloads carry webhook_type/webhook_code; Teller payloads carry type.
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

  const type = payload.type || payload.event;

  switch (type) {
    case 'enrollment.disconnected': {
      // Mark accounts as disconnected
      const enrollmentId = payload.payload?.enrollment_id || payload.data?.enrollment_id;
      if (enrollmentId) {
        db.prepare("UPDATE bank_accounts SET status = 'disconnected', updated_at = datetime('now') WHERE teller_enrollment_id = ?")
          .run(enrollmentId);
        console.log(`[teller-webhook] Enrollment ${enrollmentId} disconnected`);
      }
      break;
    }

    case 'transactions.processed': {
      // New transactions available — sync the account
      const accountId = payload.payload?.account_id || payload.data?.account_id;
      if (accountId) {
        const account: any = db.prepare("SELECT * FROM bank_accounts WHERE teller_account_id = ? AND status = 'active'").get(accountId);
        if (account) {
          try {
            // Sync balance
            const balance = await getAccountBalance(account.access_token, account.teller_account_id);
            const available = Math.round(parseFloat(balance.available || '0') * 100);
            const ledger = Math.round(parseFloat(balance.ledger || '0') * 100);
            db.prepare(`
              UPDATE bank_accounts SET balance_available_cents = ?, balance_ledger_cents = ?,
                balance_updated_at = datetime('now'), updated_at = datetime('now')
              WHERE id = ?
            `).run(available, ledger, account.id);

            // Sync transactions
            const txns = await getAccountTransactions(account.access_token, account.teller_account_id, 50);
            let imported = 0;
            for (const txn of txns) {
              const existing = db.prepare('SELECT id FROM bank_transactions WHERE teller_transaction_id = ?').get(txn.id);
              if (existing) continue;

              const amountCents = Math.round(parseFloat(txn.amount || '0') * 100);
              const runningBalance = txn.running_balance ? Math.round(parseFloat(txn.running_balance) * 100) : null;

              db.prepare(`
                INSERT INTO bank_transactions (id, bank_account_id, teller_transaction_id, date, description,
                  category, amount_cents, type, status, counterparty, running_balance_cents)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                crypto.randomUUID(), account.id, txn.id, txn.date, txn.description,
                txn.details?.category || null, amountCents, txn.type, txn.status,
                txn.details?.counterparty?.name || null, runningBalance
              );
              imported++;
            }
            console.log(`[teller-webhook] Synced ${account.account_name}: balance updated, ${imported} new transactions`);
          } catch (err: any) {
            console.error(`[teller-webhook] Sync error for ${account.account_name}: ${err.message}`);
          }
        }
      }
      break;
    }

    case 'account_number_verification.processed': {
      console.log('[teller-webhook] Account number verification processed');
      break;
    }

    default:
      console.log(`[teller-webhook] Unknown event type: ${type}`);
  }

  return NextResponse.json({ received: true });
}
