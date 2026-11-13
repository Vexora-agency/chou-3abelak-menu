-- 0035_customer_profiles.sql
-- Optional customer profile fields used to prefill checkout and to show a
-- complete registered-customer record in the admin dashboard.
-- Name/email/image stay in Better Auth's "user" table; this table only holds
-- the fields Better Auth does not own. One row per user, cascade on delete.
CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id TEXT PRIMARY KEY,
  phone TEXT,
  address TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_phone
  ON customer_profiles(phone);
