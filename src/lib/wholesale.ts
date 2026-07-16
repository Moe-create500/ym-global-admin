// Wholesale requests table — shared by the public submit route and the desk API.
import type Database from 'better-sqlite3';

export function ensureWholesaleTable(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS wholesale_requests (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    business_name TEXT,
    contact_name TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    items_json TEXT NOT NULL,          -- [{title, qty}]
    total_tubs INTEGER NOT NULL,
    delivery_method TEXT NOT NULL,     -- ups | freight | pickup
    pickup_slot TEXT,                  -- e.g. "2026-07-18 11:00"
    address TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'new', -- new | quoted | invoiced | paid | fulfilled | cancelled
    freight_quote_cents INTEGER,
    shipping_cents INTEGER,
    draft_order_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
}
