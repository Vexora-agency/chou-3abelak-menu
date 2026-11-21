# agent.md — Project memory (Chou 3abelak menu)

> Read this file first when the owner says "the email setup", "monthly
> reports", or asks to continue pending work. No secrets in this file —
> real values live only in `.dev.vars` (local, gitignored) and the
> Cloudflare dashboard (production).

## What this is
- Restaurant menu + WhatsApp ordering (Arabic-first, RTL, EN/AR).
- Stack: React + Vite + Tailwind + motion/react + GSAP/ScrollTrigger + Lenis
  + Cloudflare Pages Functions + D1 (`ORDERS_DB`) + R2 (`REPORTS`) + KV (`MENU_KV`).
- Repo: `Vexora-agency/chou-3abelak-menu`, branch `main`.
- Local dev: `serve-local.bat` → `http://localhost:3000` (site + API, one
  port). Admin at `/#admin` (cookie session login; test login lives in
  untracked `.dev.vars`).
- Owner's domains: `vexora.agency` (Resend sending domain, **verified**),
  Zoho for receiving (`info@vexora.agency`).

## Done: premium motion layer (site-wide)
- `src/lib/motion/` = boot (`index.ts`), Lenis singleton (`smoothScroll.ts`),
  reveal IO + MutationObserver (`reveal.ts`), lazy GSAP/ScrollTrigger layer
  (`gsapLayer.ts`). Booted once from `main.tsx` before React's first commit.
- `src/components/motion/` = React Bits-style primitives written in-house
  (React Bits is not an npm package): `Reveal`, `SplitText` (word-level only
  for Arabic joining), `CountUp`, `useMagnetic` (fine pointers only).
- Owner decision: motion is FORCED for every visitor — no reduced-motion or
  battery-saver gate (`respectReducedMotion: false`, no CSS media query).
- Lenis stays native on the wheel/trackpad (`smoothWheel: false`) and is used
  only for programmatic chip/back-to-top scrolls. Touch stays native (iOS
  momentum + body-lock contract). Every sheet/admin modal scroller carries
  `data-lenis-prevent`.
  `useBodyScrollLock` pauses/resumes Lenis and re-seats it on the restored y.
  NEVER set `autoToggle: true`: its `stop()` writes `overflow: clip` on
  `<html>` and `start()` waits for a discrete transitionend that mobile
  browsers can miss, leaving the whole page unscrollable. Manual
  stop()/start() is symmetric only with autoToggle OFF, and the Lenis
  `.lenis-stopped { overflow: clip }` rule must stay deleted. Boot also clears
  any stale inline `html` overflow as a safety net.
- GSAP is opt-in: `initGsapLayer()` is called only when a `data-gsap-*`
  target exists. Nothing on the storefront uses one today, so the
  113 kB GSAP+ScrollTrigger pair is never requested; the layer remains ready
  for a future small accent. `refreshMotionRuntime()` runs on menu version.
- Cart premium pass: neutral `Email updates` card (gold accent, no solid
  yellow block) and an in-card `Create an account` row inside the selected
  COD surface (replaces the amber-on-amber warning box). The member
  "name/phone/email come from your account" note was removed, and the
  remember-details checkbox now renders for members too.
- Location pin/address pairing: `handleMapPick` ALWAYS rewrites the address
  with `pinAddress(lat,lng,geocode)` (reverse geocode, or coords fallback).
  Typing after a pin refines that same pin, but a new pin can never inherit
  the previous pin's manual text — that created old-text + new-coords tickets.
  Pure rule + tests in `scripts/test-remember-pin.mjs`.
- Member settings (`Account → Settings`): the default address is editable on its
  own; the map pin is OPTIONAL and only sharpens the kitchen ticket. A new pin
  always rewrites the text (`pinAddress`), so a fresh pin never inherits old
  text. The profile gate (client `isProfileComplete` + server
  `validate-auth.js` + `/api/orders`) requires phone + address only — never a
  pin — so a member can order from outside or from a one-off place by typing
  the address in the cart. Guarded by `scripts/test-cart-isolation.mjs` and
  `test-auth-profile-policy`.
- Cart location card: the map pin is optional and **silent** — by owner request
  the green default-address note and the "Location pinned" title were removed,
  including the `hasDefaultAddress` prop; the Settings pin note was removed too
  (the Change-pin button remains). The pin button and the distance line remain.
  Map-pin buttons in both address fields are physically right (`right-0.5` +
  `pr-12`), so Arabic RTL shows them on the right as the owner expects. Guarded
  by `test:cart`.
- Cart phone is editable for members and EVERY number must be verified before
  ordering — the saved number, a changed number, and the first one. A compact
  note under the field shows `Verified` / `Not verified` and opens the reverse
  WhatsApp sheet; "استخدم رقم حسابي" resets to the saved number. The member
  NAME stays read-only. The server refuses the order on the exact entered
  number (`phone_verification_required`), never on the saved profile number.
  The old "طلبك مرتبط بحسابك تلقائيًا." line in the COD card is removed on
  purpose — do not re-add it. Guarded by `test:cart` + `test:phone`.
- Member wishlist (migration `0041_customer_wishlist`): one membership-scoped
  set of saved dishes, item-level (`user_id + item_id` PK, cascade on account
  delete, 200-item cap). `WishlistProvider` (storefront root) fetches once per
  signed-in user and toggles optimistically; `WishlistButton` renders only for
  members, with a gold spring + particle burst, `aria-pressed` and a
  dish-specific label. Hearts ride all five menu layouts, the featured
  carousel and the item sheet (a bare heart in the sticky header beside Close,
  with the item title compact and the price under it). The `list` layout is a
  compact photo card (single centered column) with a bare heart and an
  icon-only gold add/stepper in a narrow action column. `AccountSheet` tabs
  are now **My orders · Wishlist · Settings** (`grid-cols-3`); saved rows show
  photo/name/price/options and open the dish after closing the sheet. Guests
  and admin previews (no provider) see no hearts. API:
  `GET/POST/DELETE /api/account/wishlist` (session + customer CSRF, user id
  never client-supplied). Guarded by `test:wishlist`; full notes in
  `docs/WISHLIST.md`.
- Reverse WhatsApp phone verification (migrations `0037_phone_verifications`,
  `0038_whatsapp_webhook`, `0039_phone_verification_lang`): the site mints a
  6-digit code bound to member + normalized number (5-minute TTL; only a keyed
  hash is stored; a short `Ref` is shown for matching), the member sends the
  pre-filled message FROM that number to the business WhatsApp, and the **Cloud
  API webhook auto-approves it**: `POST /api/whatsapp/webhook` verifies
  `X-Hub-Signature-256` over the raw body, claims the Meta message id once,
  matches the code against the live pending row for the sender, approves it
  (`decided_by='whatsapp'`), and replies with a free-form service message in the
  member's site language (`phone_verifications.lang`): success `✅ تم تأكيد رقمك
  بنجاح…` or `❌ كود خاطئ…`. The success copy is deliberately generic (no
  "continue your order") because verification can happen in Account Settings.
  **No Telegram notification for verification** (owner asked); the manual
  pending list in `Admin → Customers → Accounts` stays as the fallback. An
  approval lasts 365 days. Routes: `/api/account/phone-verification` (POST
  request/GET status, session + customer-CSRF, 60 s cooldown, 5/hour + 15/day
  caps), `/api/admin/phone-verifications` (pending list + approve/reject; the
  code is never returned to admin), `/api/whatsapp/webhook` (GET challenge +
  signed POST). Order + profile gates: `orders.js` verifies `c.phoneNorm`;
  `profile.js` saves a changed number **without gating** it, so the order route
  is the single verification gate (saving is fast; ordering requires approval). Secret:
  `PHONE_VERIFICATION_SECRET` if set, else `SESSION_SECRET`. WhatsApp env:
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID` (optional `WHATSAPP_VERIFICATION_NUMBER` for a
  dedicated API number, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_REPLY_MONTHLY_CAP`).
  Replies are capped at 900/month by default to stay inside Meta's 1,000 free
  service messages per business number per month (post-Oct-2026 pricing);
  approvals never depend on the reply cap. Client: `usePhoneVerification` +
  `PhoneVerificationSheet` (large code, copy, live countdown, pre-filled
  `wa.me`, 4 s polling). No WhatsApp? The sheet reveals **Need help? → Send SMS
  code** (or after 60 s); UniMTX sends the OTP, the member types it, and the
  server verifies it (`decided_by='sms'`, migration `0040`, env
  `UNIMTX_ACCESS_KEY_ID`/`UNIMTX_ACCESS_KEY_SECRET`). There is **no reliable
  WhatsApp pre-check**; behaviour-based routing keeps SMS charges for
  non-WhatsApp members only. Setup/pricing:
  `docs/WHATSAPP_VERIFICATION.md`, `docs/SMS_VERIFICATION_UNIMTX.md`, and the
  Arabic walkthrough `docs/WHATSAPP_CLOUD_API_SETUP_AR.md`. **Apply
  0037/0038/0039/0040 remotely BEFORE the reading code deploys.** Tests:
  `test:phone` + `test:whatsapp` + `test:sms`.
- Address precedence (cart → kitchen): the manually written cart address is
  what the kitchen receives. `functions/api/orders.js` overrides member
  name/email from the account and keeps the ENTERED verified phone (it no
  longer stamps the profile phone), only backfilling `address` when the
  submitted address is empty, so a refined per-order address always wins over
  the saved default. The pin is OPTIONAL and is only the map point
  (`location_lat/lng`): a text-only order is valid, and the kitchen then
  searches the written address. `functions/_shared/telegram.js` prints the
  exact pin only at `accuracy <= 250 m`; without a pin it falls back to the
  address text. Do NOT add a customer-facing "text vs pin" helper under the
  address field — the owner asked for no message there. No new geocoder
  library: Nominatim reverse-geocode + BigDataCloud zone check cover the need.
  Guarded by `test:cart`.
- Add-to-cart landing (one-shot, `agent.md` motion contract): every add still
  opens the cart drawer immediately, so the "jump" is the drawer's spring
  entrance. `App.tsx` then names the exact row that grew (diff gated on a real
  add — boot, stored-cart cleanup and in-drawer stepper taps never fake it),
  `CartDrawer` scrolls that row into view inside its own scroller, and
  `CartLinesList` plays a gold ring/tint on it. The qty chip, cart-bar badge
  and +→stepper transitions each pop once via keyed remounts. CSS only
  (opacity/transform, no library, no infinite loops, no retained fill layers).
  Guarded by `test:cart`.
- Phone country gate: `src/utils/phoneCountry.ts` derives the restaurant dial
  code from the admin WhatsApp picker (fallback: restaurant phone). Cart and
  Account Settings render a fixed `+code` prefix, normalize national numbers
  to full international, and reject explicit foreign numbers ("not
  supported"). The server mirrors the gate in `functions/_shared/dial-codes.js`
  + `orders.js` (`unsupported_phone_country` for long foreign numbers).
  Tests: `test:remember-pin` (51 checks).
- Auth/account sheets share a 520 px width, fixed responsive heights
  (`h-[min(88dvh,...)]`), sticky headers, and a scroller reset on tab change so
  Orders/Settings and Sign in/Create account never jump in size. Settings/Login
  country hints are part of the same frame.
- Desktop performance pass (owner complaint: heavy scroll / slow start):
  - Lenis runs with `smoothWheel: false`: native wheel/trackpad, no added
    latency. Lenis remains for programmatic chip/back-to-top scrolls and is
    initialised on idle, after first paint.
  - GSAP is opt-in: the runtime only imports it when a `data-gsap-*` target
    exists. No storefront element uses one, so the 113 kB GSAP+ScrollTrigger
    pair is never requested.
  - Reveals are opacity/translate/scale only (no filter/blur, no
    backface-visibility); the reveal observer watches childList only and never
    reads getBoundingClientRect synchronously.
  - `useHeaderMotion` skips redundant transform writes after scrollY 320.
  - Featured autoplay pauses offscreen; the announcement marquee pauses when
    the bar slides away; the featured card width is measured on idle.
  - The logo reveal still plays on EVERY open/refresh (owner decision) and has
    no Skip button. It is the pre-existing 6 s canvas intro; the rest of the
    page does not wait on it.
- Image/LCP/TBT pass:
  - Intro logo: the effect from the old `6ade9148` deployment is restored —
    alpha-keyed logo frames (the original keying) plus the **gold/gray steam &
    ember particle system**. A worker owns TWO OffscreenCanvases: the logo walks
    the 4×9 alpha AVIF sheets at 24 fps, the smoke canvas draws the old exact
    particles at 60 fps and is `mix-blend-mode: screen` over the header. Zero
    per-frame work on the main thread; no video/autoplay dependency. The
    488-byte frame-0 poster covers the load gap.
  - Fallback when OffscreenCanvas is unavailable: the CSS `background-position`
    walk for the logo (no particles). The static final logo is the last resort.
  - Intro hand-off: the static logo appears instantly UNDER the fading stage
    (stage fades out 700 ms). Do not cross-fade both layers — identical logos
    at complementary opacity dip in brightness (the old "pulse").
  - Header parallax: brand block drifts 46 px over the first 320 px of scroll,
    but ONLY after `engineDone`. A transform on the brand block is a stacking
    context and would isolate the smoke canvas's screen blend during the intro;
    the hook enables it once the stage is `display:none`. The glow parallax is
    always on.
  - Menu sections mount progressively (one section, then one every 700 ms);
    filters show all matching sections immediately. This keeps the 6 s intro
    free of the 30-card mount long task.
  - Click-driven sheets (item/cart/auth/account) are prefetched at idle after
    8 s so their first open is instant; they mount only while open.
  - Round menu cards must NOT use `content-visibility`/paint containment: their
    SPICY/NEW/TOP badges intentionally protrude outside the card and get
    clipped. They use `contain: layout style` only.
  - The customer entry MUST NOT import `motion/react`: header rise, card/
    carousel reveals, section bars, theme icon, announcement entrance and lang
    pill are CSS (`rise-in`, `[data-motion-reveal]`, `section-bar-in`,
    `ann-icon-in`, `ann-enter`). Motion is only in lazy admin/auth/cart chunks.
  - `/api/menu` is fetched by an inline head script (`window.__MENU_PREFETCH__`)
    before the bundle; `useMenuLoader` reuses that exact promise. The first
    featured photo preloads from the parsed JSON; eager images skip the shimmer
    fade. Carousel autoplay waits 8 s so it never moves the LCP card.
  - `logo-final-640.webp` added for DPR2 phones (29 KB vs 48 KB).
  - Upload/recompress quality is now full 0.70 / variants 0.62; existing
    internal menu photos need ONE admin run of Settings → Recompress Old Photos
    to apply it (R2 objects are immutable; code cannot rewrite them).
  - Carousel first measure, Lenis init/resize and reveal rect reads are
    deferred off the commit frame to remove forced reflow.
  - Sentry is admin-route only (`main.tsx`) and imports `@sentry/browser`; never
    initialize it on the customer storefront.
  - Cart/auth/account/item sheets mount only while open; menu cards use
    `content-visibility: auto`; `features/orders` barrel must not be imported
    by the storefront (it re-exports the admin dashboard + motion).

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
- STANDING OWNER INSTRUCTION (Oct 2026): after finishing a work batch,
  ALWAYS commit + push to `main` without being asked. Stage task files
  only; never commit secrets, `.dev.vars`, or local-only ids
  (`wrangler.toml` database_id).
