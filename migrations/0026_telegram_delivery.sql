-- 0026: Telegram delivery-crew sharing — multi-chat fan-out.
-- Owner link stays in service_config (key 'telegram', migration 0014 pattern,
-- untouched). Delivery crew get their own rows here:
--   1. telegram_chats — linked delivery chats (role defaults to 'delivery';
--      owner never lives here — owner stays in service_config).
--   2. telegram_order_chats — per-order delivery copies (order_id, chat_id)
--      PK: message_id/message_text let sync stamp the SAME banner+keyboard
--      edits on every copy (no admin-url row on delivery keyboards).
--   3. telegram_pairing_codes.role — 'owner' (default, legacy rows) or
--      'delivery' (crew codes issued from the dashboard delivery-code action).
-- Purely additive (new tables + one nullable-with-default column). Old rows
-- keep working (role defaults to 'owner', no backfill needed).
-- Apply local:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote: npx wrangler d1 migrations apply ORDERS_DB --remote

CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id INTEGER PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'delivery',
  label TEXT,
  linked_at TEXT,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS telegram_order_chats (
  order_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  message_id INTEGER,
  message_text TEXT,
  status TEXT,
  PRIMARY KEY (order_id, chat_id)
);

ALTER TABLE telegram_pairing_codes ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';
