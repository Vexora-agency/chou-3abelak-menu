-- 0019: Order release marker for the kitchen grace period.
-- New orders stay hidden from admin surfaces (dashboard, Telegram, push)
-- for ORDER_GRACE_MS (5 min) so the customer can self-cancel first.
-- The 1-minute order-nag sweep "releases" due orders (sets released_at,
-- sends the Telegram message + web push, exactly once via atomic claim).
-- Backfill: every pre-existing row was notified under the old immediate
-- behavior, so it counts as already released.
ALTER TABLE orders ADD COLUMN released_at TEXT;
UPDATE orders SET released_at = created_at WHERE released_at IS NULL;
