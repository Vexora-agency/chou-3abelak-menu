# Chou 3abelak (شو عبالك) — Fast Restaurant Menu & Online Ordering

A fast, bilingual (English & Arabic with full RTL), high-performance restaurant menu website built with modern UI design, animated hero video branding, real-time live search, and a zero-friction online ordering cart system.

---

## 📁 Project Structure

```
├── /index.html                    # Main entry point with preconnected Google Fonts
├── /metadata.json                 # Application metadata and descriptors
├── /_headers                      # Security headers & cache rules for Cloudflare Pages
├── /robots.txt                    # Blocks crawlers from /admin/ and /api/admin/
├── /menu.seed.json                # Default seed menu document
├── /public/                       # Public static assets & media
│   ├── /assets/                   # Video intro (webm/mp4), logo-final.png, icons
│   ├── /menu.seed.json
│   ├── /_headers
│   └── /robots.txt
├── /src/
│   ├── /config/                   # White-label skin: client.config, theme.config (brand),
│   │                              # features.config (package flags), navigation.config, index barrel
│   ├── /features/                 # REAL feature modules, each owning its UI + state:
│   │                              # cart/, menu/, orders/, admin/, reports/, backup/
│   │                              # layout per feature: components/, hooks/,
│   │                              # services/*.api.ts, index.ts (public barrel).
│   │                              # Rule: import other features via their barrel
│   │                              # only — never deep (enforced: npm run lint:isolation).
│   │                              # Reference example for new features: cart/.
│   ├── /components/               # Shell + shared UI only: Header (+header/),
│   │                              # Footer, AnnouncementBanner, ui/ design system
│   │                              # (Button, Input, Card, Table, Modal).
│   ├── /lib/api-client.ts         # SINGLE fetch wrapper (apiFetch/adminFetch/publicGet/
│   │                              # publicPostRaw) — all /api traffic goes through here
│   ├── /hooks/ (4 files)          # Shell-only shared hooks (useAppPrefs, useTickerLoop,
│   │                              # useHeaderMotion, useHeaderIntroEngine). Feature
│   │                              # state lives in features/*/hooks/.
│   ├── /utils/ (13 files)         # pricing.ts + pricing-menu.ts + pricing-badges.ts (must stay
│   │                              # identical to functions/_shared/pricing*.js), status.ts
│   │                              # (mirrors _shared/status.js), safeJson, tz, …
│   ├── /types/menu.ts             # Domain types (must stay in sync with
│   │                              # functions/_shared/validate*.js + menu.seed.json)
│   ├── App.tsx                    # Thin assembly: imports screens/state from
│   │                              # features/*/ barrels + shell (Header/Footer) + config.
│   ├── index.css                  # Tailwind v4 entry (@import tailwindcss + styles/*.css)
│   ├── styles/                    # base.css (:root brand vars), components.css, animations.css
│   └── main.tsx                   # Root mount + applyTheme() (pushes theme.config → :root)
├── /functions/                    # Cloudflare Pages Functions (35 routes, file-based routing)
│   ├── /_shared/                  # ONLY place with D1 SQL. Repositories hold canonical
│   │   │                          # queries; domain files (orders.js, pricing*.js,
│   │   │                          # reports*.js, validate*.js, status.js, plan.js,
│   │   │                          # session.js) contain logic only.
│   │   ├── /repositories/         # orders, reports, report-settings, customer-data (+index.js)
│   │   ├── validate*.js           # Menu validator split (core/settings/catalog/items/…)
│   │   └── pricing*.js            # Server copy of pricing engine (≡ src/utils/pricing*.ts)
│   └── /api/
│       ├── menu.js / orders.js (POST) / ordering-state.js / privacy-info.js
│       ├── auth/session|login|logout.js + internal/run-reports.js
│       └── /admin/               # menu, orders (+[id]), reports (+[month]), report-settings
│                                 # (+/resend, /test), backup/*, versions*, trash*, import/*,
│                                 # ordering/pause, customer-data/*, activity (+_middleware.js)
├── /migrations/                   # D1 schema (see migrations/README.md — no 0002 by design)
├── /scheduler/                    # Reports cron Worker (0 5 * * * → POST run-reports)
└── /scripts/                      # Node checks (test-pricing/reports/backup/status/features…)
```

---

## 🚀 Quick start (new machine → green tests in minutes)

```bash
git clone <repo-url> && cd chou-3abelak-menu
git checkout <branch-under-review>  # main once merged; feature branches are previewed, never pushed to main
npm ci            # one-time, ~2-4 min (esbuild postinstall warnings are harmless)
npm run test:all  # must be green, ~1 min (excludes test:live, which needs a server/emulator)
npm run build     # ~10 s
cp .dev.vars.example .dev.vars   # fake local secrets (git-ignored, never commit)
npx wrangler pages dev ./dist --port 3000   # first run downloads wrangler (~20 s)
```

Open http://localhost:3000. Admin login locally uses the fake `.dev.vars`
credentials. Do NOT add `--kv/--d1/--binding` flags: they shadow the
`wrangler.toml` bindings with empty ones (blank menu + 503s on D1 routes).
Plain `npm run dev` (Vite only, no API) also works for UI-only changes.

---

## ⚙️ Cloudflare Dashboard Configuration

1. **Workers KV:**
   - Create a KV namespace named `MENU_KV`.
   - In Pages project Settings > Functions > KV namespace bindings, bind variable name `MENU_KV` to your created namespace.
2. **D1 database (orders):**
   - Create a D1 database (e.g. `chou-3abelak-orders`) and bind it as `ORDERS_DB` in Pages project Settings > Functions > D1 database bindings.
   - Apply the schema once: `npx wrangler d1 migrations apply ORDERS_DB --remote` (after `wrangler d1 create`, put the real id in `wrangler.toml` for the `--remote` run only).
2. **Environment Variables (Production):**
   - `ACCESS_TEAM_DOMAIN`: Your Cloudflare Zero Trust team domain (e.g., `myteam.cloudflareaccess.com`).
   - `ACCESS_AUD`: The Application Audience (AUD) tag generated by Cloudflare Access for your `/admin` route.
   - `ALLOW_LOCAL_DEV`: Set to `0` (or leave empty) in production.

---

## 🎨 Media Assets & Hero Video

- `logo-intro.webm` & `logo-intro.mp4`: 720x266 video asset rendered on a pure `#000000` background. Merges seamlessly into the `#0A0A0A` banner using CSS `mix-blend-mode: lighten`.
- `logo-final.png`: 720x266 transparent PNG matching the final frame of the video, used for fallback, immediate display on reduced-motion devices, and the footer brandmark.
- The video and image containers preserve the fixed `720 / 266` aspect ratio with `object-fit: contain` to guarantee zero layout shift (CLS: 0).

---

## 🧪 Testing Checklist

- [x] **Page Load & Blank Screen Fix:** Instant visual presentation on first load, with skeleton fallback during data initialization.
- [x] **Language Toggle:** Seamless switch between English (LTR with Poppins) and Arabic (RTL with Cairo font).
- [x] **Theme Switcher:** Toggles between Dark Mode (`#0A0A0A`) and Light Mode (`#FFFFFF`) with smooth color-variable transitions.
- [x] **Live Search:** Immediate filtering across items by title and description in both languages.
- [x] **Interactive Cart:**
  - Add button `(+)` smoothly transitions to `[- qty +]` stepper.
  - Floating bottom bar appears with animated bounce and live price total.
  - Checkout drawer calculates delivery fee and validates minimum order amount.
  - Checkout records the order server-side and shows the live tracking link.
- [x] **Admin Portal:**
  - Accessible via top gear icon or footer link.
  - Edit restaurant name, hours, contact info, and ordering toggles.
  - Reorder categories and items; duplicate, add, or delete items.
  - Export and import complete menu backups in JSON format.
  - Imports are validated with the shared server-side validator (`/sample-menus/menu-30-items.json` is a 30-item file you can import to test with).
- [x] **Offline Resilience:** App continues functioning when disconnected from network using cached menu data in localStorage.

---

## ⚠️ Remaining Operational Considerations

- **Contact number:** In `/public/menu.seed.json` and admin settings, replace the placeholder phone number (`+201000000000` / `201000000000`) with the restaurant's real contact number (Call button, and required to enable ordering).

---

## 🔐 Admin Login (cookie session)

Opening `/#admin` shows a sign-in screen. Sessions are HMAC-SHA256 cookies (`__Host-admin-session`, HttpOnly + Secure + SameSite=Strict, 12h default / 30 days with "remember me").

### 1. Generate credentials (run locally, never commit real values)

```bash
# 1) Password hash for ADMIN_PASSWORD_HASH
node scripts/hash-password.mjs "YourStrongPasswordHere"
# 2) Session secret for SESSION_SECRET (at least 32 random bytes, base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2. Local testing with Wrangler

Create an untracked `.dev.vars` file next to `package.json` (see `.env.example`):

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=pbkdf2$260000$...   # output of the hash script
SESSION_SECRET=<base64 output>
ALLOW_LOCAL_DEV=1
```

Then run (single port for everything — or double-click `serve-local.bat`):

```bash
# After pulling new migrations (0003_reports, 0004_orders_nullable_pii, ...):
npx wrangler d1 migrations apply ORDERS_DB --local
# Every run: serves the built site + Functions on http://localhost:3000
# (bindings come from wrangler.toml — do NOT add --kv/--d1 flags, they shadow
# the configured bindings with empty ones: blank menu + 503s on D1 routes)
npx wrangler pages dev ./dist --port 3000
```

> The dev server above serves the **built** site + Functions on `http://localhost:3000`.

Test matrix:

| #   | Action                                   | Expected                                              |
| --- | ---------------------------------------- | ----------------------------------------------------- |
| 1   | Open `http://localhost:3000/#admin`      | Sign-in screen (no panel)                             |
| 2   | Wrong password × 5                       | Each → `invalid` (401, same message every time)       |
| 3   | 6th attempt (right or wrong password)    | `locked` (429) with retry minutes                     |
| 4   | Wait 15 min (or clear KV) + right login  | Panel opens, counter reset                            |
| 5   | Reload the page                          | Still logged in (session cookie)                      |
| 6   | Sign out (top-right of the panel)        | Back to sign-in screen, cookie cleared                |
| 7   | `GET /api/menu` while logged out         | Public menu still works (no auth required)            |
| 8   | Place a test order, open the `Dashboard` tab | Order appears with the exact server total; KPIs, chart, top items and type split match it |
| 9   | Switch period Today / 7 days / This month / Last month | Counts, revenue, avg and deltas recompute for the selected window |
| 10  | Change an order status, then refresh     | Status persists (server round-trip), no duplicates after re-sending from the cart |
| 11  | Add a size/add-on in Settings → Features, enable it on an item with a price | Appears in the details sheet; totals match server recomputation |
| 12  | Run `node scripts/test-pricing.mjs`      | All pricing checks pass (variants, add-ons, qty grids, migration, seed totals) |

> Tip: to clear the test lockout without waiting, delete the `login:fail:<ip>` key from the local KV (or restart `wrangler pages dev`, which uses a fresh local KV).

### 3. Production env vars (Cloudflare dashboard → Pages → Settings → Environment variables)

Set `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` (mark all as **Secrets**), keep the existing `MENU_KV` binding and `ALLOW_LOCAL_DEV` **unset** (or `0`).

### 4. Cloudflare Access changes

- The Access application **must no longer** cover `/api/auth/*` — the login screen calls these endpoints **before** any login exists, so an Access wall there would lock everyone out (including you).
- Do **not** put `/admin` (a frontend hash route, there is no such file path) behind Access either — use the login screen as the entry instead.
- `/api/admin/*` may stay behind your existing Access application as a second layer, but it is **not required**: the cookie session already gates it, and keeping Access means every admin API call must pass **both** checks. Recommended: remove the Access application from `/api/*` entirely and rely on the login screen — or keep it only if you want belt-and-braces and understand both checks must pass.

---

## 📊 Monthly reports (plan-gated: pro)

Dashboard → **Reports** tab (Overview | Reports switch) shows one card per month
plus the current month live, a CSV download per month, the report-email
settings (address + confirmation, language), and the data
retention summary. Everything below is gated behind the `monthlyReports`
feature: on any other plan every new route answers **404**. Set the plan with
the `SITE_PLAN` env var (`starter` when unset).

### 1. How it runs

- On the 1st of each month (and retried daily, up to 5 attempts) the previous
  complete month is generated (SQL aggregates, no row loops for totals) and
  emailed once to the **verified** address. Re-runs are no-ops once
  `emailed_at` is set.
- The scheduler is a tiny separate Worker in `scheduler/` with **one** cron
  trigger (`0 5 * * *`, 05:00 UTC daily) so the free-plan 5-cron budget is
  safe. It POSTs `POST /api/internal/run-reports` (bearer `CRON_SECRET`,
  constant-time compare, 404 without it) to every site in its
  `CLIENT_ENDPOINTS` secret; a failing site never blocks the others.
- `node scripts/preview-report-email.mjs` renders sample EN+AR emails to
  `./tmp-email/` for visual checks. `node scripts/test-reports.mjs` runs the
  reporting unit tests (DST bounds, aggregation, CSV, retention guard,
  tokens, plan gating).

### 2. Env vars (Pages → Settings → Environment variables, all Secrets)

| Var | Purpose |
| --- | ------- |
| `SITE_PLAN` | `pro` to unlock reports (`starter`/unset hides them) |
| `RESEND_API_KEY` | Resend API key (free plan is enough) |
| `MAIL_FROM_DOMAIN_EMAIL` | Full sender address, e.g. `reports@your-domain.com` |
| `REPLY_TO` | Owner's Zoho address (replies go here, never to the sender) |
| `SITE_URL` | `https://your-domain.com` (logo + dashboard + confirm links) |
| `CRON_SECRET` | Random 32-byte hex for the scheduler → site calls |

For local dev add the same keys to untracked `.dev.vars` (see `.env.example`).

### 3. DNS notes (Resend + Zoho side by side)

- Verify the **sending domain** in Resend (Domain → DNS records): add
  **exactly** the records Resend shows (they live on Resend subdomains/DKIM
  selector names — they do not clash with mail receiving).
- **Do not touch** the Zoho MX or SPF records — receiving (Zoho) and sending
  (Resend) coexist.
- Add a DMARC record, starting permissive: host `_dmarc`, value
  `v=DMARC1; p=none; rua=mailto:owner@your-domain.com` (tighten to
  `quarantine`/`reject` later once mail flows cleanly).

### 4. R2 (report CSVs at `reports/<YYYY-MM>.csv`)

- Create once: `wrangler r2 bucket create chou-3abelak-reports`, then bind it
  as `REPORTS` in the Pages dashboard (local dev already binds it via
  `wrangler.toml`).
- Recommended backstop lifecycle rule on the bucket: delete objects under
  `reports/` older than ~37 months (the app deletes at 36).

### 4b. R2 (menu photos at `menu/<YYYY>/<MM>/<uuid>.<ext>`)

- Create once: `wrangler r2 bucket create chou-3abelak-images`, then bind it
  as `MENU_IMAGES` in the Pages dashboard. Preview uses its own bucket:
  `chou-3abelak-images-preview`.
- The bucket stays **private** — never enable public access or an `r2.dev`
  URL. Photos are served through the same-origin route `/api/images/...`,
  which sets `nosniff`, `CSP: default-src 'none'; sandbox`, `CORP:
  same-origin`, immutable caching and ETag/304.
- Admin uploads: `POST /api/admin/images` with the raw file body (JPEG, PNG
  or WebP; ≤ 8 MB; ≤ 40 MP / 8000 px per side). The server sniffs magic
  bytes, rejects SVG/GIF/AVIF and animated files, strips EXIF/GPS/comments
  and any bytes appended after the logical end of the image.
- Uploads are rate-limited per IP (60 / 10 min — the framing editor
  auto-saves every tweak as its own upload) and audited. Replacing a
  photo is safe: the first menu save after an upload deletes R2 objects no
  item references anymore, with a 15-minute age floor so an in-flight save
  can never delete a just-uploaded photo.

### 5. Retention (env-overridable, enforced by the daily job)

| Setting | Default | Meaning |
| --- | --- | --- |
| `PII_RETENTION_DAYS` | `90` | Customer name/phone/address/notes NULLed, `pii_purged_at` set |
| `ORDER_RETENTION_MONTHS` | `13` | Anonymized order rows deleted past this age |
| `REPORT_RETENTION_MONTHS` | `36` | Old report rows + their R2 CSVs deleted |

**Hard rule:** a month's orders are never purged or deleted until its
`monthly_reports` row exists. The old 1%-per-order lazy cleanup is gone;
retention only runs in the daily job.

### 6. Local verify checklist

| # | Action | Expected |
| --- | --- | --- |
| 1 | Unset `SITE_PLAN`, restart dev | All `/api/admin/report-*`, `/api/admin/reports*`, `/api/internal/run-reports` → 404; Reports switch hidden |
| 2 | `SITE_PLAN=pro`, change email, save | `verificationSent:false` without Resend key; DB holds only a 64-hex token hash, `verified=0`, expiry ~48 h |
| 3 | `GET /api/reports/confirm?token=…` | 200 generic page, no address shown; second use → invalid page; `verified=1`, hash cleared |
| 4 | `POST /api/internal/run-reports` twice | First generates + attempts=1; second attempts=2 (mail fails without key); wrong secret → 404 |
| 5 | Set `emailed_at`, run again | Attempts unchanged (exactly-once skip), retention still runs |
| 7 | Old orders in unreported vs reported months | Unreported keep PII; reported get NULLed (needs migration `0004`) |
| 8 | `node scripts/test-reports.mjs` | All checks pass (DST bounds incl. Beirut Mar/Oct transitions, CSV BOM/Arabic/PII-free) |

Remaining risk: actual Resend delivery needs a real `RESEND_API_KEY` + verified
sending domain — verify with the first scheduled monthly run (the manual test-mail endpoint was removed).

---

## 🛟 Backup & History (works on every plan)

The Backup tab is now a full safety system (same look, no visual redesign):
**History** (every save kept, restore with preview + safety copy),
**Export** (signed JSON / CSV / printable A4 page), **Import** (JSON or CSV
with a two-step analyze → type-APPLY review), **Trash** (30-day soft delete
with Undo), plus a weekly automatic email backup.

- Version snapshots live in KV (`menu:ver:<ISO>-<rand>`, metadata-only
  listing). Every `PUT /api/admin/menu` snapshots the previous document
  (`?source=autosave` coalesces to one per 5 min; manual/import/restore
  always snapshot). Retention: latest 50 + one per day for 60 days.
- Deleting an item/category moves it to `menu:trash` (server-side, with an
  8-second Undo toast) — restores recreate missing categories. Purged after
  30 days.
- Export envelope `{format:'chou-backup', schemaVersion, exportedAt, siteId,
  menu, sig}` with `sig` = HMAC-SHA256 (`BACKUP_SECRET`) over canonical
  JSON. CSV has BOM; print page is escaped A4 with no admin controls.
- Import: `POST /api/admin/import/analyze` (raw body ≤ 2 MB, strict
  `validateMenu`, proto-pollution + depth guards, HMAC check, CSV parser)
  stages to KV `import:<token>` (15-min TTL, single use, session-bound);
  `POST /api/admin/import/apply` snapshots first, then writes. Unsigned
  files can only change items/categories/addonGroups — settings, ordering
  and contact details are never touched. Rate limit: 5 applies/hour.
- Weekly backup: enable it in Backup → Export; every Monday the daily job
  emails the signed JSON to the verified report address and keeps 12 copies
  in R2 (`backups/`).
- Local verify: `node scripts/test-backup.mjs` (70 checks: diffs, tampered
  signatures, CSV round trip in Arabic, token single-use/expiry, restore
  safety copy, trash, autosave coalescing, unsigned-can-never-touch-contact-settings).

Production env (in addition to the report vars): `BACKUP_SECRET` (Secret,
32 random hex bytes — generate with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

---

## ⏸️ Pause, location, banner & privacy

- **Pause / closed hours:** `GET /api/ordering-state` (public, no-store)
  drives the header pill, cart status lines and the Send-button gate. The
  customer check runs at tap time (2.5 s timeout, fail-open to the
  menu-derived state); `POST /api/orders` enforces the same rule server-side
  (403 `paused`/`closed`/`disabled`). Admin: Settings > Ordering (pause
  switch + message, accept-when-closed) plus the one-tap pause bar on the
  Dashboard (`POST /api/admin/ordering/pause`, 30/60/120 min or indefinite,
  read-modify-write with retries). Note: KV caching means a change may take
  up to about a minute to reach every region — that is why the submit-time
  check exists.
- **Share location (delivery only):** tap-to-run geolocation (never on page
  load, state only, cleared after send/close), link built only from rounded
  numbers, one line in the stored order record + stored columns
  (`location_lat/lng`, NULLed by retention, never in the monthly CSV, Maps
  button in order details). Requires `Permissions-Policy: geolocation=(self)`
  in `public/_headers` (camera/mic stay disabled); no CSP change needed.
- **In-cart map picker (Leaflet + OpenStreetMap, no key):** the pin opens an
  interactive sheet — auto-detect, draggable pin, tap-to-move, Confirm fills
  the address field (Nominatim reverse lookup, empty field only) and saves
  coords. Tiles + lookup load ONLY while the sheet is open. CSP allows
  `tile.openstreetmap.org` (img) + `nominatim.openstreetmap.org` (connect);
  disclosed on the privacy page. Trade-off accepted by owner: map usage
  contacts OSM servers (see privacy page).
- **Announcement banner:** `settings.announcement` (140 chars, optional
  business-timezone window, max 365 days). Scrolling ticker with owner
  speed (1–10) + static mode; constant reading speed, pause on hover,
  hide-on-scroll. Ticker loop runs even under reduced motion (owner
  decision); entrance motion still respects it.
- **Privacy:** public page at `/privacy` (`public/privacy.html`, EN/AR
  toggle, textContent only) fed by `/api/menu` + `/api/privacy-info`
  (retention numbers never hardcoded). Owner extras + review tick in
  Settings > Privacy. Footer link + cart notice included.
- **Customer data tool** (Dashboard > Customers, needs the `orderLogging`
  plan feature): phone-digit search (masked results, LIMIT 50), actions
  anonymize/delete/export-CSV guarded by admin password + typed word
  (DELETE/حذف) + 10/hour limit, HMAC audit entries (`AUDIT_SECRET`, phone
  never stored). Migration `0005` adds `location_lat/lng` + `phone_norm`.
  Tests: `node scripts/test-status.mjs`, `node scripts/test-features.mjs`.
- README note: rows deleted via the tool may still exist inside D1's
  point-in-time recovery history for a limited period, and backups or
  exports the owner already downloaded are outside the system.

---

## White-Label Base System (sell to N clients)

This repo is a BASE SYSTEM. Backend stays unchanged per client; only `src/config/*` changes.

- `src/config/client.config.ts` (name, logo, support email), `theme.config.ts` (primary `#FFC400`, bg `#0A0A0A`), `features.config.ts` (package flags), `navigation.config.ts` (sidebar).
- `src/lib/api-client.ts` — single fetch wrapper. `src/components/ui/*` — design system. `src/features/*` — public API per domain.
- Backend SQL ONLY in `functions/_shared/**` (`repositories/*.repo.js`); routes in `functions/api/**` are thin.
- New client: `node scripts/setup-new-client.mjs "Name" "#PRIMARY" [plan]` → see `docs/ADD_NEW_CLIENT.md`. New feature: see `docs/ADD_NEW_FEATURE.md`. Architecture: `docs/ARCHITECTURE.md` + `REORGANIZATION_PLAN.md`.
