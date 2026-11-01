# Restore runbook (per-client account) — READ BEFORE YOU NEED IT

## Inventory: what the backup feature covers and what it does NOT

| Data | Covered by | Restore path |
|---|---|---|
| Menu doc + settings + ordering flags (KV `menu`) | Versions history (latest 50 + 1/day/60d, auto safety copy on every restore) + signed export JSON + weekly R2 email (12 copies) | History tab → Restore (with preview); or Backup → Import a signed/unsigned file |
| Deleted items/categories | KV trash, 30d, with Undo + restore-by-id | Backup → Trash → Restore |
| Monthly report CSVs (R2 `reports/<YYYY-MM>.csv`) | Generated from D1 at month close; emailed once; R2 lifecycle backstop (recommended 37mo, verify in dashboard) | Re-download from Reports tab; re-generate ONLY if the source orders still exist (see retention) |
| D1 tables (orders, counters, reports, secrets-refs) | **NOT in the export flow.** Recovery = D1 Time Travel + retention windows | D1 dashboard → database → Time Travel restore (whole-DB, point-in-time) |
| Pages env vars + `service_secrets` tokens (admin hash, session secret, Resend/Telegram keys) | **NOT backed up anywhere.** | Re-enter by hand in dashboard (list below). Losing `BACKUP_SECRET` orphans old signed files (they will not verify). |

Sources: D1 Time Travel windows (7d free / 30d paid; 10 restores/10min per DB) — https://developers.cloudflare.com/d1/platform/limits/ and pricing — https://developers.cloudflare.com/d1/platform/pricing/ (both fetched 2026-11-01).

## Procedure 1 — restore the menu (KV, safe, reversible)

1. Dashboard is NOT needed. Open `/#admin` → Backup → History.
2. Pick the version, preview the diff, Restore. A safety copy of the live doc is snapshotted automatically — undo is one more restore.
3. If the panel itself is broken: Backup → Import → choose the newest signed JSON (local copy or the weekly R2 email attachment) → Analyze → type APPLY → verify the storefront.
4. Trash restores: Backup → Trash → per-item Restore (recreates missing categories).

## Procedure 2 — restore D1 (Time Travel, whole database)

1. Cloudflare dashboard → Workers & Pages? No — D1 lives under **Storage & Databases → D1** → select `chou-3abelak-orders`.
2. **Time Travel**: pick a timestamp BEFORE the damage (inside the 7-day free window). Restore creates a restored copy — point the binding at it only after verifying row counts (`SELECT count(*) FROM orders`, spot-check newest `number`).
3. Counter table (`order_counter.last_number`) restores with the DB — no separate fix needed, but confirm the next placed order gets `MAX(number)+1`.
4. Retention interplay: orders already NULLed/purged by the retention job are GONE from history too — Time Travel cannot reach past the purge if it aged out of the window. This is by design; do not treat Time Travel as an archive.

## Procedure 3 — secrets (always manual)

If env vars are lost, re-enter in Pages → Settings → Environment variables (Production AND Preview): `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (regenerate via `node scripts/hash-password.mjs`), `SESSION_SECRET` (new 32-byte base64 — this logs everyone out, expected), `SITE_PLAN`, `RESEND_API_KEY`, `MAIL_FROM_DOMAIN_EMAIL`, `REPLY_TO`, `SITE_URL`, `CRON_SECRET`, `BACKUP_SECRET` (rotating invalidates old signed backups), `AUDIT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`. Local dev: same keys in `.dev.vars` (never commit).

## Restore drill (owner runs once on STAGING, not production)

- [ ] Export a signed backup from staging; download it.
- [ ] Delete one item; restore it from Trash. Confirm it reappears.
- [ ] Restore an older History version; confirm the storefront changes; restore back (safety-copy path).
- [ ] Tamper one byte of a backup copy; confirm Analyze rejects the signature.
- [ ] Import an UNSIGNED old file carrying a `settings.whatsapp` field; confirm it imports and the field is stripped (legacy tolerance).
- [ ] Place a staging order; wrong password ×3 in customer-data tool; confirm audit entries contain no phone digits.
- [ ] TIME TRAVEL DRILL (staging DB only): note order count, restore to 1 hour ago, confirm count matches, then re-point binding back. Record duration.
- [ ] Record drill date + duration + issues below. Do NOT claim the drill was done until every box is ticked by hand.

Drill log:
- (empty — fill after running)
