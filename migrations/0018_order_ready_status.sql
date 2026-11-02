-- Order ready state: kitchen finished, awaiting handoff (out for delivery /
-- ready for pickup). Flow becomes new -> confirmed -> ready -> completed,
-- with cancelled from new/confirmed/ready. SQLite needs a table rebuild to
-- widen a CHECK; data is copied verbatim (same 0004 pattern). Full column
-- set as of 0017 (base 0001 + nullable PII 0004 + 0005 location/phone_norm
-- + 0009 track_token + 0013 sent_via).
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

CREATE TABLE orders_new (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  idem_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('new','confirmed','ready','completed','cancelled')),
  type TEXT NOT NULL CHECK(type IN ('delivery','pickup','dinein')),
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  customer_table TEXT,
  notes TEXT,
  items_json TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  lang TEXT,
  pii_purged_at TEXT,
  location_lat REAL,
  location_lng REAL,
  phone_norm TEXT,
  track_token TEXT,
  sent_via TEXT
);

INSERT INTO orders_new
  SELECT id, number, idem_key, created_at, updated_at, status, type,
    customer_name, customer_phone, customer_address, customer_table,
    notes, items_json, subtotal, delivery_fee, total, lang, pii_purged_at,
    location_lat, location_lng, phone_norm, track_token, sent_via
  FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
