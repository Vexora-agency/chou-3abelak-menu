-- 0034_orders_customer_link.sql
-- Link an order to the Better Auth customer account that placed it.
-- Nullable: guest orders and all existing rows stay NULL (no backfill).
-- The value is always written from the server-side session, never the client.
ALTER TABLE orders ADD COLUMN customer_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_customer_user_id
  ON orders(customer_user_id, created_at DESC);
