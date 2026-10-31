-- 0016: Telegram lock-notice marker — a customer order has a 2-minute
-- self-cancel window. When it lapses with the order still `new`, a cron
-- sweep sends the owner ONE "order is final, proceed" notice. This column
-- records that notice so the sweep never double-sends. Nullable by design:
-- pre-0016 rows and rows without a Telegram message simply never match
-- the sweep's INNER JOIN and are skipped silently.
-- Apply local:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote: npx wrangler d1 migrations apply ORDERS_DB --remote

ALTER TABLE telegram_notifications ADD COLUMN locked_notified_at TEXT;
