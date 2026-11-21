-- 0037_phone_verifications.sql
-- Reverse WhatsApp phone verification. The site generates a 6-digit code,
-- the member sends it FROM the phone number to the restaurant's WhatsApp,
-- and the owner approves the matching pending request in the dashboard.
-- The sender number is the proof; no outbound WhatsApp template is used.
--
-- Only a keyed hash of the code is stored: the plaintext code exists in the
-- member's browser and in the WhatsApp message, never in the database or the
-- admin UI. `reference` is the short public handle shown in both places so a
-- pending request can be matched without exposing the code.
--
-- Status: pending -> approved | rejected | expired. Approved rows stay valid
-- for PHONE_VERIFICATION_VALIDITY_MS (365 days); expiry is evaluated at read
-- time from approved_at, so no nightly job is required.
CREATE TABLE IF NOT EXISTS phone_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  FOREIGN KEY (user_id) REFERENCES "user" ("id") ON DELETE CASCADE
);

-- One live request per member+number. Expired rows are flipped to 'expired'
-- before a new row is inserted, freeing this slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_verifications_live
  ON phone_verifications(user_id, phone)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_phone_verifications_pending
  ON phone_verifications(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_user_phone
  ON phone_verifications(user_id, phone, status);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_created
  ON phone_verifications(created_at);
