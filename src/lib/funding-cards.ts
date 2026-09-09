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
