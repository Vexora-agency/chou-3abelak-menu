-- 0038_whatsapp_webhook.sql
-- Inbound WhatsApp Cloud API webhook ledger.
--
-- Meta delivers each inbound message with a unique `messages[].id` and may
-- retry the webhook. The primary key makes duplicate deliveries a no-op, and
-- the indexed timestamps power the reply rate limits that keep automatic
-- verification inside the 1,000 free service messages per business number per
-- month (Meta pricing from Oct 1, 2026).
--
-- `outcome`: processing | verified | wrong_code | expired | no_request |
--            missing_code | already_verified | ignored | no_secret
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  message_id TEXT PRIMARY KEY,
  phone TEXT,
  outcome TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_phone
  ON whatsapp_webhook_events(phone, received_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_received
  ON whatsapp_webhook_events(received_at);
