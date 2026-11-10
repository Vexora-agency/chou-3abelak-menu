-- 0028: kitchen role for invite links + client accounts.
--
-- Roles: 'client' (default, full customer/admin login as today) vs
-- 'kitchen' (restricted staff login; gated by requireKitchenOrOwner in
-- functions/_shared/access.js). Existing rows backfill to 'client', so
-- pre-0028 sessions and accounts behave exactly as before.
--
-- The CHECK pins the value set at the storage layer (defense in depth —
-- a code bug can never persist role='owner'/'admin'); the API layer
-- validates again via isRole() in functions/_shared/access.js.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

ALTER TABLE invites ADD COLUMN role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'kitchen'));

ALTER TABLE client_users ADD COLUMN role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'kitchen'));
