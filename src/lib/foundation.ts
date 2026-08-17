// ── Foundation: the company brain's ground floor ─────────────────────────────
// Moe's model, encoded: YM Global Ventures and ShipSourced are sibling
// companies. The brands and SS are all "just stores" — what makes them one
// organism is the shared money layer (banks + cards), managed here in YM.
// So the foundation's spine is CASH TRUTH:
//   1. every account belongs to a company (and usually a store)
//   2. every dollar that moves is explained — the unexplained remainder is
//      the headline number, and it should trend to zero
//   3. brand ↔ ShipSourced balances are REAL debt, tracked both directions;
//      brands pay SS by transfers between our own accounts (external clients
//      pay via Stripe/Zelle and live in SS's own books)

import type DatabaseType from 'better-sqlite3';

export type Company = 'ymgv' | 'shipsourced';

export function ensureFoundationSchema(db: DatabaseType.Database) {
  try { db.exec("ALTER TABLE bank_accounts ADD COLUMN company TEXT"); } catch { /* exists */ }
  // Seed rule: accounts assigned to the ShipSourced store belong to the
  // ShipSourced company; everything else is YMGV. Only fills blanks — a
  // manually set company is never overridden.
  const ss: any = db.prepare("SELECT id FROM stores WHERE name = 'ShipSourced'").get();
  if (ss) {
    db.prepare("UPDATE bank_accounts SET company = 'shipsourced' WHERE company IS NULL AND store_id = ?").run(ss.id);
  }
  db.prepare("UPDATE bank_accounts SET company = 'ymgv' WHERE company IS NULL").run();
}

export function setAccountCompany(db: DatabaseType.Database, accountId: string, company: Company) {
  ensureFoundationSchema(db);
  if (company !== 'ymgv' && company !== 'shipsourced') throw new Error('company must be ymgv or shipsourced');
  const r = db.prepare('UPDATE bank_accounts SET company = ?, updated_at = datetime(\'now\') WHERE id = ?').run(company, accountId);
  if (!r.changes) throw new Error('account not found');
}

// ── 1. Cash position now, per company ────────────────────────────────────────
// "Can I spend today" — checking cash minus what's already leaving.
export function getCashPosition(db: DatabaseType.Database) {
  ensureFoundationSchema(db);
  const companies: Record<string, any> = {
    ymgv: { cashCents: 0, pendingOutCents: 0, inFlightCents: 0, cardsOwedCents: 0, accounts: 0, staleAccounts: [] as any[] },
    shipsourced: { cashCents: 0, pendingOutCents: 0, inFlightCents: 0, cardsOwedCents: 0, accounts: 0, staleAccounts: [] as any[] },
  };
  const accounts: any[] = db.prepare(`
    SELECT id, company, account_type, account_name, institution_name, last_four,
           COALESCE(balance_available_cents, balance_ledger_cents, 0) avail,
           COALESCE(balance_ledger_cents, 0) ledger,
           bank_data_as_of
    FROM bank_accounts WHERE status = 'active' AND COALESCE(cfo_hidden, 0) = 0
  `).all();
  const pendingOut = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount_cents)), 0) c FROM bank_transactions
    WHERE bank_account_id = ? AND status = 'pending' AND amount_cents < 0 AND date >= date('now', '-14 days')
  `);
  for (const a of accounts) {
    const co = companies[a.company === 'shipsourced' ? 'shipsourced' : 'ymgv'];
    co.accounts++;
    if (a.account_type === 'credit') {
      co.cardsOwedCents += Math.abs(a.ledger);
    } else {
      co.cashCents += a.avail;
      co.pendingOutCents += (pendingOut.get(a.id) as any)?.c || 0;
    }
    // An account whose feed is >3 days old makes the cash number a guess
    if (a.bank_data_as_of && a.bank_data_as_of < new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)) {
      co.staleAccounts.push({ name: `${a.institution_name} ${a.account_name}`.slice(0, 40), last4: a.last_four, asOf: a.bank_data_as_of });
    }
  }
  // Payments that left a checking account but haven't landed on a card yet
  const inFlight: any[] = db.prepare(`
    SELECT a.company, COALESCE(SUM(ABS(t.amount_cents)), 0) c
    FROM bank_transactions t
    JOIN txn_links l ON l.txn_id = t.id AND l.class = 'card_payment_sent' AND l.pair_txn_id IS NULL
    JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE t.date >= date('now', '-10 days') GROUP BY a.company
  `).all();
  for (const f of inFlight) {
    companies[f.company === 'shipsourced' ? 'shipsourced' : 'ymgv'].inFlightCents = f.c;
  }
  for (const co of Object.values(companies)) {
    co.usableCents = Math.max(0, co.cashCents - co.pendingOutCents - co.inFlightCents);
  }
  return companies;
}

// ── 2. Bank ↔ books: every dollar explained, the remainder loud ──────────────
// "Explained" = the transaction has a real classification (not 'other') OR a
// store attribution OR a matched entity (invoice/payout/payment pair).
export function getBankBooksRecon(db: DatabaseType.Database, days = 30) {
  ensureFoundationSchema(db);
  const perAccount: any[] = db.prepare(`
    SELECT a.id, a.company, a.institution_name, a.account_name, a.last_four, a.account_type,
      COUNT(t.id) txns,
      COALESCE(SUM(ABS(t.amount_cents)), 0) moved_cents,
      COALESCE(SUM(CASE WHEN l.txn_id IS NOT NULL AND (COALESCE(l.class,'other') != 'other' OR l.store_id IS NOT NULL OR l.entity_id IS NOT NULL OR l.pair_txn_id IS NOT NULL)
        THEN ABS(t.amount_cents) ELSE 0 END), 0) explained_cents
    FROM bank_accounts a
    JOIN bank_transactions t ON t.bank_account_id = a.id AND t.status = 'posted' AND t.date >= date('now', ?)
    LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE a.status = 'active' AND COALESCE(a.cfo_hidden, 0) = 0
    GROUP BY a.id ORDER BY (moved_cents - explained_cents) DESC
  `).all(`-${days} days`);

  const unexplained: any[] = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, a.company,
           a.institution_name || ' ' || a.account_name AS account, a.last_four
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.status = 'active' AND COALESCE(a.cfo_hidden, 0) = 0
    LEFT JOIN txn_links l ON l.txn_id = t.id
    WHERE t.status = 'posted' AND t.date >= date('now', ?)
      AND (l.txn_id IS NULL OR (COALESCE(l.class,'other') = 'other' AND l.store_id IS NULL AND l.entity_id IS NULL AND l.pair_txn_id IS NULL))
    ORDER BY t.date DESC, ABS(t.amount_cents) DESC
    LIMIT 60
  `).all(`-${days} days`);

  const totals = { movedCents: 0, explainedCents: 0 };
  for (const a of perAccount) { totals.movedCents += a.moved_cents; totals.explainedCents += a.explained_cents; }
  return {
    days,
    perAccount: perAccount.map(a => ({
      ...a,
      unexplained_cents: a.moved_cents - a.explained_cents,
      explained_pct: a.moved_cents > 0 ? Math.round(100 * a.explained_cents / a.moved_cents) : 100,
    })),
    unexplained,
    totalMovedCents: totals.movedCents,
    totalExplainedCents: totals.explainedCents,
    totalUnexplainedCents: totals.movedCents - totals.explainedCents,
    explainedPct: totals.movedCents > 0 ? Math.round(100 * totals.explainedCents / totals.movedCents) : 100,
  };
}

// ── 3. Inter-company ledger: brands ↔ ShipSourced ────────────────────────────
// Balances come from the SS billing sync (stores.ss_*), already reconciled to
// SS's own books. Transfers between our OWN accounts are detected read-only:
// a debit in one account + matching credit in another (same amount, ≤3 days).
// A pair crossing the company line = an inter-company payment candidate.
export function getInterCompanyLedger(db: DatabaseType.Database, days = 60) {
  ensureFoundationSchema(db);
  const brands: any[] = db.prepare(`
    SELECT id, name, ss_charges_pending_cents billed, ss_total_paid_cents paid, ss_net_owed_cents owed
    FROM stores WHERE is_active = 1 AND shipsourced_client_id IS NOT NULL AND name != 'ShipSourced'
    ORDER BY ss_net_owed_cents DESC
  `).all();
  const totalOwedCents = brands.reduce((s, b) => s + Math.max(0, b.owed || 0), 0);

  // Own-account transfer pairing (read-only): candidates are transfer-ish txns
  const transferish: any[] = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, t.bank_account_id,
           a.company, a.institution_name || ' ·' || a.last_four AS account
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.status = 'active'
    WHERE t.status = 'posted' AND t.date >= date('now', ?)
      AND (lower(t.description) LIKE '%transfer%' OR lower(t.description) LIKE '%zelle%' OR lower(t.description) LIKE '%wire%')
  `).all(`-${days} days`);
  const credits = transferish.filter(t => t.amount_cents > 0);
  const debits = transferish.filter(t => t.amount_cents < 0);
  const usedCredits = new Set<string>();
  const pairs: any[] = [];
  for (const d of debits) {
    const match = credits.find(c =>
      !usedCredits.has(c.id) &&
      c.amount_cents === -d.amount_cents &&
      c.bank_account_id !== d.bank_account_id &&
      Math.abs(new Date(c.date + 'T12:00:00Z').getTime() - new Date(d.date + 'T12:00:00Z').getTime()) <= 3 * 86400000
    );
    if (match) {
      usedCredits.add(match.id);
      pairs.push({
        cents: Math.abs(d.amount_cents), date: d.date,
        from: d.account, fromCompany: d.company,
        to: match.account, toCompany: match.company,
        crossCompany: d.company !== match.company,
      });
    }
  }
  const interCoPaid = pairs.filter(p => p.crossCompany);
  return {
    brands,
    totalOwedCents,
    transfers: pairs.slice(0, 30),
    interCompanyTransfers: interCoPaid,
    interCompanyPaidCents: interCoPaid.reduce((s, p) => s + p.cents, 0),
  };
}
