#!/usr/bin/env python3
"""
YM Global — Database Migration Script
Run: python3 prisma/migrate.py
"""

import sqlite3
import os
import shutil
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "dev.db")

def backup():
    if os.path.exists(DB_PATH):
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = f"{DB_PATH}.backup-{ts}"
        shutil.copy2(DB_PATH, backup_path)
        print(f"Backup saved at: {backup_path}")

def create_table(cursor, name, sql):
    cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
    if cursor.fetchone():
        print(f"  . {name} already exists, skipping")
    else:
        cursor.execute(sql)
        print(f"  + {name} created")

def add_column(cursor, table, column, sql):
    cursor.execute(f"PRAGMA table_info({table})")
    cols = [row[1] for row in cursor.fetchall()]
    if column in cols:
        print(f"  . {table}.{column} already exists, skipping")
    else:
        cursor.execute(sql)
        print(f"  + {table}.{column} added")

def create_index(cursor, name, sql):
    cursor.execute("SELECT name FROM sqlite_master WHERE type='index' AND name=?", (name,))
    if cursor.fetchone():
        print(f"  . index {name} already exists, skipping")
    else:
        cursor.execute(sql)
        print(f"  + index {name} created")

def main():
    print(f"\n=== YM Global Migration ===")
    print(f"Database: {DB_PATH}")
    backup()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # WAL mode
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")

    print("\n--- Core Tables ---")

    create_table(cursor, "stores", '''
        CREATE TABLE "stores" (
            "id" TEXT PRIMARY KEY,
            "name" TEXT NOT NULL,
            "shopify_domain" TEXT,
            "shipsourced_client_id" TEXT,
            "shipsourced_client_name" TEXT,
            "shopify_monthly_plan_cents" INTEGER NOT NULL DEFAULT 0,
            "is_active" INTEGER NOT NULL DEFAULT 1,
            "notes" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "daily_pnl", '''
        CREATE TABLE "daily_pnl" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "date" TEXT NOT NULL,
            "revenue_cents" INTEGER NOT NULL DEFAULT 0,
            "order_count" INTEGER NOT NULL DEFAULT 0,
            "cogs_cents" INTEGER NOT NULL DEFAULT 0,
            "us_cogs_cents" INTEGER NOT NULL DEFAULT 0,
            "china_cogs_cents" INTEGER NOT NULL DEFAULT 0,
            "shipping_cost_cents" INTEGER NOT NULL DEFAULT 0,
            "pick_pack_cents" INTEGER NOT NULL DEFAULT 0,
            "packaging_cents" INTEGER NOT NULL DEFAULT 0,
            "ad_spend_cents" INTEGER NOT NULL DEFAULT 0,
            "shopify_fees_cents" INTEGER NOT NULL DEFAULT 0,
            "other_costs_cents" INTEGER NOT NULL DEFAULT 0,
            "other_costs_note" TEXT,
            "net_profit_cents" INTEGER NOT NULL DEFAULT 0,
            "margin_pct" REAL NOT NULL DEFAULT 0,
            "is_confirmed" INTEGER NOT NULL DEFAULT 0,
            "confirmed_at" TEXT,
            "source" TEXT DEFAULT 'sync',
            "synced_at" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE("store_id", "date")
        )
    ''')

    create_table(cursor, "ad_spend", '''
        CREATE TABLE "ad_spend" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "date" TEXT NOT NULL,
            "platform" TEXT NOT NULL DEFAULT 'facebook',
            "campaign_id" TEXT,
            "campaign_name" TEXT,
            "ad_set_id" TEXT,
            "ad_set_name" TEXT,
            "spend_cents" INTEGER NOT NULL DEFAULT 0,
            "impressions" INTEGER DEFAULT 0,
            "clicks" INTEGER DEFAULT 0,
            "purchases" INTEGER DEFAULT 0,
            "purchase_value_cents" INTEGER DEFAULT 0,
            "roas" REAL DEFAULT 0,
            "notes" TEXT,
            "source" TEXT DEFAULT 'api',
            "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "facebook_accounts", '''
        CREATE TABLE "facebook_accounts" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT REFERENCES "stores"("id"),
            "fb_user_id" TEXT NOT NULL,
            "fb_user_name" TEXT,
            "ad_account_id" TEXT NOT NULL,
            "ad_account_name" TEXT,
            "access_token" TEXT NOT NULL,
            "token_expires_at" TEXT,
            "is_active" INTEGER NOT NULL DEFAULT 1,
            "last_sync_at" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "payment_cards", '''
        CREATE TABLE "payment_cards" (
            "id" TEXT PRIMARY KEY,
            "card_name" TEXT NOT NULL,
            "last_four" TEXT,
            "card_type" TEXT,
            "issuer" TEXT,
            "notes" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "card_assignments", '''
        CREATE TABLE "card_assignments" (
            "id" TEXT PRIMARY KEY,
            "card_id" TEXT NOT NULL REFERENCES "payment_cards"("id"),
            "store_id" TEXT REFERENCES "stores"("id"),
            "service" TEXT NOT NULL,
            "description" TEXT,
            "monthly_cost_cents" INTEGER DEFAULT 0,
            "is_active" INTEGER NOT NULL DEFAULT 1,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "manual_entries", '''
        CREATE TABLE "manual_entries" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT REFERENCES "stores"("id"),
            "date" TEXT NOT NULL,
            "entry_type" TEXT NOT NULL,
            "amount_cents" INTEGER NOT NULL,
            "description" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "sync_log", '''
        CREATE TABLE "sync_log" (
            "id" TEXT PRIMARY KEY,
            "sync_type" TEXT NOT NULL,
            "store_id" TEXT,
            "status" TEXT NOT NULL DEFAULT 'running',
            "records_synced" INTEGER DEFAULT 0,
            "error_message" TEXT,
            "started_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "completed_at" TEXT
        )
    ''')

    print("\n--- Enterprise Tables ---")

    create_table(cursor, "employees", '''
        CREATE TABLE "employees" (
            "id" TEXT PRIMARY KEY,
            "name" TEXT NOT NULL,
            "email" TEXT NOT NULL UNIQUE,
            "role" TEXT NOT NULL DEFAULT 'viewer',
            "password_hash" TEXT,
            "is_active" INTEGER NOT NULL DEFAULT 1,
            "last_login_at" TEXT,
            "permissions" TEXT DEFAULT '{}',
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "employee_store_access", '''
        CREATE TABLE "employee_store_access" (
            "id" TEXT PRIMARY KEY,
            "employee_id" TEXT NOT NULL REFERENCES "employees"("id"),
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "role" TEXT NOT NULL DEFAULT 'viewer',
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE("employee_id", "store_id")
        )
    ''')

    create_table(cursor, "fb_profiles", '''
        CREATE TABLE "fb_profiles" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "profile_name" TEXT NOT NULL,
            "fb_page_id" TEXT,
            "fb_page_name" TEXT,
            "fb_page_access_token" TEXT,
            "instagram_actor_id" TEXT,
            "pixel_id" TEXT,
            "ad_account_id" TEXT,
            "ad_account_name" TEXT,
            "access_token" TEXT,
            "token_expires_at" TEXT,
            "business_id" TEXT,
            "is_active" INTEGER NOT NULL DEFAULT 1,
            "last_sync_at" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "products", '''
        CREATE TABLE "products" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "shopify_product_id" TEXT,
            "title" TEXT NOT NULL,
            "sku" TEXT,
            "variant_title" TEXT,
            "image_url" TEXT,
            "price_cents" INTEGER NOT NULL DEFAULT 0,
            "cost_cents" INTEGER NOT NULL DEFAULT 0,
            "us_cost_cents" INTEGER NOT NULL DEFAULT 0,
            "china_cost_cents" INTEGER NOT NULL DEFAULT 0,
            "weight_grams" INTEGER DEFAULT 0,
            "category" TEXT,
            "status" TEXT NOT NULL DEFAULT 'active',
            "fb_catalog_id" TEXT,
            "fb_product_set_id" TEXT,
            "synced_at" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "creatives", '''
        CREATE TABLE "creatives" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "product_id" TEXT REFERENCES "products"("id"),
            "type" TEXT NOT NULL DEFAULT 'video',
            "title" TEXT NOT NULL,
            "description" TEXT,
            "file_url" TEXT,
            "thumbnail_url" TEXT,
            "duration_seconds" INTEGER,
            "width" INTEGER,
            "height" INTEGER,
            "format" TEXT,
            "status" TEXT NOT NULL DEFAULT 'draft',
            "fb_video_id" TEXT,
            "fb_post_id" TEXT,
            "template_id" TEXT,
            "template_data" TEXT,
            "created_by" TEXT REFERENCES "employees"("id"),
            "approved_by" TEXT REFERENCES "employees"("id"),
            "approved_at" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "creative_templates", '''
        CREATE TABLE "creative_templates" (
            "id" TEXT PRIMARY KEY,
            "name" TEXT NOT NULL,
            "description" TEXT,
            "type" TEXT NOT NULL DEFAULT 'video',
            "template_data" TEXT NOT NULL DEFAULT '{}',
            "thumbnail_url" TEXT,
            "is_active" INTEGER NOT NULL DEFAULT 1,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "fb_campaigns", '''
        CREATE TABLE "fb_campaigns" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "fb_profile_id" TEXT REFERENCES "fb_profiles"("id"),
            "fb_campaign_id" TEXT,
            "name" TEXT NOT NULL,
            "objective" TEXT,
            "status" TEXT NOT NULL DEFAULT 'paused',
            "daily_budget_cents" INTEGER DEFAULT 0,
            "lifetime_budget_cents" INTEGER DEFAULT 0,
            "start_date" TEXT,
            "end_date" TEXT,
            "targeting" TEXT DEFAULT '{}',
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "ad_payments", '''
        CREATE TABLE "ad_payments" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "platform" TEXT NOT NULL,
            "date" TEXT NOT NULL,
            "transaction_id" TEXT NOT NULL,
            "payment_method" TEXT,
            "card_last4" TEXT,
            "amount_cents" INTEGER NOT NULL,
            "currency" TEXT DEFAULT 'USD',
            "status" TEXT DEFAULT 'paid',
            "account_id" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE("transaction_id")
        )
    ''')

    create_table(cursor, "card_payments_log", '''
        CREATE TABLE "card_payments_log" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "card_last4" TEXT NOT NULL,
            "date" TEXT NOT NULL,
            "amount_cents" INTEGER NOT NULL,
            "method" TEXT,
            "notes" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_table(cursor, "activity_log", '''
        CREATE TABLE "activity_log" (
            "id" TEXT PRIMARY KEY,
            "employee_id" TEXT REFERENCES "employees"("id"),
            "action" TEXT NOT NULL,
            "entity_type" TEXT,
            "entity_id" TEXT,
            "details" TEXT,
            "ip_address" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    # Add new columns to stores
    add_column(cursor, "stores", "fb_profile_id",
        'ALTER TABLE "stores" ADD COLUMN "fb_profile_id" TEXT')
    add_column(cursor, "stores", "product_count",
        'ALTER TABLE "stores" ADD COLUMN "product_count" INTEGER DEFAULT 0')
    add_column(cursor, "stores", "assigned_employees",
        'ALTER TABLE "stores" ADD COLUMN "assigned_employees" TEXT DEFAULT \'[]\'')
    add_column(cursor, "stores", "auto_sync",
        'ALTER TABLE "stores" ADD COLUMN "auto_sync" INTEGER NOT NULL DEFAULT 1')
    add_column(cursor, "stores", "last_synced_at",
        'ALTER TABLE "stores" ADD COLUMN "last_synced_at" TEXT')
    add_column(cursor, "stores", "sync_start_date",
        'ALTER TABLE "stores" ADD COLUMN "sync_start_date" TEXT')

    # Shopify API access token
    add_column(cursor, "stores", "shopify_access_token",
        'ALTER TABLE "stores" ADD COLUMN "shopify_access_token" TEXT')

    # ShipSourced billing stats
    add_column(cursor, "stores", "ss_charges_pending_cents",
        'ALTER TABLE "stores" ADD COLUMN "ss_charges_pending_cents" INTEGER DEFAULT 0')
    add_column(cursor, "stores", "ss_total_paid_cents",
        'ALTER TABLE "stores" ADD COLUMN "ss_total_paid_cents" INTEGER DEFAULT 0')
    add_column(cursor, "stores", "ss_net_owed_cents",
        'ALTER TABLE "stores" ADD COLUMN "ss_net_owed_cents" INTEGER DEFAULT 0')

    # Ad-level columns on ad_spend
    add_column(cursor, "ad_spend", "ad_id",
        'ALTER TABLE "ad_spend" ADD COLUMN "ad_id" TEXT')
    add_column(cursor, "ad_spend", "ad_name",
        'ALTER TABLE "ad_spend" ADD COLUMN "ad_name" TEXT')
    add_column(cursor, "ad_spend", "creative_url",
        'ALTER TABLE "ad_spend" ADD COLUMN "creative_url" TEXT')
    add_column(cursor, "ad_spend", "ad_status",
        'ALTER TABLE "ad_spend" ADD COLUMN "ad_status" TEXT')
    # Full creative context columns
    add_column(cursor, "ad_spend", "ad_headline",
        'ALTER TABLE "ad_spend" ADD COLUMN "ad_headline" TEXT')
    add_column(cursor, "ad_spend", "ad_body",
        'ALTER TABLE "ad_spend" ADD COLUMN "ad_body" TEXT')
    add_column(cursor, "ad_spend", "ad_cta",
        'ALTER TABLE "ad_spend" ADD COLUMN "ad_cta" TEXT')
    add_column(cursor, "ad_spend", "ad_link_url",
        'ALTER TABLE "ad_spend" ADD COLUMN "ad_link_url" TEXT')
    add_column(cursor, "ad_spend", "ad_preview_url",
        'ALTER TABLE "ad_spend" ADD COLUMN "ad_preview_url" TEXT')
    # Extended metrics
    add_column(cursor, "ad_spend", "reach",
        'ALTER TABLE "ad_spend" ADD COLUMN "reach" INTEGER DEFAULT 0')
    add_column(cursor, "ad_spend", "frequency",
        'ALTER TABLE "ad_spend" ADD COLUMN "frequency" REAL DEFAULT 0')
    add_column(cursor, "ad_spend", "cpm",
        'ALTER TABLE "ad_spend" ADD COLUMN "cpm" REAL DEFAULT 0')
    add_column(cursor, "ad_spend", "cpc",
        'ALTER TABLE "ad_spend" ADD COLUMN "cpc" REAL DEFAULT 0')
    add_column(cursor, "ad_spend", "ctr",
        'ALTER TABLE "ad_spend" ADD COLUMN "ctr" REAL DEFAULT 0')

    # NanoBanana / angle columns on creatives
    add_column(cursor, "creatives", "angle",
        'ALTER TABLE "creatives" ADD COLUMN "angle" TEXT')
    add_column(cursor, "creatives", "nb_video_id",
        'ALTER TABLE "creatives" ADD COLUMN "nb_video_id" TEXT')
    add_column(cursor, "creatives", "nb_status",
        'ALTER TABLE "creatives" ADD COLUMN "nb_status" TEXT')

    # Batch columns on creatives
    add_column(cursor, "creatives", "batch_id",
        'ALTER TABLE "creatives" ADD COLUMN "batch_id" TEXT')
    add_column(cursor, "creatives", "batch_index",
        'ALTER TABLE "creatives" ADD COLUMN "batch_index" INTEGER')

    # Creative batches table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS "creative_batches" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "product_id" TEXT REFERENCES "products"("id"),
            "batch_number" INTEGER NOT NULL DEFAULT 1,
            "name" TEXT NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'pending',
            "parent_batch_id" TEXT,
            "product_context" TEXT,
            "offer" TEXT,
            "winning_angles" TEXT,
            "source_ad_ids" TEXT,
            "video_prompts" TEXT,
            "image_prompts" TEXT,
            "total_videos" INTEGER NOT NULL DEFAULT 5,
            "total_images" INTEGER NOT NULL DEFAULT 5,
            "completed_videos" INTEGER NOT NULL DEFAULT 0,
            "completed_images" INTEGER NOT NULL DEFAULT 0,
            "failed_count" INTEGER NOT NULL DEFAULT 0,
            "total_spend_cents" INTEGER DEFAULT 0,
            "total_purchases" INTEGER DEFAULT 0,
            "total_revenue_cents" INTEGER DEFAULT 0,
            "avg_roas" REAL DEFAULT 0,
            "winner_count" INTEGER DEFAULT 0,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')
    print("  creative_batches table ensured")

    # Product images — JSON array of all image URLs
    add_column(cursor, "products", "images",
        'ALTER TABLE "products" ADD COLUMN "images" TEXT')

    add_column(cursor, "products", "description",
        'ALTER TABLE "products" ADD COLUMN "description" TEXT')

    # Add expiry columns to payment_cards
    add_column(cursor, "payment_cards", "expiry_month",
        'ALTER TABLE "payment_cards" ADD COLUMN "expiry_month" INTEGER')
    add_column(cursor, "payment_cards", "expiry_year",
        'ALTER TABLE "payment_cards" ADD COLUMN "expiry_year" INTEGER')
    add_column(cursor, "payment_cards", "notes",
        'ALTER TABLE "payment_cards" ADD COLUMN "notes" TEXT')

    print("\n--- Indexes ---")

    create_index(cursor, "idx_daily_pnl_store_date",
        'CREATE INDEX "idx_daily_pnl_store_date" ON "daily_pnl"("store_id", "date")')
    create_index(cursor, "idx_ad_spend_store_date",
        'CREATE INDEX "idx_ad_spend_store_date" ON "ad_spend"("store_id", "date")')
    create_index(cursor, "idx_card_assignments_card",
        'CREATE INDEX "idx_card_assignments_card" ON "card_assignments"("card_id")')
    create_index(cursor, "idx_sync_log_type",
        'CREATE INDEX "idx_sync_log_type" ON "sync_log"("sync_type", "started_at")')
    create_index(cursor, "idx_products_store",
        'CREATE INDEX "idx_products_store" ON "products"("store_id")')
    create_index(cursor, "idx_products_sku",
        'CREATE INDEX "idx_products_sku" ON "products"("sku")')
    create_index(cursor, "idx_creatives_store",
        'CREATE INDEX "idx_creatives_store" ON "creatives"("store_id")')
    create_index(cursor, "idx_fb_profiles_store",
        'CREATE INDEX "idx_fb_profiles_store" ON "fb_profiles"("store_id")')
    create_index(cursor, "idx_fb_campaigns_store",
        'CREATE INDEX "idx_fb_campaigns_store" ON "fb_campaigns"("store_id")')
    create_index(cursor, "idx_employee_store_access",
        'CREATE INDEX "idx_employee_store_access" ON "employee_store_access"("employee_id")')
    create_index(cursor, "idx_card_payments_log_store",
        'CREATE INDEX "idx_card_payments_log_store" ON "card_payments_log"("store_id", "card_last4")')
    create_index(cursor, "idx_ad_payments_store_date",
        'CREATE INDEX "idx_ad_payments_store_date" ON "ad_payments"("store_id", "date")')
    create_index(cursor, "idx_ad_payments_card",
        'CREATE INDEX "idx_ad_payments_card" ON "ad_payments"("card_last4")')
    create_index(cursor, "idx_ad_payments_txn",
        'CREATE INDEX "idx_ad_payments_txn" ON "ad_payments"("transaction_id")')
    create_index(cursor, "idx_activity_log_employee",
        'CREATE INDEX "idx_activity_log_employee" ON "activity_log"("employee_id", "created_at")')
    create_index(cursor, "idx_ad_spend_ad_id",
        'CREATE INDEX "idx_ad_spend_ad_id" ON "ad_spend"("ad_id")')
    create_index(cursor, "idx_ad_spend_adset",
        'CREATE INDEX "idx_ad_spend_adset" ON "ad_spend"("ad_set_id")')
    create_index(cursor, "idx_creative_batches_store",
        'CREATE INDEX "idx_creative_batches_store" ON "creative_batches"("store_id")')
    create_index(cursor, "idx_creatives_batch",
        'CREATE INDEX "idx_creatives_batch" ON "creatives"("batch_id")')

    # ── Twelve Labs video analysis ──
    add_column(cursor, "ad_spend", "video_analysis",
        'ALTER TABLE "ad_spend" ADD COLUMN "video_analysis" TEXT')
    add_column(cursor, "ad_spend", "tl_video_id",
        'ALTER TABLE "ad_spend" ADD COLUMN "tl_video_id" TEXT')
    add_column(cursor, "ad_spend", "fb_video_id",
        'ALTER TABLE "ad_spend" ADD COLUMN "fb_video_id" TEXT')
    add_column(cursor, "ad_spend", "video_source_url",
        'ALTER TABLE "ad_spend" ADD COLUMN "video_source_url" TEXT')

    create_table(cursor, "video_analyses", '''
        CREATE TABLE IF NOT EXISTS "video_analyses" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL,
            "ad_id" TEXT,
            "video_url" TEXT NOT NULL,
            "tl_video_id" TEXT,
            "tl_index_id" TEXT,
            "analysis" TEXT,
            "status" TEXT DEFAULT 'pending',
            "created_at" TEXT DEFAULT (datetime('now')),
            "updated_at" TEXT DEFAULT (datetime('now')),
            FOREIGN KEY ("store_id") REFERENCES "stores"("id")
        )
    ''')

    # ── Orders table ──
    print("\n--- Orders ---")

    create_table(cursor, "orders", '''
        CREATE TABLE "orders" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "order_number" TEXT NOT NULL,
            "order_name" TEXT NOT NULL,
            "created_at_shopify" TEXT NOT NULL,
            "order_date" TEXT NOT NULL,
            "financial_status" TEXT,
            "fulfillment_status" TEXT,
            "total_cents" INTEGER NOT NULL DEFAULT 0,
            "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
            "shipping_cents" INTEGER NOT NULL DEFAULT 0,
            "taxes_cents" INTEGER NOT NULL DEFAULT 0,
            "discount_cents" INTEGER NOT NULL DEFAULT 0,
            "refunded_cents" INTEGER NOT NULL DEFAULT 0,
            "net_revenue_cents" INTEGER NOT NULL DEFAULT 0,
            "line_items" TEXT,
            "line_item_count" INTEGER NOT NULL DEFAULT 0,
            "customer_email" TEXT,
            "currency" TEXT DEFAULT 'USD',
            "source" TEXT DEFAULT 'csv_import',
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE("store_id", "order_number")
        )
    ''')

    # ShipSourced charge per order
    add_column(cursor, "orders", "ss_charge_cents",
        'ALTER TABLE "orders" ADD COLUMN "ss_charge_cents" INTEGER DEFAULT 0')
    add_column(cursor, "orders", "ss_charge_is_estimate",
        'ALTER TABLE "orders" ADD COLUMN "ss_charge_is_estimate" INTEGER DEFAULT 0')

    create_index(cursor, "idx_products_store_sku",
        'CREATE UNIQUE INDEX "idx_products_store_sku" ON "products"("store_id", "sku") WHERE "sku" IS NOT NULL AND "sku" != \'\'')

    create_index(cursor, "idx_orders_store_date",
        'CREATE INDEX "idx_orders_store_date" ON "orders"("store_id", "order_date")')
    create_index(cursor, "idx_orders_store_number",
        'CREATE INDEX "idx_orders_store_number" ON "orders"("store_id", "order_number")')

    # --- sku_pricing table ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS "sku_pricing" (
        "id" TEXT PRIMARY KEY,
        "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
        "sku" TEXT NOT NULL,
        "label" TEXT,
        "base_charge_cents" INTEGER NOT NULL DEFAULT 0,
        "extra_unit_charge_cents" INTEGER NOT NULL DEFAULT 0,
        "extra_unit_after" INTEGER NOT NULL DEFAULT 1,
        "effective_from" TEXT NOT NULL,
        "effective_to" TEXT,
        "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
        "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
    )''')
    create_index(cursor, "idx_sku_pricing_store",
        'CREATE INDEX "idx_sku_pricing_store" ON "sku_pricing"("store_id", "sku")')

    # --- Shopify invoices ---
    print("\n--- Shopify Invoices ---")

    create_table(cursor, "shopify_invoices", '''
        CREATE TABLE "shopify_invoices" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "bill_number" TEXT NOT NULL,
            "date" TEXT NOT NULL,
            "total_cents" INTEGER NOT NULL DEFAULT 0,
            "item_count" INTEGER NOT NULL DEFAULT 0,
            "currency" TEXT NOT NULL DEFAULT 'USD',
            "payment_method" TEXT,
            "card_last4" TEXT,
            "paid" INTEGER NOT NULL DEFAULT 0,
            "paid_date" TEXT,
            "notes" TEXT,
            "source" TEXT DEFAULT 'shopify',
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE("store_id", "bill_number")
        )
    ''')

    create_table(cursor, "shopify_invoice_items", '''
        CREATE TABLE "shopify_invoice_items" (
            "id" TEXT PRIMARY KEY,
            "invoice_id" TEXT NOT NULL REFERENCES "shopify_invoices"("id") ON DELETE CASCADE,
            "category" TEXT NOT NULL,
            "description" TEXT,
            "app_name" TEXT,
            "amount_cents" INTEGER NOT NULL DEFAULT 0,
            "currency" TEXT DEFAULT 'USD',
            "billing_start" TEXT,
            "billing_end" TEXT
        )
    ''')

    create_index(cursor, "idx_shopify_invoices_store",
        'CREATE INDEX "idx_shopify_invoices_store" ON "shopify_invoices"("store_id", "date")')
    create_index(cursor, "idx_shopify_invoice_items_invoice",
        'CREATE INDEX "idx_shopify_invoice_items_invoice" ON "shopify_invoice_items"("invoice_id")')

    # --- Chargeflow & Chargebacks ---
    print("\n--- Chargeflow & Chargebacks ---")

    add_column(cursor, "stores", "chargeflow_api_key",
        'ALTER TABLE "stores" ADD COLUMN "chargeflow_api_key" TEXT')

    add_column(cursor, "daily_pnl", "chargeback_cents",
        'ALTER TABLE "daily_pnl" ADD COLUMN "chargeback_cents" INTEGER DEFAULT 0')

    add_column(cursor, "daily_pnl", "app_costs_cents",
        'ALTER TABLE "daily_pnl" ADD COLUMN "app_costs_cents" INTEGER DEFAULT 0')

    create_table(cursor, "chargebacks", '''
        CREATE TABLE "chargebacks" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "order_number" TEXT,
            "dispute_id" TEXT,
            "chargeback_date" TEXT NOT NULL,
            "amount_cents" INTEGER NOT NULL DEFAULT 0,
            "currency" TEXT DEFAULT 'USD',
            "reason" TEXT,
            "status" TEXT DEFAULT 'open',
            "chargeflow_fee_cents" INTEGER DEFAULT 0,
            "source" TEXT DEFAULT 'manual',
            "notes" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    create_index(cursor, "idx_chargebacks_store_date",
        'CREATE INDEX "idx_chargebacks_store_date" ON "chargebacks"("store_id", "chargeback_date")')

    add_column(cursor, "stores", "invoices_verified",
        'ALTER TABLE "stores" ADD COLUMN "invoices_verified" INTEGER DEFAULT 0')

    create_table(cursor, "saved_payment_methods", '''
        CREATE TABLE "saved_payment_methods" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "label" TEXT NOT NULL,
            "type" TEXT DEFAULT 'other',
            "card_last4" TEXT,
            "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE("store_id", "label")
        )
    ''')

    # ShipSourced payments tracking
    create_table(cursor, "ss_payments", '''
        CREATE TABLE "ss_payments" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "amount_cents" INTEGER NOT NULL,
            "date" TEXT NOT NULL,
            "note" TEXT,
            "source" TEXT NOT NULL DEFAULT 'manual',
            "external_id" TEXT,
            "created_at" TEXT DEFAULT (datetime('now'))
        )
    ''')
    create_index(cursor, "idx_ss_payments_store",
        'CREATE INDEX "idx_ss_payments_store" ON "ss_payments"("store_id")')

    # Inventory purchases tracking
    create_table(cursor, "inventory_purchases", '''
        CREATE TABLE "inventory_purchases" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "sku" TEXT,
            "product_name" TEXT NOT NULL,
            "qty_purchased" INTEGER NOT NULL,
            "cost_per_unit_cents" INTEGER NOT NULL,
            "total_cost_cents" INTEGER NOT NULL,
            "purchase_date" TEXT NOT NULL,
            "supplier" TEXT,
            "note" TEXT,
            "created_at" TEXT DEFAULT (datetime('now'))
        )
    ''')
    create_index(cursor, "idx_inv_purchases_store",
        'CREATE INDEX "idx_inv_purchases_store" ON "inventory_purchases"("store_id")')
    create_index(cursor, "idx_inv_purchases_sku",
        'CREATE INDEX "idx_inv_purchases_sku" ON "inventory_purchases"("store_id", "sku")')

    # Bank accounts (Teller integration)
    create_table(cursor, "bank_accounts", '''
        CREATE TABLE "bank_accounts" (
            "id" TEXT PRIMARY KEY,
            "store_id" TEXT NOT NULL REFERENCES "stores"("id"),
            "teller_enrollment_id" TEXT,
            "teller_account_id" TEXT UNIQUE,
            "access_token" TEXT,
            "institution_name" TEXT,
            "account_name" TEXT,
            "account_type" TEXT,
            "account_subtype" TEXT,
            "last_four" TEXT,
            "currency" TEXT DEFAULT 'USD',
            "balance_available_cents" INTEGER,
            "balance_ledger_cents" INTEGER,
            "balance_updated_at" TEXT,
            "status" TEXT DEFAULT 'active',
            "created_at" TEXT DEFAULT (datetime('now')),
            "updated_at" TEXT DEFAULT (datetime('now'))
        )
    ''')
    create_index(cursor, "idx_bank_accounts_store",
        'CREATE INDEX "idx_bank_accounts_store" ON "bank_accounts"("store_id")')

    create_table(cursor, "bank_transactions", '''
        CREATE TABLE "bank_transactions" (
            "id" TEXT PRIMARY KEY,
            "bank_account_id" TEXT NOT NULL REFERENCES "bank_accounts"("id"),
            "teller_transaction_id" TEXT UNIQUE,
            "date" TEXT NOT NULL,
            "description" TEXT,
            "category" TEXT,
            "amount_cents" INTEGER NOT NULL,
            "type" TEXT,
            "status" TEXT,
            "counterparty" TEXT,
            "running_balance_cents" INTEGER,
            "created_at" TEXT DEFAULT (datetime('now'))
        )
    ''')
    create_index(cursor, "idx_bank_txns_account",
        'CREATE INDEX "idx_bank_txns_account" ON "bank_transactions"("bank_account_id")')
    create_index(cursor, "idx_bank_txns_date",
        'CREATE INDEX "idx_bank_txns_date" ON "bank_transactions"("bank_account_id", "date")')

    # Separate ad vs app card payments
    add_column(cursor, "card_payments_log", "category",
        'ALTER TABLE "card_payments_log" ADD COLUMN "category" TEXT DEFAULT \'ad\'')

    # Store platform (shopify, amazon)
    add_column(cursor, "stores", "platform",
        'ALTER TABLE "stores" ADD COLUMN "platform" TEXT DEFAULT \'shopify\'')

    conn.commit()
    conn.close()
    print("\n=== Migration complete! ===\n")

if __name__ == "__main__":
    main()
