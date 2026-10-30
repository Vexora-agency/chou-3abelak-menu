-- 0012: WhatsApp Cloud API service config (NOT in menu KV on purpose:
-- a menu wipe must never silently kill order delivery, and infra IDs stay
-- out of the public /api/menu payload). Secrets (token) live in
-- service_secrets; non-secret config lives here. Both admin-only.
CREATE TABLE IF NOT EXISTS service_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
