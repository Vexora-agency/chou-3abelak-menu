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
| `0006_order_counter.sql` | `order_counter` table + seed 1000 + fast-forward to `MAX(number)` (atomic order numbers via `UPDATE ... RETURNING`) |
| `0007_*` … `0016_*` | client access, push, service secrets, WhatsApp/Telegram config, tracking (see filenames) |
| `0017_whatsapp_removal.sql` | WhatsApp removal: deletes `wa-api` config + token rows. NOT yet applied — run explicitly per client. Keeps `orders.sent_via`. |
| `0018_order_ready_status.sql` | Order `ready` state (`new → confirmed → ready → completed` + cancelled): rebuilds `orders` with the widened status CHECK, full column set as of 0017, data copied verbatim. |

Rules: additive only, never edit an applied migration — add a new `00NN_*.sql` with the next free number (see `docs/ADD_NEW_FEATURE.md` step 1).
