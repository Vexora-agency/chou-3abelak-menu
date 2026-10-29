-- Client login accounts + single-use invite links (owner-minted).
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

-- Per-site staff/client logins (the master env login is separate and always works).
CREATE TABLE IF NOT EXISTS client_users (
  username TEXT PRIMARY KEY,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Invite links: only the SHA-256 hash of the token is stored — a database
-- dump exposes no usable link. One row per invite; consumed atomically.
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invites_token_hash ON invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_invites_expires_at ON invites(expires_at);
