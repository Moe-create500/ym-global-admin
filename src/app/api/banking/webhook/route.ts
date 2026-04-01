import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAccountBalance, getAccountTransactions } from '@/lib/teller';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Teller sends webhooks for enrollment.disconnected, transactions.processed, etc.
export async function POST(req: NextRequest) {
  const body = await req.text();

  // Log the webhook for debugging
  console.log('[teller-webhook] Received:', body.substring(0, 500));

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = getDb();
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
