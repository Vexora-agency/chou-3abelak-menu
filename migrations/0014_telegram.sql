-- 0014: Telegram owner notifications — Phase 2+3 (pairing + webhook only).
-- Single-restaurant project: the LINK itself lives in service_config
-- (key 'telegram': {"chat_id":...,"linked_at":"...","bot_username":"..."}),
-- same pattern as the WhatsApp config (migration 0012). No business_id
-- column exists anywhere in this schema, so none is introduced here.
--
-- Two tables:
--   1. telegram_pairing_codes — one-time /start codes. Only SHA-256(code)
--      is stored, never the raw code (same rule as invite tokens in
--      access.js). 10-minute TTL, atomic single-use consume
--      (UPDATE ... WHERE used_at IS NULL AND expires_at > now).
--   2. telegram_notifications — Phase 4 delivery ledger (created now so the
--      schema ships once). order_id PK doubles as the dedupe key:
--      a repeated order event reuses the row instead of re-sending.
--      Exactly-once is NOT promised over HTTPS (Telegram may ACK-loss);
--      the ledger gives at-least-once with idempotent retries.
--
-- Bot credentials are Cloudflare Pages secrets (TELEGRAM_BOT_TOKEN,
-- TELEGRAM_WEBHOOK_SECRET) — never stored in D1, KV, or source control.
-- Apply local:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote: npx wrangler d1 migrations apply ORDERS_DB --remote

CREATE TABLE IF NOT EXISTS telegram_pairing_codes (
  code_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  consumed_by_chat TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_pairing_expires
  ON telegram_pairing_codes(expires_at);

CREATE TABLE IF NOT EXISTS telegram_notifications (
  order_id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_notifications_status
  ON telegram_notifications(status);
