-- 0013: sent_via marker (wa.me vs Cloud API) so idempotent retries reuse
-- the ORIGINAL channel instead of double-contacting (API message + wa.me
-- draft for the same order). NULL = legacy rows (treated as wa).
ALTER TABLE orders ADD COLUMN sent_via TEXT;
