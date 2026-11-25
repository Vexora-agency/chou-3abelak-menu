-- 0043: admin review dismissal — trusted-order marker.
-- Apply locally:  npx wrangler d1 migrations apply ORDERS_DB --local
-- Apply remote:   npx wrangler d1 migrations apply ORDERS_DB --remote
--
-- review_cleared: owner/admin decision that a flagged order was checked and
-- is legitimate. risk_score/risk_reasons stay untouched (audit trail); only
-- the badge computation (needsReview) honors the flag. Defaults keep legacy
-- rows readable (0 = flagged when scored, no backfill).
ALTER TABLE orders ADD COLUMN review_cleared INTEGER NOT NULL DEFAULT 0;
