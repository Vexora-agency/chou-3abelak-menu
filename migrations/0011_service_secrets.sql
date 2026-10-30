-- 0011: service secrets (non-dashboard credentials).
-- CRON dashboard secrets can't be viewed after being set, so the order-nag
-- trigger uses its own D1-stored bearer secret: generated once, shown once
-- to the owner, pasted into the external 1-minute cron job. Revoke by
-- deleting the row (endpoint then 404s everything).
CREATE TABLE IF NOT EXISTS service_secrets (
  key TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);
