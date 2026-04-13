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
    if (!cols.find((c: any) => c.name === 'dashboard_hidden')) {
      _db.exec("ALTER TABLE stores ADD COLUMN dashboard_hidden INTEGER DEFAULT 0");
    }

    // Migration: add is_global to bank_accounts for unassigned accounts
    const baCols = _db.prepare("PRAGMA table_info(bank_accounts)").all() as any[];
    if (!baCols.find((c: any) => c.name === 'is_global')) {
      _db.exec("ALTER TABLE bank_accounts ADD COLUMN is_global INTEGER DEFAULT 0");
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

    // Migration: fb_ads table for tracking pushed ads
    _db.exec(`CREATE TABLE IF NOT EXISTS fb_ads (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      creative_id TEXT,
      fb_ad_id TEXT,
      fb_creative_id TEXT,
      fb_video_id TEXT,
      fb_campaign_id TEXT,
      fb_ad_set_id TEXT,
      name TEXT NOT NULL,
      headline TEXT,
      primary_text TEXT,
      cta_type TEXT,
      landing_page_url TEXT,
      status TEXT NOT NULL DEFAULT 'paused',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_fb_ads_store ON fb_ads(store_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_fb_ads_creative ON fb_ads(creative_id)`);

    // Migration: video_pipelines table for B-roll + avatar pipeline
    _db.exec(`CREATE TABLE IF NOT EXISTS video_pipelines (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ad_script TEXT NOT NULL,
      avatar_id TEXT NOT NULL,
      voice_id TEXT NOT NULL,
      broll_count INTEGER NOT NULL DEFAULT 7,
      broll_prompts TEXT,
      avatar_creative_id TEXT,
      avatar_video_id TEXT,
      completed_clips INTEGER NOT NULL DEFAULT 0,
      total_clips INTEGER NOT NULL DEFAULT 11,
      final_creative_id TEXT,
      final_video_url TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_video_pipelines_store ON video_pipelines(store_id)`);

    // Migration: add pipeline_id to creatives
    const creativeCols = _db.prepare("PRAGMA table_info(creatives)").all() as any[];
    if (!creativeCols.find((c: any) => c.name === 'pipeline_id')) {
      _db.exec("ALTER TABLE creatives ADD COLUMN pipeline_id TEXT DEFAULT NULL");
    }

    // Migration: reserves table for manual CFO asset entries
    _db.exec(`CREATE TABLE IF NOT EXISTS reserves (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      held_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_reserves_store ON reserves(store_id)`);

    // Migration: employee_uploads table for tracking employee work
    _db.exec(`CREATE TABLE IF NOT EXISTS employee_uploads (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT 'shopify',
      records_imported INTEGER DEFAULT 0,
      records_updated INTEGER DEFAULT 0,
      records_duplicate INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_employee_uploads_employee ON employee_uploads(employee_id, created_at)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_employee_uploads_store ON employee_uploads(store_id, created_at)`);
  }
  return _db;
}
