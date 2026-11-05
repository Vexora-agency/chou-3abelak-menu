-- 0027: atomic order rate-limit counters (fixes KV read-modify-write race).
--
-- POST /api/orders used to check-then-increment a KV counter in waitUntil,
-- AFTER the insert: parallel bursts from one IP all read the old value and
-- slipped past the 15-orders/10-min cap. This table makes check+reserve a
-- SINGLE atomic UPSERT (see checkAndReserveOrderBudget in
-- functions/_shared/repositories/orders.repo.js), so the cap holds even
-- when requests arrive on different isolates at the same instant.
--
-- Rows: one per rate-limit key (`order:ip:<ip>`). Expired windows are reset
-- in place by the same UPSERT, so the table never grows past the distinct
-- key count; each row is a few dozen bytes (D1 free tier: 5 GB).
CREATE TABLE IF NOT EXISTS rate_counters (
  "key" TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_reset INTEGER NOT NULL
);
