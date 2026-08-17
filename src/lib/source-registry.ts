// ── Source registry ──────────────────────────────────────────────────────────
// Uniform freshness tracking for every data feed the brain depends on. The
// ShipHero cursor stall hid 31 hours of missing orders behind green sync runs
// because each feed tracked (or didn't track) its own health its own way.
// Every sync path reports here; "is my data trustworthy today" is one query.

import type DatabaseType from 'better-sqlite3';

export function ensureSourceRegistry(db: DatabaseType.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS data_sources (
    id TEXT PRIMARY KEY,
    label TEXT,
    company TEXT DEFAULT 'ymgv',
    store_id TEXT,
    expected_cadence_min INTEGER NOT NULL DEFAULT 60,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    last_records INTEGER,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
}

/** Called by every sync path after each attempt. Cheap upsert; never throws
 *  (a broken registry must not break the sync it observes). */
export function reportSource(
  db: DatabaseType.Database,
  id: string,
  r: { ok: boolean; records?: number; error?: string; label?: string; cadenceMin?: number; storeId?: string; company?: string }
) {
  try {
    ensureSourceRegistry(db);
    db.prepare(`INSERT INTO data_sources (id, label, company, store_id, expected_cadence_min, last_attempt_at,
        last_success_at, last_error, last_records, updated_at)
      VALUES (@id, @label, @company, @storeId, @cadence, datetime('now'),
        CASE WHEN @ok = 1 THEN datetime('now') ELSE NULL END,
        CASE WHEN @ok = 1 THEN NULL ELSE @error END,
        @records, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        label = COALESCE(excluded.label, data_sources.label),
        company = COALESCE(excluded.company, data_sources.company),
        store_id = COALESCE(excluded.store_id, data_sources.store_id),
        expected_cadence_min = COALESCE(excluded.expected_cadence_min, data_sources.expected_cadence_min),
        last_attempt_at = datetime('now'),
        last_success_at = CASE WHEN @ok = 1 THEN datetime('now') ELSE data_sources.last_success_at END,
        last_error = CASE WHEN @ok = 1 THEN NULL ELSE @error END,
        last_records = CASE WHEN @ok = 1 THEN @records ELSE data_sources.last_records END,
        updated_at = datetime('now')`)
      .run({
        id, ok: r.ok ? 1 : 0,
        label: r.label || null, company: r.company || null, storeId: r.storeId || null,
        cadence: r.cadenceMin || null, error: (r.error || '').slice(0, 300) || null,
        records: r.records ?? null,
      });
  } catch (e) {
    console.error('[source-registry] report failed:', (e as any)?.message);
  }
}

export type SourceState = 'fresh' | 'aging' | 'stale' | 'failing' | 'never';

/** Every source with a computed trust state.
 *  fresh   — succeeded within its cadence
 *  aging   — 1–3× cadence since last success (watch it)
 *  stale   — >3× cadence since last success (numbers driven by it are old)
 *  failing — the most recent attempt errored
 *  never   — registered but no success yet */
export function getSourceHealth(db: DatabaseType.Database) {
  ensureSourceRegistry(db);
  const rows: any[] = db.prepare(`
    SELECT *,
      CAST((julianday('now') - julianday(last_success_at)) * 24 * 60 AS INTEGER) AS mins_since_success
    FROM data_sources ORDER BY company, label
  `).all();
  const sources = rows.map(r => {
    let state: SourceState;
    if (!r.last_success_at) state = 'never';
    else if (r.last_error) state = 'failing';
    else if (r.mins_since_success <= r.expected_cadence_min) state = 'fresh';
    else if (r.mins_since_success <= r.expected_cadence_min * 3) state = 'aging';
    else state = 'stale';
    return { ...r, state };
  });
  const bad = sources.filter(s => s.state === 'stale' || s.state === 'failing');
  return {
    sources,
    trustworthy: bad.length === 0 && sources.length > 0,
    badCount: bad.length,
    summary: bad.length === 0
      ? 'all feeds current'
      : bad.map(b => `${b.label || b.id}: ${b.state}${b.last_error ? ` (${String(b.last_error).slice(0, 60)})` : ''}`).join(' · '),
  };
}
