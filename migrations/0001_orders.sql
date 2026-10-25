-- Orders table for the admin Orders Dashboard.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  idem_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('new','confirmed','completed','cancelled')),
  type TEXT NOT NULL CHECK(type IN ('delivery','pickup','dinein')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT,
  customer_table TEXT,
  notes TEXT,
  items_json TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  lang TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
