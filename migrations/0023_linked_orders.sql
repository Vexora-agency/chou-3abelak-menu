-- 0023: Linked / follow-up orders (same customer, 5-15 min window).
-- parent_number: the earlier order this order follows (NULL = standalone).
-- No backfill: legacy rows keep NULL and the code treats NULL as unlinked.
-- Also restores idx_orders_phone_norm (dropped by the 0018 table rebuild and
-- never re-created) — the link lookup matches on phone_norm and needs it.
ALTER TABLE orders ADD COLUMN parent_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_orders_phone_norm ON orders(phone_norm);
CREATE INDEX IF NOT EXISTS idx_orders_parent_number ON orders(parent_number);
