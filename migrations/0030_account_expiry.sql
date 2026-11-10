-- 0030: optional account lifetime for invite-based logins (kitchen + client).
--
-- invites.duration_days: requested lifetime in days (1, 7 or 30), or NULL
--   for an open-ended account. Set once at mint time via POST
--   /api/admin/invites/create { durationDays }; validated in code.
-- client_users.expires_at: ISO timestamp when the account stops working, or
--   NULL for open-ended (the pre-0030 default — every existing row reads as
--   open, so nothing changes for accounts minted before this migration).
--   Stamped once at redeem time (now + duration_days); login rejects expired
--   accounts exactly like disabled ones (generic failure, no oracle), and
--   redeem/login sessions are capped so they never outlive the account.
--   disable/delete (the hard close) is unchanged.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote

ALTER TABLE invites ADD COLUMN duration_days INTEGER;

ALTER TABLE client_users ADD COLUMN expires_at TEXT;
