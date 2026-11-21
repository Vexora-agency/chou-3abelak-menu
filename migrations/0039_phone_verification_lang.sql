-- 0039_phone_verification_lang.sql
-- Remember which language the member used on the site so the automatic
-- WhatsApp confirmation/wrong-code reply matches it (Arabic or English).
-- Existing rows default to English; the site passes 'ar' or 'en' on insert.
ALTER TABLE phone_verifications ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
