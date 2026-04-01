import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'prisma', 'dev.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('busy_timeout = 5000');
    _db.pragma('foreign_keys = ON');

    // Migration: add platform_fee_pct and amazon_category to stores
    const cols = _db.prepare("PRAGMA table_info(stores)").all() as any[];
    if (!cols.find((c: any) => c.name === 'platform_fee_pct')) {
      _db.exec("ALTER TABLE stores ADD COLUMN platform_fee_pct REAL DEFAULT 0");
    }
    if (!cols.find((c: any) => c.name === 'amazon_category')) {
      _db.exec("ALTER TABLE stores ADD COLUMN amazon_category TEXT DEFAULT NULL");
    }

    // Migration: add platform to card_payments_log
    const cplCols = _db.prepare("PRAGMA table_info(card_payments_log)").all() as any[];
    if (!cplCols.find((c: any) => c.name === 'platform')) {
      _db.exec("ALTER TABLE card_payments_log ADD COLUMN platform TEXT DEFAULT 'facebook'");
    }

    // Migration: cfo_snapshots table
    _db.exec(`CREATE TABLE IF NOT EXISTS cfo_snapshots (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      assets_cents INTEGER NOT NULL DEFAULT 0,
      liabilities_cents INTEGER NOT NULL DEFAULT 0,
      equity_cents INTEGER NOT NULL DEFAULT 0,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_cfo_snapshots_store ON cfo_snapshots(store_id, snapshot_date)`)
  }
  return _db;
}
