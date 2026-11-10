-- 0029: last status actor for the orders feed (nullable, no backfill).
-- updated_by: username that made the last status change (kitchen/client
-- login name from the session sub `client:<username>`).
-- Owner changes clear it to NULL so Recent orders shows nothing extra;
-- legacy rows keep NULL and read as "no actor" (mapOrderRow -> null).
ALTER TABLE orders ADD COLUMN updated_by TEXT;
