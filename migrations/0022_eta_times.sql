-- 0022: Smart ETA + receive-unlock timestamps.
-- confirmed_at: when the kitchen confirmed the order (the new -> confirmed
-- flip, via updateOrderStatus — the single choke point for the dashboard
-- PATCH route AND Telegram callbacks, so both paths stamp).
-- eta_at: computed ready/delivery estimate (ISO) stamped alongside.
-- Nullable, no backfill: legacy rows keep NULL and the code treats NULL
-- safely (receive unlock falls back to created_at + delay — never traps
-- old orders; the track response echoes null ETA until re-confirmed).
ALTER TABLE orders ADD COLUMN confirmed_at TEXT;
ALTER TABLE orders ADD COLUMN eta_at TEXT;
