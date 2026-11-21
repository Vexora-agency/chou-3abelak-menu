-- 0041_customer_wishlist.sql
-- Member wishlist: one row per saved menu item per account.
--
-- The wishlist is item-level (not variant-level): saving a dish stores the
-- menu item id, and opening it lets the member pick the size/add-ons fresh.
-- Menu content lives in the menu document, so only the stable item id is
-- stored here; unknown ids are filtered out by the client at render time.
CREATE TABLE IF NOT EXISTS customer_wishlist (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES "user" ("id") ON DELETE CASCADE
);

-- Newest-first reads for one member (the account sheet list).
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_user_created
  ON customer_wishlist (user_id, created_at DESC);
