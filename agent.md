# agent.md — Project memory (Chou 3abelak menu)

> Read this file first when the owner says "the email setup", "monthly
> reports", or asks to continue pending work. No secrets in this file —
> real values live only in `.dev.vars` (local, gitignored) and the
> Cloudflare dashboard (production).

## What this is
- Restaurant menu + WhatsApp ordering (Arabic-first, RTL, EN/AR).
- Stack: React + Vite + Tailwind + motion/react + Cloudflare Pages
  Functions + D1 (`ORDERS_DB`) + R2 (`REPORTS`) + KV (`MENU_KV`).
- Repo: `Vexora-agency/chou-3abelak-menu`, branch `main`.
- Local dev: `serve-local.bat` → `http://localhost:3000` (site + API, one
  port). Admin at `/#admin` (cookie session login; test login lives in
  untracked `.dev.vars`).
- Owner's domains: `vexora.agency` (Resend sending domain, **verified**),
  Zoho for receiving (`info@vexora.agency`).

## Done: monthly reports (plan-gated: pro, 404-when-off)- `SITE_PLAN` env (`starter` default). All report routes + `run-reports`
  return 404 on starter.
- Dashboard tab has **Overview | Reports** switch (hidden when feature off).
  Periods: Today / 7 days / This month / Last month (calendar windows, list
  bound to the period). Do NOT reintroduce the deleted `confirmed` flow or
  the Order-type card.
- Key files:
  - `functions/_shared/reports.js` — month math (DST-safe, business TZ from
    `menu.settings.timezone`), SQL aggregation, CSV (BOM, no PII), retention.
  - `functions/_shared/mail.js` — Resend sender (`Idempotency-Key` header).
  - `functions/_shared/report-email.js` — email templates (tested, escaped).
  - `functions/_shared/plan.js`, `functions/_shared/ratelimit.js`.
  - Routes: `api/admin/report-settings.js` (+ `/resend`, `/test`),
    `api/admin/reports.js`, `api/admin/reports/[month].js` (CSV),
    `api/reports/confirm.js` (public), `api/internal/run-reports.js`
    (bearer `CRON_SECRET`, 404 without it).
  - `scheduler/` — separate Worker, ONE cron `0 5 * * *` (05:00 UTC),
    fans out to `CLIENT_ENDPOINTS` (JSON `[{url, secret}]`).
  - Frontend: `src/components/ReportsPanel.tsx`, `src/utils/tz.ts`,
    wiring in `AdminPanel.tsx` + `OrdersDashboard.tsx`.
  - Migrations: `0003_reports.sql`, `0004_orders_nullable_pii.sql`
    (purge NULLs PII columns — they must stay nullable).
  - Tests: `scripts/test-reports.mjs` (59 checks), `scripts/test-pricing.mjs`
    (91 checks), `scripts/preview-report-email.mjs`.
- Retention (daily job only): PII 90d → NULL + `pii_purged_at`; orders 13mo
  (anonymized only); reports+R2 36mo. HARD RULE: never touch a month until
  its `monthly_reports` row exists.

## Done: Backup & History (works on every plan — NO plan gate here)
- Backup tab = `BackupPanel.tsx` (History/Export/Import/Trash, same design).
- `functions/_shared/diff.js` (diffMenus EN/AR + summarizeChanges),
  `functions/_shared/versions.js` (snapshots, trash, HMAC envelopes,
  CSV parse/build/merge, print HTML, auto-backup state).
- PUT `/api/admin/menu?source=autosave|manual` snapshots previous doc
  (autosave coalesced 5 min via KV; legacy `menu:backup` migrated once).
  `onSaveMenu(menu, source)` threads source from AdminPanel through App.
- Routes: `versions` (+`[id]/changes`, `[id]/restore` with safety copy),
  `trash` (POST move with baseVersion/409, GET, `[id]/restore`,
  `[id]` DELETE), `backup/export|csv|print|auto`, `import/analyze|apply`
  (15-min single-use session-bound tokens, 5 applies/hour, unsigned files
  can NEVER touch settings/ordering/WhatsApp — enforced server-side).
- Deletes are server-side soft deletes with 8s Undo toast; dirty edits are
  flushed first (handleSave returns version|null). Category delete takes
  its items; restore recreates missing categories.
- Weekly backup hooks into run-reports Monday job (email + R2 `backups/`,
  keep 12). Monday path NOT yet observed live (verified by code + unit).
- Roles SKIPPED deliberately: sessions have no roles and no staff users
  exist (single owner account). Password re-entry for settings import also
  skipped: panel (normative UI) has no password field — typed APPLY +
  signature + session stand in. Both documented, revisit if staff logins
  are ever added.
- Migrations 0003/0004 applied locally; tests: `test-backup.mjs` (70).

## Done: pause/location/banner/privacy (all plans; customer tool needs orderLogging)
- `functions/_shared/status.js` = ordering state machine (single impl;
  `src/utils/status.ts` re-exports it; business-TZ, overnight, DST).
  `src/utils/serverTime.ts` = server-offset clock. `src/utils/tz.ts` +=
  datetime-local ↔ business-TZ converters.
- Endpoints: `GET /api/ordering-state` (public), `POST
  /api/admin/ordering/pause` (30/60/120/indefinite/resume, 3 retries),
  `GET /api/privacy-info`, `customer-data/{status,search,action}` (plan
  gated; password + typed word + 10/h; HMAC audit via AUDIT_SECRET).
- POST /api/orders enforces paused/closed/disabled FIRST (403 + message),
  stores location (delivery only, 5-decimal) + phone_norm. Retention NULLs
  location too; report CSV never selects it.
- Client: App holds ordering state (60 s refresh, menu fallback);
  AnnouncementBanner (serverNow, scrolling ticker + owner speed); Header paused
  pill; CartBar/cart status lines; Send gate (2.5 s check, fail-open) +
  403 handling; **in-cart map picker (Leaflet 1.9.4 + OSM tiles, lazy
  chunk, draggable pin, Nominatim reverse-fill on Confirm, empty address
  only)** — owner explicitly accepted the OSM trade-off (disclosed on
  privacy page + README); pinned chip shows **haversine distance from the
  restaurant** (`menuHelpers`: haversineMeters/parseMapUrlCoords/
  formatDistance; "≈ X m/km from restaurant", fallback center =
  restaurant coords) instead of ±accuracy; MenuList layouts (category.layout
  cards/list/compact; manakish defaults list; list no-desc = single line;
  cards = equal heights + watermark on ALL cards (frozen per-category
  settings: icon/style/opacity/size/rotation/position, validated; adaptive
  artwork gold-on-dark / black-on-light); per-section Display — manakish
  list, pastries cards, pizza list, fatayer + drinks compact (long names
  stay in list, short names in cards/compact so nothing truncates);
  admin has Display pills only
  (watermark studio + custom colors + undo/redo removed per owner);
  admin upload ≤256px/≤~40KB); privacy notice + Footer link; `/privacy` via
  pretty URL (dev serves privacy.html at /privacy; `_redirects` rule kept
  for production safety).
- Admin: ordering pause/message/acceptWhenClosed, announcement card (live
  ticker preview, motion + speed 1-10, TZ datetimes), privacy card (review tick), dashboard pause bar
  with countdown, Customers screen (password-gated actions).
- Migration 0005 (location_lat/lng, phone_norm + index + backfill).
  Permissions-Policy geolocation=(self); CSP untouched.
- FEATURES.orderLogging = [pro]; roles skipped (single owner).
- Tests: test-status.mjs (31), test-features.mjs (46).
- E2E-verified live: pause/resume/state, 403s, location insert, CSV/BOM,
  privacy page+info, search/mask/anonymize/audit, announcement save,
  menu restored after. Weekly Monday hook + real Resend delivery untested.

## ⏳ PENDING: production email setup (waiting on owner)
Status: Resend domain `vexora.agency` verified + DKIM/DMARC/SPF in place.
Nothing left in DNS. Remaining, in order:
1. Owner creates Resend API key (`re_...`).
2. Production env vars (Pages → Settings → Production, redeploy after):
   `SITE_PLAN=pro`, `RESEND_API_KEY`, `MAIL_FROM_DOMAIN_EMAIL`
   (= `reports@vexora.agency` — agreed sender; From shows
   "Chou 3abelak <reports@vexora.agency>"), `REPLY_TO=info@vexora.agency`
   (Zoho inbox), `SITE_URL` (❓ owner hasn't given the final site domain),
   `CRON_SECRET` (❓ offered to generate — not yet requested).
3. `wrangler d1 migrations apply ORDERS_DB --remote` + create+bind R2
   bucket `chou-3abelak-reports` as `REPORTS` + R2 lifecycle ~37mo backstop.
4. Deploy `scheduler/` + `CLIENT_ENDPOINTS` secret.
5. Panel test: set real email → confirm link → verified → test mail
   (check spam) → CSV attached.
- Actual Resend delivery is UNTESTED (needs the above). Everything else was
  verified locally (see README § Monthly reports checklist).

## Local-dev gotchas (learned the hard way)- `wrangler pages dev` does NOT auto-apply D1 migrations → run
  `npx wrangler d1 migrations apply ORDERS_DB --local` after pulling.
- NEVER pass `--kv/--d1` flags to `pages dev` — they shadow `wrangler.toml`
  bindings with EMPTY namespaces (blank menu + 503s on all D1 routes).
  `serve-local.bat` is already fixed (bindings from `wrangler.toml` only).
- On restart weirdness (hangs/crashes): kill ALL `node`+`workerd`
  processes (stale children survive PID kills), never run two servers on
  :3000 (old one serves stale bundle — caused a long "stuck value" hunt).
- PowerShell `Invoke-WebRequest` can't do `Secure` cookies over http or the
  login `Origin` rule — for API probes either send `Origin` explicitly or
  flip `ALLOW_LOCAL_DEV=1` temporarily (it is `0` normally).
- `.dev.vars` currently also has `SITE_PLAN=pro`, `CRON_SECRET`,
  `SITE_URL=http://127.0.0.1:3000`, `BACKUP_SECRET` (local-only, gitignored).
- Seeded local test data exists in local D1 (Sep 2026 orders + old-month
  fixtures + `newowner@example.com` pending settings). Offer cleanup before
  handoff; production D1 untouched.
- Playwright MCP is installed in opencode (`playwright`, always enabled,
  headed Chromium) — use it for real browser verification (navigate,
  snapshot, screenshot) instead of guessing at rendered output.
- Unit-test fakes live inside `scripts/test-reports.mjs` (fake D1/R2/KV);
  route-level checks for confirm/scheduler live in temp scripts (not repo).
