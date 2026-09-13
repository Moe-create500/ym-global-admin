import type DatabaseType from 'better-sqlite3';

/** last4 → bank_account_id map for FB funding cards (learned aliases).
 *  Extracted from the Brain engine when it was removed (2026-09-09). */
export function getFundingCardMap(db: DatabaseType.Database): Map<string, string> {
  const rows: any[] = db.prepare(`
    SELECT f.last4, f.bank_account_id FROM fb_funding_cards f
    JOIN bank_accounts a ON a.id = f.bank_account_id AND a.status = 'active'
  `).all();
  return new Map(rows.map(r => [r.last4, r.bank_account_id]));
}

/** Every last4 a charge might be labelled with → the live account it belongs to.
 *
 *  One card can be known by more than one number and they are all "correct":
 *    - the card number embossed on the plastic (what Meta reports), and
 *    - the account number the issuer posts against (what Plaid exposes).
 *  Bank of America routinely exposes both as separate accounts — ··1654 and
 *  ··9215 are one card. Once the duplicate is merged the losing mask must keep
 *  resolving, or every historical charge labelled with it silently reads
 *  "card not linked" and the merge makes reconciliation worse, not better.
 *
 *  Precedence, narrowest first: a live account's own mask always wins, then a
 *  learned/asserted funding alias, then a mask inherited from a merged twin. */
export function getCardAliasMap(db: DatabaseType.Database): Map<string, string> {
  const map = new Map<string, string>();

  // 3. masks left behind by merged duplicates, resolved to their survivor
  const merged: any[] = db.prepare(`
    SELECT d.last_four, k.id AS keep_id
    FROM bank_accounts d
    JOIN bank_accounts k ON k.id = d.merged_into AND k.status = 'active'
    WHERE d.status = 'merged' AND d.account_type = 'credit'
      AND d.last_four IS NOT NULL AND d.last_four != ''
  `).all();
  for (const r of merged) map.set(r.last_four, r.keep_id);

  // 2. learned/asserted funding-card aliases
  for (const [l4, id] of getFundingCardMap(db)) map.set(l4, id);

  // 1. a live account's own mask is authoritative
  const live: any[] = db.prepare(`
    SELECT last_four, id FROM bank_accounts
    WHERE status = 'active' AND account_type = 'credit'
      AND last_four IS NOT NULL AND last_four != ''
  `).all();
  for (const r of live) map.set(r.last_four, r.id);

  return map;
}
