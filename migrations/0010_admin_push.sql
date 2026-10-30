-- 0010: owner (kitchen) push subscriptions.
-- Unlike customer subs (bound to an order via tracking token), owner devices
-- are bound to the ADMIN: subscribing requires the admin session, and every
-- new order notifies ALL of them. Payloads carry only the order number +
-- total (never customer PII — details open behind the admin login).
CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL
);
