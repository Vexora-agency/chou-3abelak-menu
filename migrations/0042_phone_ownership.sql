-- 0042_phone_ownership.sql
-- One verified phone = one member account.
--
-- Before this migration the verification table allowed two members to verify
-- the same family number. The customer/owner rule is stricter: a number that
-- is already verified by another member must be refused with a clear message
-- (profile save, checkout, codes), and moving away from a verified number and
-- back requires a fresh proof.
--
-- 1. Retire approvals whose 365-day window already elapsed (validity is
--    evaluated at read time in code; this only frees the unique slot).
-- 2. Keep the FIRST live approval per phone (the original claim) and revoke
--    later duplicates. Historical rows are kept for audit.
-- 3. Add a partial unique index so a second live approval for the same phone
--    is refused even if two decisions race.
UPDATE phone_verifications
   SET status = 'expired'
 WHERE status = 'approved'
   AND (decided_at IS NULL OR julianday(decided_at) < julianday('now', '-365 days'));

UPDATE phone_verifications
   SET status = 'revoked',
       decided_by = 'ownership_duplicate'
 WHERE status = 'approved'
   AND EXISTS (
     SELECT 1
       FROM phone_verifications keep
      WHERE keep.phone = phone_verifications.phone
        AND keep.status = 'approved'
        AND (
          julianday(keep.decided_at) < julianday(phone_verifications.decided_at)
          OR (
            julianday(keep.decided_at) = julianday(phone_verifications.decided_at)
            AND keep.id < phone_verifications.id
          )
        )
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_verifications_one_owner
  ON phone_verifications(phone)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS idx_phone_verifications_owner_lookup
  ON phone_verifications(phone, status, decided_at);
