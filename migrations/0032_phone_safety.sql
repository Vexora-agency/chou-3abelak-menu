-- 0032: fake-order protection — phone blocklist + order risk score.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote
--
-- phone_blocks: owner-managed blocklist keyed by digits-only phone_norm
-- (same normalization as orders.phone_norm). A blocked phone is rejected
-- at POST /api/orders with a generic 403 (never reveals the block).
-- Admin CRUD lives in functions/api/admin/phone-blocks.js.
-- No backfill — starts empty, every phone allowed until blocked.
CREATE TABLE IF NOT EXISTS phone_blocks (
  phone_norm TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL
);

-- Risk score stored at insert (never recomputed): the release sweep renders
-- the Telegram review line from these columns, and the admin feed reads them
-- via mapOrderRow (riskScore/riskReasons/needsReview). Defaults keep legacy
-- rows readable (0 / '[]' / false) without a backfill.
ALTER TABLE orders ADD COLUMN risk_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN risk_reasons TEXT NOT NULL DEFAULT '[]';

-- Per-phone abuse lookups (active-order cap + 24h/7d history for scoring).
CREATE INDEX IF NOT EXISTS idx_orders_phone_status ON orders(phone_norm, status);
CREATE INDEX IF NOT EXISTS idx_orders_phone_created ON orders(phone_norm, created_at);
