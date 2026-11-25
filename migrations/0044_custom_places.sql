-- 0044: owner-curated delivery places (areas & landmarks).
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote
--
-- custom_places: names customers actually use ("دوار كذا", "جنب فرن فلان")
-- with the exact pin the owner dropped. Served first in address
-- autocomplete, above every provider pass. No customer data here —
-- only owner-entered public names and coordinates.
CREATE TABLE IF NOT EXISTS custom_places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'landmark',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_custom_places_names ON custom_places(name_ar, name_en);
