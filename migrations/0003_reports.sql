-- Monthly reporting + data retention.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

-- PII purge marker for retention (customer columns are NULLed, never the row).
ALTER TABLE orders ADD COLUMN pii_purged_at TEXT;

-- Report settings: exactly one row (id = 1), written by the admin API.
CREATE TABLE IF NOT EXISTS report_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','ar')),
  verify_token_hash TEXT,
  verify_expires_at TEXT,
  updated_at TEXT
);

-- One row per reported month ('YYYY-MM'). A row must exist before any order
-- of that month may be purged or deleted (hard retention rule).
CREATE TABLE IF NOT EXISTS monthly_reports (
  month TEXT PRIMARY KEY,
  summary_json TEXT NOT NULL,
  csv_key TEXT,
  generated_at TEXT,
  emailed_at TEXT,
  email_status TEXT,
  email_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_monthly_reports_emailed ON monthly_reports(emailed_at);
