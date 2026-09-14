// ============================================================================
// ACCOUNT IDENTITY — one real bank account = one canonical visible account.
//
// Root cause fixed here (2026-09-09): provider connections were modeled AS
// bank accounts, so a Teller→Plaid migration (or any reconnect that rotates
// provider account ids) left the old connection behind as a second visible
// "account" with a frozen last-known balance polluting cash totals.
//
// Model:
//   bank_accounts        = canonical accounts (merged dupes get status='merged'
//                          + merged_into — preserved for audit, invisible)
//   account_connections  = connection HISTORY (provider, item/enrollment id,
//                          provider account id, connected/disconnected)
//
// Matching is layered and name-aware: Amex twin cards legitimately share a
// mask (Gold ·1009 + Platinum ·1009), so mask+institution alone NEVER decides
// identity. Ambiguity → possible-duplicate review, never a silent merge.
// ============================================================================

import type Database from 'better-sqlite3';
import crypto from 'crypto';

export function ensureIdentitySchema(db: Database.Database) {
  try { db.exec('ALTER TABLE bank_accounts ADD COLUMN merged_into TEXT'); } catch { /* exists */ }
  db.exec(`CREATE TABLE IF NOT EXISTS account_connections (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_item_id TEXT,
    provider_account_id TEXT,
    connected_at TEXT,
    disconnected_at TEXT,
    status TEXT DEFAULT 'active',
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_account_connections_acct ON account_connections(account_id)');
}

export interface MergeProposal {
  keepId: string;
  dupId: string;
  institution: string;
  last_four: string;
  account_name: string;
  confidence: 'exact_name' | 'sole_candidate';
  dup_status: string;
  dup_txn_count: number;
  dup_balance_cents: number;
}

/** Find duplicate account rows: same (institution, mask, type), where a
 *  non-active row matches an active canonical row by EXACT account name —
 *  or is the sole possible partner. Twin cards (different names) never match. */
export function scanDuplicateAccounts(db: Database.Database): { proposals: MergeProposal[]; ambiguous: any[] } {
  ensureIdentitySchema(db);
  const groups: any[] = db.prepare(`
    SELECT institution_name, last_four, account_type FROM bank_accounts
    WHERE status != 'merged'
    GROUP BY institution_name, last_four, account_type HAVING COUNT(*) > 1`).all();
  const proposals: MergeProposal[] = [];
  const ambiguous: any[] = [];
  for (const g of groups) {
    const rows: any[] = db.prepare(`
      SELECT id, account_name, status, provider, balance_available_cents, balance_updated_at
      FROM bank_accounts WHERE institution_name = ? AND last_four = ? AND account_type = ? AND status != 'merged'
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, balance_updated_at DESC`).all(g.institution_name, g.last_four, g.account_type);
    const actives = rows.filter(r => r.status === 'active');
    const others = rows.filter(r => r.status !== 'active');
    for (const dup of others) {
      // exact-name match against an active canonical
      const named = actives.filter(a => (a.account_name || '') === (dup.account_name || ''));
      let keep: any = null;
      let confidence: MergeProposal['confidence'] | null = null;
      if (named.length === 1) { keep = named[0]; confidence = 'exact_name'; }
      else if (named.length === 0 && actives.length === 1 && others.length === 1) {
        // one active + one inactive, names differ (rename across providers) —
        // sole possible partner, still safe
        keep = actives[0]; confidence = 'sole_candidate';
      }
      if (keep && confidence) {
        const txnCount: any = db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE bank_account_id = ?').get(dup.id);
        proposals.push({
          keepId: keep.id, dupId: dup.id,
          institution: g.institution_name, last_four: g.last_four,
          account_name: dup.account_name, confidence,
          dup_status: dup.status, dup_txn_count: txnCount.n,
          dup_balance_cents: dup.balance_available_cents || 0,
        });
      } else {
        ambiguous.push({ group: g, dup, actives: actives.map(a => ({ id: a.id, name: a.account_name })) });
      }
    }
    // two ACTIVE rows with the same name = live duplicate needing review (never auto-merge live rows)
    const byName = new Map<string, any[]>();
    for (const a of actives) {
      const k = a.account_name || '';
      byName.set(k, [...(byName.get(k) || []), a]);
    }
    for (const [name, list] of byName) if (list.length > 1) ambiguous.push({ group: g, live_duplicates: list.map(a => a.id), name });
  }
  return { proposals, ambiguous };
}

/** Merge a duplicate account row into its canonical twin.
 *  - transactions: content-twins on the canonical are deleted from the dup
 *    (with txn_links cleanup); unique history is re-pointed to the canonical
 *  - both provider connections are preserved in account_connections
 *  - the dup row survives as status='merged' (audit), invisible everywhere
 *  Idempotent: merging an already-merged row is a no-op. */
export function mergeAccounts(db: Database.Database, keepId: string, dupId: string, opts: { dryRun?: boolean; actor?: string; assertSameCard?: string } = {}) {
  ensureIdentitySchema(db);
  const keep: any = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(keepId);
  const dup: any = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(dupId);
  if (!keep || !dup) throw new Error('account not found');
  if (dup.status === 'merged') return { merged: false, reason: 'already merged', moved: 0, deduped: 0 };
  if (keep.status === 'merged') throw new Error('cannot merge into a merged account');
  if (keep.institution_name !== dup.institution_name || keep.account_type !== dup.account_type) {
    throw new Error('refusing merge: institution/type mismatch — not provably the same real account');
  }
  // A differing mask is normally proof these are different accounts, so it stays
  // a refusal. The exception is real and specific: some issuers (Bank of America
  // consistently) expose one card twice — once under the card number, once under
  // the account number. Only a human who knows the card can assert that, so it
  // takes an explicit reason and never happens automatically.
  if (keep.last_four !== dup.last_four && !opts.assertSameCard) {
    throw new Error(`refusing merge: mask mismatch ··${keep.last_four} vs ··${dup.last_four} — pass assertSameCard with a reason if these are one card (e.g. a BoA card-number/account-number pair)`);
  }
  if (dup.status === 'active' && keep.status !== 'active') throw new Error('refusing merge: dup is active but keep is not — direction looks wrong');

  const dupTxns: any[] = db.prepare('SELECT id, date, amount_cents, description, teller_transaction_id FROM bank_transactions WHERE bank_account_id = ?').all(dupId);
  const twinQ = db.prepare('SELECT id FROM bank_transactions WHERE bank_account_id = ? AND date = ? AND amount_cents = ? AND description = ? LIMIT 1');
  let moved = 0, deduped = 0;
  const work = () => {
    for (const t of dupTxns) {
      const twin: any = twinQ.get(keepId, t.date, t.amount_cents, t.description || '');
      if (twin) {
        // same economic event exists on the canonical — drop the copy, clean lineage
        db.prepare('UPDATE txn_links SET pair_txn_id = NULL WHERE pair_txn_id = ?').run(t.id);
        db.prepare('DELETE FROM txn_links WHERE txn_id = ?').run(t.id);
        // The copy's classification verdict must not outlive it. A human's
        // MANUAL verdict moves to the survivor if the survivor has none; any
        // other verdict is dropped — the survivor carries its own. (Found
        // 2026-09-14: two merges left 11 verdicts pointing at deleted rows.)
        try {
          const surv = db.prepare('SELECT method FROM classification_results WHERE txn_id = ?').get(twin.id) as any;
          const mine = db.prepare('SELECT method FROM classification_results WHERE txn_id = ?').get(t.id) as any;
          if (mine && mine.method === 'MANUAL' && !surv) {
            db.prepare('UPDATE classification_results SET txn_id = ? WHERE txn_id = ?').run(twin.id, t.id);
          } else {
            db.prepare('DELETE FROM classification_results WHERE txn_id = ?').run(t.id);
          }
        } catch { /* schema without classification_results (tests, early DBs) */ }
        db.prepare('DELETE FROM bank_transactions WHERE id = ?').run(t.id);
        deduped++;
      } else {
        db.prepare('UPDATE bank_transactions SET bank_account_id = ? WHERE id = ?').run(keepId, t.id);
        moved++;
      }
    }
    // statements: canonical wins; adopt the dup's only if canonical has none
    const keepStmt = db.prepare('SELECT bank_account_id FROM card_statements WHERE bank_account_id = ?').get(keepId);
    if (keepStmt) db.prepare('DELETE FROM card_statements WHERE bank_account_id = ?').run(dupId);
    else db.prepare('UPDATE card_statements SET bank_account_id = ? WHERE bank_account_id = ?').run(keepId, dupId);
    db.prepare('UPDATE fb_funding_cards SET bank_account_id = ? WHERE bank_account_id = ?').run(keepId, dupId);

    // preserve BOTH connections as history
    const conn = db.prepare(`INSERT INTO account_connections (id, account_id, provider, provider_item_id, provider_account_id, connected_at, disconnected_at, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    conn.run(crypto.randomUUID(), keepId, dup.provider || 'unknown', dup.teller_enrollment_id, dup.teller_account_id,
      dup.created_at, dup.updated_at, 'superseded', `merged duplicate account row ${dupId}`);
    const existingConn = db.prepare('SELECT id FROM account_connections WHERE account_id = ? AND provider_account_id = ?').get(keepId, keep.teller_account_id);
    if (!existingConn) {
      conn.run(crypto.randomUUID(), keepId, keep.provider || 'unknown', keep.teller_enrollment_id, keep.teller_account_id,
        keep.created_at, null, 'active', null);
    }

    db.prepare("UPDATE bank_accounts SET status = 'merged', merged_into = ?, updated_at = datetime('now') WHERE id = ?").run(keepId, dupId);
    // employee_id is FK'd to employees — system/admin actions log with NULL
    // and carry the actor inside details instead
    db.prepare(`INSERT INTO activity_log (id, employee_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, NULL, 'account_merge', 'bank_account', ?, ?, datetime('now'))`)
      .run(crypto.randomUUID(), dupId,
        JSON.stringify({ actor: opts.actor || 'system', merged_into: keepId, txns_moved: moved, txns_deduped: deduped, dup_balance_cents: dup.balance_available_cents,
          keep_mask: keep.last_four, dup_mask: dup.last_four,
          ...(keep.last_four !== dup.last_four ? { same_card_assertion: opts.assertSameCard } : {}) }));
  };
  if (opts.dryRun) {
    // simulate counts without writing
    let m = 0, d = 0;
    for (const t of dupTxns) { if (twinQ.get(keepId, t.date, t.amount_cents, t.description || '')) d++; else m++; }
    return { merged: false, dryRun: true, moved: m, deduped: d };
  }
  db.transaction(work)();
  return { merged: true, moved, deduped };
}

/** Pre-insert guard for enrollment paths: find the canonical account an
 *  incoming provider account belongs to. Returns the match, or marks the
 *  situation ambiguous so callers park the row for review instead of
 *  inserting a visible duplicate. */
export function findCanonicalMatch(db: Database.Database, incoming: {
  institution: string; mask: string; type: string; name?: string; providerAccountId?: string;
}): { match: any | null; ambiguous: boolean; candidates: any[] } {
  if (incoming.providerAccountId) {
    const exact: any = db.prepare("SELECT * FROM bank_accounts WHERE teller_account_id = ? AND status != 'merged'").get(incoming.providerAccountId);
    if (exact) return { match: exact, ambiguous: false, candidates: [exact] };
  }
  const candidates: any[] = db.prepare(`
    SELECT * FROM bank_accounts WHERE institution_name = ? AND last_four = ? AND account_type = ? AND status != 'merged'
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC`).all(incoming.institution, incoming.mask, incoming.type);
  if (candidates.length === 0) return { match: null, ambiguous: false, candidates: [] };
  const named = incoming.name ? candidates.filter(c => (c.account_name || '') === incoming.name) : [];
  if (named.length === 1) return { match: named[0], ambiguous: false, candidates };
  if (named.length > 1) return { match: null, ambiguous: true, candidates: named };
  if (candidates.length === 1) return { match: candidates[0], ambiguous: false, candidates };
  // multiple candidates, none name-matched (twin masks) — do not guess
  return { match: null, ambiguous: true, candidates };
}
