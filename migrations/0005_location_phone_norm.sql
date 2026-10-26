-- Customer location + phone-norm lookup for the customer data tool.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

-- Optional delivery coordinates (validated finite numbers, NULL = none).
-- Purged to NULL by the same PII retention job as the other customer fields.
ALTER TABLE orders ADD COLUMN location_lat REAL;
ALTER TABLE orders ADD COLUMN location_lng REAL;

-- Digits-only phone for the customer data search (masked display only).
ALTER TABLE orders ADD COLUMN phone_norm TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_phone_norm ON orders(phone_norm);

-- Backfill for existing rows (common formatting stripped; new inserts
-- store exact digits from the validator).
UPDATE orders
SET phone_norm = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(customer_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')
WHERE phone_norm IS NULL;
