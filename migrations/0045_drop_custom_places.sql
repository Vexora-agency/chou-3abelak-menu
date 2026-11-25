-- 0045: drop the owner-curated places table (feature removed).
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote
--
-- The manual «areas & landmarks» admin UI was removed in favor of
-- downloadable offline place libraries (public place indexes per country,
-- see docs/PLACES_INDEX.md): no typing, no per-keystroke database reads.
-- IF EXISTS keeps this safe on databases where 0044 never ran.
DROP TABLE IF EXISTS custom_places;
