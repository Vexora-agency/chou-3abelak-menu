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
| `0019_order_release.sql` | Order release marker (`released_at` + backfill): kitchen grace period — new orders stay hidden from admin/Telegram/push for 5 min, the order-nag sweep releases them after. |
| `0020_cron_heartbeat.sql` | Cron health ledger (`cron_heartbeat`): the 1-minute order-nag sweep stamps started/success per pass so the dashboard can banner a dead cron. |
| `0021_*` | **Intentionally skipped — no 0021 exists.** The ETA feature landed as `0022` directly; D1 applies by filename order so the gap is harmless (same precedent as the missing `0002`). Do NOT create a `0021` to "fill" it. |
| `0022_eta_times.sql` | Smart ETA + receive-unlock instants (`orders.confirmed_at`, `orders.eta_at`, both nullable, no backfill — legacy rows keep NULL and the code treats NULL safely via created_at+delay fallbacks). |
| `0023_linked_orders.sql` | Follow-up link (`orders.parent_number` nullable, no backfill — NULL = standalone) + restores `idx_orders_phone_norm` (dropped by 0018) + `idx_orders_parent_number`. |
| `0024_customer_email.sql` | Customer email for order status notifications (`orders.customer_email` TEXT nullable, no backfill — NULL = opt-out, reads as `''`). |
| `0025_receipt_check.sql` | Receipt-check marker (`orders.receipt_asked_at` TEXT nullable, no backfill — NULL = not asked yet, stamped once by the order-nag sweep before the `receipt_check` email). |
| `0026_telegram_delivery.sql` | Telegram delivery-crew sharing (`telegram_chats` + `telegram_order_chats` tables, `telegram_pairing_codes.role` default `owner` — owner link stays in `service_config`). |
| `0027_rate_counters.sql` | Atomic order spam cap (`rate_counters` keyed counters; single-statement check-and-reserve UPSERT in `checkAndReserveOrderBudget`, fixes the KV read-modify-write race — no backfill, starts empty). |
| `0028_kitchen_role.sql` | Kitchen role for invites + client accounts (`invites.role`, `client_users.role` — `client` default, CHECK pins `client`/`kitchen`; pre-0028 rows backfill to `client`). |
| `0029_updated_by.sql` | Last status actor (`orders.updated_by` TEXT nullable, no backfill — kitchen/client PATCH stamps the login name, owner PATCH clears to NULL; reads as `updatedBy`). |
| `0030_account_expiry.sql` | Optional account lifetime (`invites.duration_days` INTEGER nullable, `client_users.expires_at` TEXT nullable, no backfill — NULL = open-ended; redeem stamps `expires_at = now + duration`, sessions capped at the remaining time, login rejects expired exactly like disabled; disable/delete unchanged). |
| `0033_better_auth.sql` | Customer auth tables for Better Auth 1.7.23 (`user`, `session`, `account`, `verification`, `rateLimit`) + indexes. Generated from the real config and reviewed by hand. Additive only; no existing table touched. |
| `0034_orders_customer_link.sql` | `orders.customer_user_id` TEXT nullable + `(customer_user_id, created_at DESC)` index. Guest/legacy rows stay NULL; written only from the server-side session. |
| `0035_customer_profiles.sql` | `customer_profiles` (user_id PK → user cascade, phone, address, updated_at) + phone index. Name/email stay in Better Auth's `user`. |
| `0036_customer_default_location.sql` | Optional default-address pin (`customer_profiles.location_lat/lng/accuracy`, nullable — typed addresses still order). |
| `0037_phone_verifications.sql` | Reverse WhatsApp phone verification: `phone_verifications` (row id, user, normalized phone, short reference UNIQUE, keyed code hash, status, 10-min expiry, decision stamp) + one-live-pending index. **Apply this BEFORE deploying the code that reads it**, otherwise profile/order reads 503/fail open. TTL is 5 minutes in current code. |
| `0038_whatsapp_webhook.sql` | WhatsApp Cloud API inbound ledger: `whatsapp_webhook_events` (Meta message id PK for exactly-once processing, sender phone, outcome, received_at) + indexes for the reply cost guard. Needed by the auto-verification webhook. |
| `0039_phone_verification_lang.sql` | `phone_verifications.lang` (`ar`/`en`, default `en`) so the automatic WhatsApp success/wrong reply matches the member's site language. Existing rows default to English. |

Rules: additive only, never edit an applied migration — add a new `00NN_*.sql` with the next free number (see `docs/ADD_NEW_FEATURE.md` step 1).
