/**
 * Own SQLite store for the Receipts module.
 *
 * This is intentionally separate from yuvomi.db — per MODULES.md, a module
 * with a backend service keeps its own state in its own database and reads/
 * writes Yuvomi's data only through /api/v1. Nothing here is Yuvomi core.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || './data';
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'images'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'receipt-tracker.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    created_by        INTEGER NOT NULL,   -- Yuvomi user id (from /api/v1/auth/me), not a foreign key: yuvomi.db is not ours to join against
    merchant          TEXT    NOT NULL,
    purchase_date     TEXT    NOT NULL,   -- YYYY-MM-DD
    tax               REAL    NOT NULL DEFAULT 0,
    tip               REAL    NOT NULL DEFAULT 0,
    total             REAL    NOT NULL,
    image_path        TEXT,
    provider          TEXT,
    model             TEXT,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS receipt_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id        INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    raw_name          TEXT    NOT NULL,   -- exactly what the vision model read off the receipt
    canonical_label   TEXT,               -- optional normalized name assigned on review, e.g. "Milk" for 6 different OCR spellings
    description       TEXT,
    quantity          REAL    NOT NULL DEFAULT 1,
    unit_price        REAL,
    total_price       REAL    NOT NULL,
    category          TEXT    NOT NULL DEFAULT 'Other'
  );

  CREATE INDEX IF NOT EXISTS idx_receipts_date      ON receipts(purchase_date);
  CREATE INDEX IF NOT EXISTS idx_receipts_merchant   ON receipts(merchant);
  CREATE INDEX IF NOT EXISTS idx_receipts_created_by ON receipts(created_by);
  CREATE INDEX IF NOT EXISTS idx_items_receipt       ON receipt_items(receipt_id);
  CREATE INDEX IF NOT EXISTS idx_items_category      ON receipt_items(category);
  CREATE INDEX IF NOT EXISTS idx_items_canonical     ON receipt_items(canonical_label);
  CREATE INDEX IF NOT EXISTS idx_items_raw_name      ON receipt_items(raw_name);

  -- Maps a raw merchant string (as it appears on receipts.merchant) to a
  -- shared brand/group name, e.g. "ShopRite of Bayonne" and "ShopRite of
  -- Metro Plaza" both -> "ShopRite". A merchant with no row here is its own
  -- group (falls back to the raw name wherever this is joined). Editable
  -- from the Tracking page; also written in bulk by the AI reclassify pass.
  CREATE TABLE IF NOT EXISTS merchant_groups (
    merchant   TEXT PRIMARY KEY,
    group_name TEXT NOT NULL
  );
`);

// Seed the category list the vision prompt itself classifies into (see
// providers/schema.js) — matches what the household's real export (2026
// spending sheet) actually used, plus Entertainment which the prompt
// supports but their data never happened to need yet. Free text, not an
// enum — a household can add more from the review form.
const DEFAULT_CATEGORIES = ['Grocery', 'Dining', 'Utilities', 'Entertainment', 'Supplies', 'Shopping', 'Other'];
const seedCategories = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('categories', ?)`);
seedCategories.run(JSON.stringify(DEFAULT_CATEGORIES));

export function get() {
  return db;
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export default db;
