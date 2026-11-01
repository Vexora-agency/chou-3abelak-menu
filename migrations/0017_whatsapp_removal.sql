-- 0017: WhatsApp removal (permanent, owner decision).
-- Deletes the WhatsApp Cloud API service config + token. Idempotent and
-- safe to re-run. NOT YET APPLIED — run explicitly per client with:
--   npx wrangler d1 migrations apply ORDERS_DB --remote
--
-- Deliberately NOT dropped: orders.sent_via (nullable marker, zero query
-- cost; dropping it would couple this migration's deploy to the repo
-- deploy since old code SELECTs it). Revisit only for schema hygiene.
-- waapi:day:* KV counters expire via their 172800s TTL — no cleanup needed.
-- D1 Time Travel retains pre-migration rows (7 days on free plan).

DELETE FROM service_config WHERE key = 'wa-api';
DELETE FROM service_secrets WHERE key = 'wa-api-token';
