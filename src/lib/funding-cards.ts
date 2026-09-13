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

/** Every last4 a charge might be labelled with → the live account(s) that could
 *  hold it.
 *
 *  A mask is not an account, and the relationship runs both ways:
 *    - one card, several numbers — the number on the plastic (what Meta
 *      reports) and the account number the issuer posts against (what Plaid
 *      returns). Bank of America exposes both as separate accounts; ··1654 and
 *      ··9215 are one card. Once the duplicate is merged the losing mask must
 *      keep resolving, or the merge turns its history into "card not linked".
 *    - several cards, one account — Amex supplementary cards (··2976, ··9275,
 *      ··3304, ··1108) are distinct plastics that all bill to the Platinum
 *      ··1009 account. Those are aliases, never duplicates to be merged.
 *    - and one mask can belong to genuinely different accounts: the Amex
 *      Platinum and Gold cards BOTH end ··1009. Collapsing that to a single
 *      account would silently hide every charge on the other one, so a mask
 *      maps to a list and callers must accept a match on any of them.
 *
 *  Precedence, narrowest first: live accounts owning the mask are
 *  authoritative; failing that a learned/asserted funding alias; failing that
 *  a mask inherited from a merged twin. */
export function getCardAliasMap(db: DatabaseType.Database): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (l4: string, id: string) => {
    const cur = map.get(l4);
    if (!cur) map.set(l4, [id]);
    else if (!cur.includes(id)) cur.push(id);
  };

  // 3. masks left behind by merged duplicates, resolved to their survivor
  const merged: any[] = db.prepare(`
    SELECT d.last_four, k.id AS keep_id
    FROM bank_accounts d
    JOIN bank_accounts k ON k.id = d.merged_into AND k.status = 'active'
    WHERE d.status = 'merged' AND d.account_type = 'credit'
      AND d.last_four IS NOT NULL AND d.last_four != ''
  `).all();
  for (const r of merged) add(r.last_four, r.keep_id);

  // 2. learned/asserted funding-card aliases supersede an inherited mask
  for (const [l4, id] of getFundingCardMap(db)) map.set(l4, [id]);

  // 1. live accounts owning the mask win outright — and there may be several
  const live: any[] = db.prepare(`
    SELECT last_four, id FROM bank_accounts
    WHERE status = 'active' AND account_type = 'credit'
      AND last_four IS NOT NULL AND last_four != ''
  `).all();
  const liveMasks = new Set(live.map(r => r.last_four));
  for (const l4 of liveMasks) map.delete(l4);
  for (const r of live) add(r.last_four, r.id);

  return map;
}
