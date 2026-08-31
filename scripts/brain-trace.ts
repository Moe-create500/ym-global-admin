// ── TRANSACTION TRACE ────────────────────────────────────────────────────────
// Read-only lineage for any financial record: source → canonical → class →
// owner → evidence → pair → economic effects → consumers. Reuses the
// authoritative services; performs no business math of its own.
//
// Usage:
//   npx tsx scripts/brain-trace.ts <bank_txn_id | teller/plaid txn id | payment-log id | search text>
//   npx tsx scripts/brain-trace.ts "PAYMENT TO ACCT #9215"      # search by description
//   npx tsx scripts/brain-trace.ts 3984.91                      # search by amount

import { getDb } from '../src/lib/db';

const db = getDb();
const arg = process.argv[2];
if (!arg) { console.error('usage: brain-trace <id | description text | amount>'); process.exit(1); }

const show = (label: string, v: any) => console.log(`${label.padEnd(22)} ${v ?? '—'}`);

// resolve the argument to bank transaction(s)
let txns: any[] = [];
const byId = db.prepare(`SELECT * FROM bank_transactions WHERE id = ? OR teller_transaction_id = ?`).all(arg, arg);
if (byId.length) txns = byId;
else if (/^\d+(\.\d{1,2})?$/.test(arg)) {
  const cents = Math.round(parseFloat(arg) * 100);
  txns = db.prepare(`SELECT * FROM bank_transactions WHERE ABS(amount_cents) = ? ORDER BY date DESC LIMIT 5`).all(cents);
} else {
  txns = db.prepare(`SELECT * FROM bank_transactions WHERE description LIKE ? ORDER BY date DESC LIMIT 5`).all(`%${arg}%`);
}

// also check the manual payment log
const logs = db.prepare(`SELECT * FROM card_payments_log WHERE id = ? OR (amount_cents = CAST(? AS INTEGER))`).all(arg, /^\d+$/.test(arg) ? arg : -1) as any[];
if (!txns.length && logs.length) {
  for (const lg of logs) {
    console.log(`\n═══ LOGGED PAYMENT ${lg.id} ═══`);
    show('SOURCE', 'card_payments_log (manual intent)');
    show('DATE / AMOUNT', `${lg.date} · $${(lg.amount_cents / 100).toFixed(2)}`);
    show('CARD / CATEGORY', `··${lg.card_last4} · ${lg.category}`);
    const st: any = db.prepare('SELECT name FROM stores WHERE id = ?').get(lg.store_id);
    show('STORE', st?.name);
    const { reconcileLoggedPayments } = require('../src/lib/transactions-intel');
    const rec = reconcileLoggedPayments(db, 120)[lg.id];
    show('BANK VERIFICATION', rec ? `${rec.status}${rec.bankAccount ? ` — left ${rec.bankAccount} ··${rec.bankLast4} on ${rec.bankDate}` : ''}` : 'outside window');
    show('NOTES', lg.notes);
  }
  process.exit(0);
}
if (!txns.length) { console.error('nothing found'); process.exit(1); }

for (const t of txns) {
  console.log(`\n═══ TRANSACTION ${t.id} ═══`);
  const acct: any = db.prepare(`SELECT a.*, s.name AS store_name FROM bank_accounts a LEFT JOIN stores s ON s.id = a.store_id WHERE a.id = ?`).get(t.bank_account_id);
  show('SOURCE', `${acct?.provider || '?'} feed · external id ${t.teller_transaction_id || '(none — legacy/manual)'}`);
  show('ACCOUNT', `${acct?.institution_name} ${acct?.nickname || acct?.account_name} ··${acct?.last_four} [${acct?.company || 'ymgv'}]${acct?.store_name ? ` · store ${acct.store_name}` : ''}`);
  show('DATE / AMOUNT', `${t.date} · ${t.amount_cents < 0 ? '−' : '+'}$${(Math.abs(t.amount_cents) / 100).toFixed(2)} · ${t.status.toUpperCase()}`);
  show('DESCRIPTION', t.description);

  const l: any = db.prepare(`SELECT l.*, s.name AS store_name FROM txn_links l LEFT JOIN stores s ON s.id = l.store_id WHERE l.txn_id = ?`).get(t.id);
  if (!l) { show('INTERPRETATION', 'NONE — unclassified (invisible to downstream truth!)'); continue; }
  show('CLASS (what)', l.class);
  show('OWNER (who)', l.store_name || (l.class && ['card_payment','card_payment_sent','transfer','internal_transfer','interest_fee','owner_draw'].includes(l.class) ? '(structural — no owner needed)' : '❓ UNCATEGORIZED'));
  show('WHY (evidence)', l.confidence === 'manual' ? `manual: ${l.store_source || 'user-assigned'}` :
    l.match_evidence ? `${l.store_source || 'auto'} · ${l.match_evidence}` :
    l.store_source ? `${l.store_source}${l.match_score != null ? ` · score ${Math.round(l.match_score * 100)}%` : ''}` : 'class rules only');
  if (l.entity_type) {
    const ent: any = l.entity_type === 'ad_payment'
      ? db.prepare(`SELECT ap.date, ap.amount_cents, ap.platform, s.name store FROM ad_payments ap LEFT JOIN stores s ON s.id = ap.store_id WHERE ap.id = ?`).get(l.entity_id)
      : db.prepare(`SELECT i.date, i.total_cents AS amount_cents, s.name store FROM shopify_invoices i LEFT JOIN stores s ON s.id = i.store_id WHERE i.id = ?`).get(l.entity_id);
    show('MATCHED ENTITY', ent ? `${l.entity_type} · ${ent.store || '?'} · ${ent.date} · $${(Math.abs(ent.amount_cents) / 100).toFixed(2)}` : `${l.entity_type} ${l.entity_id} (record gone)`);
  }
  if (l.pair_txn_id) {
    const pr: any = db.prepare(`SELECT t2.date, t2.amount_cents, t2.description, a2.institution_name, a2.last_four FROM bank_transactions t2 JOIN bank_accounts a2 ON a2.id = t2.bank_account_id WHERE t2.id = ?`).get(l.pair_txn_id);
    show('PAIRED WITH', pr ? `${pr.date} · $${(Math.abs(pr.amount_cents) / 100).toFixed(2)} · ${pr.institution_name} ··${pr.last_four} — one economic payment, two legs` : `${l.pair_txn_id} (missing!)`);
  }
  show('BILLED TO P&L', l.billed_store_at ? `yes — ${l.billed_store_at}` : 'no (attribution only)');

  // downstream consumers (who reads this fact)
  const consumers: string[] = ['ledger'];
  if (acct?.account_type === 'credit') consumers.push('card composition/owed-by', 'remaining-statement', 'card drill');
  if (l.class === 'card_payment' || l.class === 'card_payment_sent') consumers.push('payments tab', 'store payment credits', 'in-flight/not-taken radar');
  if (l.class === 'shopify_payout') consumers.push('incoming-cash landed', 'coverage funding');
  if (l.store_id) consumers.push('store plans / CAN-PAY', 'CFO attribution');
  show('CONSUMERS', consumers.join(' · '));
  show('FEED FRESHNESS', acct?.balance_updated_at ? `account balance as of ${acct.balance_updated_at}` : 'no heartbeat');
}
