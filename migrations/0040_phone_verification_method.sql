-- 0040_phone_verification_method.sql
-- Verification channel: 'whatsapp' (the default reverse-message flow) or
-- 'sms' (UniMTX OTP fallback for members without WhatsApp). Existing rows are
-- WhatsApp requests. provider_id is the UniMTX message id for SMS rows;
-- attempts counts failed SMS code entries so a row can be locked out.
ALTER TABLE phone_verifications ADD COLUMN method TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE phone_verifications ADD COLUMN provider_id TEXT;
ALTER TABLE phone_verifications ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
