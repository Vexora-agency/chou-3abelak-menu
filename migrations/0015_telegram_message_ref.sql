-- 0015: Telegram two-way sync — remember WHERE each notification went so a
-- dashboard status change can stamp the SAME Telegram message (two-way sync
-- with the Confirm/Cancel/Received buttons).
--   chat_id / message_id : address of the sent order message (Bot API
--     editMessage* targets). NULL for rows sent before this migration —
--     those messages simply can't be edited (sync skips them, no error).
--   message_text : the exact HTML text that was sent, so the sync can
--     re-stamp it (append status banner) without refetching anything.
-- Purely additive (new nullable columns only). Old rows keep working.
-- Apply local:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote: npx wrangler d1 migrations apply ORDERS_DB --remote

ALTER TABLE telegram_notifications ADD COLUMN chat_id INTEGER;
ALTER TABLE telegram_notifications ADD COLUMN message_id INTEGER;
ALTER TABLE telegram_notifications ADD COLUMN message_text TEXT;
