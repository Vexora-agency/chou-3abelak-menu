-- 0024: Customer email for order status notifications (nullable, no backfill).
-- Legacy rows keep NULL and read as '' (opt-in only, never required).
ALTER TABLE orders ADD COLUMN customer_email TEXT;
