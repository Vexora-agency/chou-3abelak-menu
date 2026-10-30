-- 0009: order tracking tokens + web push subscriptions.
-- Tracking: each order carries a random track_token; the customer-facing
-- /api/track endpoint gates on (number, token) and exposes NO PII.
-- Push: subscriptions keyed by endpoint, linked to an order; a singleton
-- push_settings row holds the lazily-generated VAPID pair (zero dashboard
-- setup: the first /api/push-key call creates it).

ALTER TABLE orders ADD COLUMN track_token TEXT;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subs_order ON push_subscriptions(order_id);

CREATE TABLE IF NOT EXISTS push_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL
);
