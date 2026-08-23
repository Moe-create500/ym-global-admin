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
    // WAL + NORMAL: commits skip the per-commit fsync (batched at checkpoint).
    // Crash-safe for corruption; worst case loses only the most recent commit.
    _db.pragma('synchronous = NORMAL');

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
    if (!cols.find((c: any) => c.name === 'shipsourced_extra_client_ids')) {
      _db.exec("ALTER TABLE stores ADD COLUMN shipsourced_extra_client_ids TEXT DEFAULT NULL");
    }
    if (!cols.find((c: any) => c.name === 'cfo_overrides')) {
      _db.exec("ALTER TABLE stores ADD COLUMN cfo_overrides TEXT DEFAULT NULL");
    }

    // Migration: add is_global and credit_limit_cents to bank_accounts
    const baCols = _db.prepare("PRAGMA table_info(bank_accounts)").all() as any[];
    if (!baCols.find((c: any) => c.name === 'is_global')) {
      _db.exec("ALTER TABLE bank_accounts ADD COLUMN is_global INTEGER DEFAULT 0");
    }
    if (!baCols.find((c: any) => c.name === 'credit_limit_cents')) {
      _db.exec("ALTER TABLE bank_accounts ADD COLUMN credit_limit_cents INTEGER DEFAULT 0");
    }
    // Orders identity = number + DATE. The original UNIQUE(store_id,
    // order_number) made colliding numbers (store migrations re-use them)
    // block ALL imports for that store — Purebite froze at zero August orders
    // while 390 sat unshipped (2026-08-23). Rebuild once, data preserved.
    try {
      const ddl: any = _db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get();
      if (ddl?.sql && ddl.sql.includes('UNIQUE("store_id", "order_number")') && !ddl.sql.includes('"order_date")')) {
        const newDdl = ddl.sql
          .replace('UNIQUE("store_id", "order_number")', 'UNIQUE("store_id", "order_number", "order_date")')
          .replace(/CREATE TABLE (IF NOT EXISTS )?"orders"/, 'CREATE TABLE "orders_new"');
        _db.exec('PRAGMA foreign_keys=OFF');
        _db.exec('BEGIN');
        _db.exec(newDdl);
        _db.exec('INSERT INTO orders_new SELECT * FROM orders');
        _db.exec('DROP TABLE orders');
        _db.exec('ALTER TABLE orders_new RENAME TO orders');
        _db.exec('CREATE INDEX IF NOT EXISTS "idx_orders_store_date" ON "orders"("store_id", "order_date")');
        _db.exec('CREATE INDEX IF NOT EXISTS "idx_orders_store_number" ON "orders"("store_id", "order_number")');
        _db.exec('CREATE INDEX IF NOT EXISTS "idx_orders_store_source" ON "orders"("store_id", "source")');
        _db.exec('CREATE INDEX IF NOT EXISTS "idx_orders_store_financial" ON "orders"("store_id", "financial_status")');
        _db.exec('COMMIT');
        _db.exec('PRAGMA foreign_keys=ON');
        console.log('[db] orders uniqueness migrated to (store_id, order_number, order_date)');
      }
    } catch (e) { console.error('[db] orders identity migration failed:', e); }

    if (!baCols.find((c: any) => c.name === 'cfo_hidden')) {
      _db.exec("ALTER TABLE bank_accounts ADD COLUMN cfo_hidden INTEGER DEFAULT 0");
    }

    // Migration: add platform to card_payments_log
    const cplCols = _db.prepare("PRAGMA table_info(card_payments_log)").all() as any[];
    if (!cplCols.find((c: any) => c.name === 'platform')) {
      _db.exec("ALTER TABLE card_payments_log ADD COLUMN platform TEXT DEFAULT 'facebook'");
    }

    // Migration: chargeback workflow columns (Chargebacks tab)
    const cbCols = _db.prepare("PRAGMA table_info(chargebacks)").all() as any[];
    if (cbCols.length > 0) {
      if (!cbCols.find((c: any) => c.name === 'evidence_due_by')) {
        _db.exec("ALTER TABLE chargebacks ADD COLUMN evidence_due_by TEXT DEFAULT NULL");
      }
      if (!cbCols.find((c: any) => c.name === 'dispute_type')) {
        _db.exec("ALTER TABLE chargebacks ADD COLUMN dispute_type TEXT DEFAULT NULL");
      }
      if (!cbCols.find((c: any) => c.name === 'raw_status')) {
        _db.exec("ALTER TABLE chargebacks ADD COLUMN raw_status TEXT DEFAULT NULL");
      }
      if (!cbCols.find((c: any) => c.name === 'workflow_status')) {
        _db.exec("ALTER TABLE chargebacks ADD COLUMN workflow_status TEXT DEFAULT 'new'");
      }
      if (!cbCols.find((c: any) => c.name === 'response_notes')) {
        _db.exec("ALTER TABLE chargebacks ADD COLUMN response_notes TEXT DEFAULT NULL");
      }
      if (!cbCols.find((c: any) => c.name === 'handled_at')) {
        _db.exec("ALTER TABLE chargebacks ADD COLUMN handled_at TEXT DEFAULT NULL");
      }
      if (!cbCols.find((c: any) => c.name === 'response_workflow_id')) {
        _db.exec("ALTER TABLE chargebacks ADD COLUMN response_workflow_id TEXT DEFAULT NULL");
      }
    }

    // Migration: chargeback response workflows (playbooks) — tag each dispute
    // with the response strategy used, so win rate per reason×workflow is trackable
    _db.exec(`CREATE TABLE IF NOT EXISTS cb_response_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const cbwfCols = _db.prepare("PRAGMA table_info(cb_response_workflows)").all() as any[];
    if (!cbwfCols.find((c: any) => c.name === 'template_json')) {
      _db.exec("ALTER TABLE cb_response_workflows ADD COLUMN template_json TEXT DEFAULT NULL");
    }
    if (!cbwfCols.find((c: any) => c.name === 'match_reasons')) {
      _db.exec("ALTER TABLE cb_response_workflows ADD COLUMN match_reasons TEXT DEFAULT NULL");
    }
    const wfSeed = _db.prepare('SELECT COUNT(*) as n FROM cb_response_workflows').get() as any;
    if (wfSeed.n === 0) {
      const ins = _db.prepare('INSERT INTO cb_response_workflows (id, name, description) VALUES (?, ?, ?)');
      ins.run('wf_full_evidence', 'Full Evidence Pack', 'Tracking + delivery proof + order details + customer comms');
      ins.run('wf_delivery_proof', 'Delivery Proof Only', 'Carrier tracking + proof of delivery');
      ins.run('wf_refund_first', 'Refund First', 'Refund the order to close inquiries before they escalate');
    }
    // Starter evidence templates for the seeded playbooks (only where still empty)
    const tplBackfill = _db.prepare('UPDATE cb_response_workflows SET template_json = ?, match_reasons = ? WHERE id = ? AND template_json IS NULL');
    tplBackfill.run(JSON.stringify({
      uncategorized_text: 'This charge is valid. Order {{order_number}} was placed on {{order_date}} by {{customer_name}} ({{customer_email}}) for {{line_items}}. The order shipped via {{carrier}}, tracking {{tracking_number}}, on {{shipping_date}} to the address provided at checkout: {{shipping_address}}. Tracking: {{tracking_url}}. The product was delivered as described and no refund request was received through our support channels before this dispute was filed.',
      product_description: '{{line_items}} — purchased on {{order_date}} for {{amount}} from {{store_name}}.',
      refund_refusal_explanation: 'Our refund policy is displayed at checkout. The customer did not contact support to request a refund before filing this dispute, so we had no opportunity to resolve the issue directly.',
      files: ['shipping_documentation', 'customer_communication', 'response_summary'],
    }), JSON.stringify(['fraudulent', 'unrecognized', 'general']), 'wf_full_evidence');
    tplBackfill.run(JSON.stringify({
      uncategorized_text: 'Order {{order_number}} shipped via {{carrier}}, tracking {{tracking_number}}, on {{shipping_date}} to {{shipping_address}} — the address the customer provided at checkout. Carrier tracking ({{tracking_url}}) confirms delivery.',
      product_description: '{{line_items}} — purchased on {{order_date}} for {{amount}} from {{store_name}}.',
      files: ['shipping_documentation'],
    }), JSON.stringify(['product_not_received']), 'wf_delivery_proof');

    // Migration: cfo_snapshots.excluded — a blocked snapshot is skipped by the
    // reconciliation chain (used to redo a window after fixing underlying data)
    const csCols = _db.prepare("PRAGMA table_info(cfo_snapshots)").all() as any[];
    if (csCols.length > 0 && !csCols.find((c: any) => c.name === 'excluded')) {
      _db.exec("ALTER TABLE cfo_snapshots ADD COLUMN excluded INTEGER DEFAULT 0");
    }

    // Migration: estimated fulfillment portion of shipping_cost_cents (un-billed orders)
    const dpCols = _db.prepare("PRAGMA table_info(daily_pnl)").all() as any[];
    if (!dpCols.find((c: any) => c.name === 'fulfillment_est_cents')) {
      _db.exec("ALTER TABLE daily_pnl ADD COLUMN fulfillment_est_cents INTEGER DEFAULT 0");
    }

    // Migration: refunds per day (rolled up from Shopify Payments balance txns)
    if (!dpCols.find((c: any) => c.name === 'refunds_cents')) {
      _db.exec("ALTER TABLE daily_pnl ADD COLUMN refunds_cents INTEGER DEFAULT 0");
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

    // Migration: manual_credit_cards table for CFO liabilities
    _db.exec(`CREATE TABLE IF NOT EXISTS manual_credit_cards (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      card_name TEXT NOT NULL DEFAULT '',
      amount_owed_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_cc_store ON manual_credit_cards(store_id)`);

    // Migration: hidden_invoice_cards table for hiding cards from FB Invoices page
    _db.exec(`CREATE TABLE IF NOT EXISTS hidden_invoice_cards (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      card_last4 TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'facebook',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hidden_invoice_cards ON hidden_invoice_cards(store_id, card_last4, platform)`);

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
