import type DatabaseType from 'better-sqlite3';

/** CFO v2 (overview + tabs) is feature-flagged so it can be switched on and
 *  off without a deploy. Precedence: `?v2=1|0` on the request (per view) →
 *  brain_config key `cfo_v2` ('on'|'off', set from Settings) → env CFO_V2.
 *  The existing CFO page, API and data are untouched by the flag; it only
 *  adds the overview surface and the tab bar. */
export const CFO_V2_KEY = 'cfo_v2';

export function ensureBrainConfig(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS brain_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))`);
}

export function isCfoV2Enabled(db: DatabaseType.Database, override?: string | null): boolean {
  if (override === '1' || override === 'on') return true;
  if (override === '0' || override === 'off') return false;
  ensureBrainConfig(db);
  const row: any = db.prepare('SELECT value FROM brain_config WHERE key = ?').get(CFO_V2_KEY);
  if (row) return row.value === 'on';
  return process.env.CFO_V2 === '1' || process.env.CFO_V2 === 'on';
}

export function setCfoV2(db: DatabaseType.Database, on: boolean) {
  ensureBrainConfig(db);
  db.prepare(`INSERT INTO brain_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(CFO_V2_KEY, on ? 'on' : 'off');
}
