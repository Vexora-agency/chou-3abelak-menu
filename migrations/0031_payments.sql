-- Payments seam: COD today, online gateways tomorrow.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

-- payment_method: today always 'cod' (whitelist in validateOrderInput).
-- payment_status: 'pending' until a future gateway flips to paid/failed.
ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';
