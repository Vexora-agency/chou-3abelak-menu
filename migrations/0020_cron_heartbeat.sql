-- 0020: Cron heartbeat for the 1-minute external order-nag sweep.
-- One row per cron service. The sweep writes `started` on entry and
-- `success` (+ duration + result counts) at the end of every pass, so the
-- admin dashboard can tell "cron dead" (stale started) apart from
-- "started but crashed mid-run" (fresh started, stale success).
-- D1, NOT KV: a per-minute KV write would burn 1,440 of the 1,000/day
-- free writes by itself; D1 allows 100k writes/day.
CREATE TABLE IF NOT EXISTS cron_heartbeat (
  service TEXT PRIMARY KEY,
  last_started_at TEXT,
  last_success_at TEXT,
  last_duration_ms INTEGER,
  runs INTEGER NOT NULL DEFAULT 0,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_result TEXT
);
