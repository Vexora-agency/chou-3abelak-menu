-- 0025: Receipt-check marker for post-ETA customer email (nullable, no backfill).
-- Legacy rows keep NULL and are skipped until claimed; the order-nag sweep
-- claims exactly once (receipt_asked_at stamped) then sends 'receipt_check'.
ALTER TABLE orders ADD COLUMN receipt_asked_at TEXT;
