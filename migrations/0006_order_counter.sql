-- Atomic order-number counter (replaces MAX(number)+1 read-modify-write).
-- nextOrderNumber() does UPDATE ... RETURNING in ONE statement, so concurrent
-- inserts can never collide (previously: one retry, then 503 under races).
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

CREATE TABLE IF NOT EXISTS order_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_number INTEGER NOT NULL DEFAULT 1000
);

-- Fresh DBs start at 1000 (first order = 1001, same as the old MAX fallback).
INSERT OR IGNORE INTO order_counter (id, last_number) VALUES (1, 1000);

-- Existing DBs: fast-forward past any order numbers already issued, so the
-- counter never reuses a number after this migration runs.
UPDATE order_counter
SET last_number = (SELECT COALESCE(MAX(number), 1000) FROM orders)
WHERE id = 1
  AND last_number < (SELECT COALESCE(MAX(number), 1000) FROM orders);
