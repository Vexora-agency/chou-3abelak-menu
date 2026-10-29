-- Per-account disable flag (NULL = active, ISO timestamp = disabled since).
-- Login checks it; LIVE sessions are killed separately via a KV revocation
-- stamp (see isSessionRevoked in functions/_shared/access.js), because
-- sessions are stateless HMAC tokens that can't be edited after minting.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

ALTER TABLE client_users ADD COLUMN disabled_at TEXT;
