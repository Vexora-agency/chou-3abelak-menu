-- 0036_customer_default_location.sql
-- Optional pin for a registered customer's default address. The address text
-- stays editable; the pin is required by the profile API whenever an address
-- is saved, so checkout can start from a known point.
ALTER TABLE customer_profiles ADD COLUMN location_lat REAL;
ALTER TABLE customer_profiles ADD COLUMN location_lng REAL;
ALTER TABLE customer_profiles ADD COLUMN location_accuracy REAL;
