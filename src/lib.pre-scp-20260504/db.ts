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

    // Migration: creative_packages table — stores generated creative packages
    _db.exec(`CREATE TABLE IF NOT EXISTS creative_packages (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'video',
      creative_type TEXT NOT NULL DEFAULT 'testimonial',
      funnel_stage TEXT NOT NULL DEFAULT 'tof',
      hook_style TEXT NOT NULL DEFAULT 'curiosity',
      avatar_style TEXT NOT NULL DEFAULT 'female-ugc',
      generation_goal TEXT NOT NULL DEFAULT 'new-concept',
      quantity INTEGER NOT NULL DEFAULT 3,
      product_id TEXT,
      offer TEXT,
      base_ad_id TEXT,
      strategy TEXT,
      account_snapshot TEXT,
      packages TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_creative_packages_store ON creative_packages(store_id)`);

    // Migration: add package_id to creatives for linking to creative_packages
    const crCols = _db.prepare("PRAGMA table_info(creatives)").all() as any[];
    if (!crCols.find((c: any) => c.name === 'package_id')) {
      _db.exec("ALTER TABLE creatives ADD COLUMN package_id TEXT DEFAULT NULL");
      _db.exec("ALTER TABLE creatives ADD COLUMN package_index INTEGER DEFAULT NULL");
    }

    // Migration: add parent_id and version to creative_packages for variation trees
    const cpCols = _db.prepare("PRAGMA table_info(creative_packages)").all() as any[];
    if (!cpCols.find((c: any) => c.name === 'parent_id')) {
      _db.exec("ALTER TABLE creative_packages ADD COLUMN parent_id TEXT DEFAULT NULL");
      _db.exec("ALTER TABLE creative_packages ADD COLUMN parent_package_index INTEGER DEFAULT NULL");
      _db.exec("ALTER TABLE creative_packages ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
      _db.exec("CREATE INDEX IF NOT EXISTS idx_creative_packages_parent ON creative_packages(parent_id)");
    }

    // Migration: winner_references — saved winner/reference creatives with extracted DNA
    _db.exec(`CREATE TABLE IF NOT EXISTS winner_references (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      creative_id TEXT,
      package_id TEXT,
      package_index INTEGER,
      product_id TEXT,
      content_type TEXT,
      creative_type TEXT,
      funnel_stage TEXT,
      hook_style TEXT,
      avatar_style TEXT,
      platform TEXT DEFAULT 'meta',
      duration INTEGER,
      aspect_ratio TEXT,
      provider TEXT,
      title TEXT,
      concept TEXT,
      script TEXT,
      primary_text TEXT,
      headline TEXT,
      cta TEXT,
      render_prompt TEXT,
      hook_pattern TEXT,
      script_rhythm TEXT,
      pacing_notes TEXT,
      sentence_structure TEXT,
      cta_structure TEXT,
      proof_style TEXT,
      visual_composition TEXT,
      product_framing TEXT,
      energy_tone TEXT,
      editing_feel TEXT,
      structure_notes TEXT,
      product_placement TEXT,
      winning_tags TEXT,
      user_notes TEXT,
      is_launched INTEGER DEFAULT 0,
      performance_ad_id TEXT,
      performance_roas REAL,
      performance_ctr REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_winner_references_store ON winner_references(store_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_winner_references_setup ON winner_references(store_id, content_type, creative_type, funnel_stage)`);

    // Migration: setup_templates — reusable generation setups
    _db.exec(`CREATE TABLE IF NOT EXISTS setup_templates (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content_type TEXT,
      creative_type TEXT,
      funnel_stage TEXT,
      hook_style TEXT,
      avatar_style TEXT,
      platform TEXT DEFAULT 'meta',
      duration INTEGER,
      aspect_ratio TEXT,
      provider TEXT,
      winner_reference_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_setup_templates_store ON setup_templates(store_id)`);

    // Migration: product_foundations — Mark's foundational docs per product
    _db.exec(`CREATE TABLE IF NOT EXISTS product_foundations (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      beliefs TEXT,
      avatar_summary TEXT,
      offer_brief TEXT,
      unique_mechanism TEXT,
      research_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_product_foundations_product ON product_foundations(product_id)`);

    // Migration: concepts — persistent concept storage for concept-driven generation
    _db.exec(`CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      angle TEXT,
      hook_style TEXT,
      creative_type TEXT,
      funnel_stage TEXT,
      structure TEXT,
      product_id TEXT,
      adset_id TEXT,
      campaign_id TEXT,
      total_spend_cents INTEGER DEFAULT 0,
      total_purchases INTEGER DEFAULT 0,
      roas REAL DEFAULT 0,
      avg_ctr REAL DEFAULT 0,
      avg_cpa REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      last_generated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_concepts_store ON concepts(store_id)`);
  }
  return _db;
}
