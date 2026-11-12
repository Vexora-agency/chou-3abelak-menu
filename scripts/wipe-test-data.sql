-- One-off handover wipe: deletes TEST data, keeps config + menu.
-- KEEPS (do NOT touch):
--   service_config      (Telegram bot username needed for re-linking)
--   service_secrets      (integrations config)
--   push_settings        (VAPID keys — deleting breaks web push)
--   report_settings      (report email config — reconfigure in admin if needed)
--   client_users/invites (logins — wipe separately only if they are test accounts)
--   MENU_KV 'menu' key  (THE MENU — lives in KV, untouched by this file)
-- Run: npx wrangler d1 execute <DB> --remote --file ./scripts/wipe-test-data.sql
--   prod:    npx wrangler d1 execute chou-3abelak-orders --remote --file ./scripts/wipe-test-data.sql
--   preview: npx wrangler d1 execute chou-3abelak-orders-preview --env preview --remote --file ./scripts/wipe-test-data.sql

DELETE FROM telegram_order_chats;
DELETE FROM telegram_chats;
DELETE FROM telegram_pairing_codes;
DELETE FROM telegram_notifications;
DELETE FROM orders;
DELETE FROM rate_counters;
DELETE FROM cron_heartbeat;
DELETE FROM push_subscriptions;
DELETE FROM admin_push_subscriptions;
DELETE FROM monthly_reports;
UPDATE order_counter SET last_number = 1000 WHERE id = 1;
