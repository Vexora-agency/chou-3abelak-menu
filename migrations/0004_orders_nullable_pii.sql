-- Retention purge NULLs the PII columns, so customer_name / customer_phone
-- must be nullable (they were NOT NULL in 0001). SQLite needs a table
-- rebuild to drop NOT NULL. Data is copied verbatim, constraints kept.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

CREATE TABLE orders_new (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  idem_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('new','confirmed','completed','cancelled')),
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
  pii_purged_at TEXT
);

INSERT INTO orders_new
  SELECT id, number, idem_key, created_at, updated_at, status, type,
    customer_name, customer_phone, customer_address, customer_table,
    notes, items_json, subtotal, delivery_fee, total, lang, pii_purged_at
  FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
