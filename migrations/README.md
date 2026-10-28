# Migrations (D1 `ORDERS_DB`)

Apply locally: `npx wrangler d1 migrations apply ORDERS_DB --local`
Apply remote: `npx wrangler d1 migrations apply ORDERS_DB --remote` (needs the real `database_id` in `wrangler.toml`)

| File | What |
|---|---|
| `0001_orders.sql` | `orders` table (id, number UNIQUE, idem_key UNIQUE, status/type CHECKs, items_json, money cols, lang) |
| `0002_*` | **Intentionally missing — no 0002 ever existed.** Numbering jumps 0001 → 0003. D1 applies by filename order, so the gap is harmless. Do NOT create a `0002` to “fill” it (it would sort before `0003` and confuse history). |
| `0003_reports.sql` | `monthly_reports` + `report_settings` tables |
| `0004_orders_nullable_pii.sql` | PII columns nullable (retention NULLs them — must stay nullable) |
| `0005_location_phone_norm.sql` | `location_lat/lng` + `phone_norm` + index + backfill |

Rules: additive only, never edit an applied migration — add a new `0006_*.sql` (see `docs/ADD_NEW_FEATURE.md` step 1).
