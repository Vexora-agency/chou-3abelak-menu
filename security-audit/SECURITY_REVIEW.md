# SECURITY REVIEW — 5-gap audit (2026-11-01)

Evidence-only. Every APPLIES cites real `file:line`. No code changed in
this pass except the separately-approved tamper guard (see §6).

## STEP 1 — What I found

- **Language/framework:** TypeScript + React 19.0.1 + Vite 8.3.0 + Tailwind 4
  (`package.json` deps).
- **Trusted side: PRESENT.** Cloudflare Pages Functions (`functions/api/**`,
  vanilla JS): public (`menu`, `ordering-state`, `orders`, `track`,
  `track/cancel`, `track/received`, `push-subscribe`, `invite/*`,
  `reports/confirm`, `telegram/webhook`, `internal/*`, `auth/*`) and admin
  (`/api/admin/*` behind `_middleware.js`).
- **Data lives:** server-side — Cloudflare KV (`MENU_KV`: menu doc) + D1
  (`ORDERS_DB`: orders). Browser holds only UI state (cart, prefs) + opaque
  track tokens in localStorage. No ORM; parameterized D1 `.prepare().bind()`
  (`functions/api/track.js:37-42`).
- **Identity:** hand-rolled — PBKDF2 admin password → HMAC-signed cookie
  session (`HttpOnly; Secure; SameSite=Strict`, `session.js:214-216`) with
  KV revocation (`admin/_middleware.js:49`), plus Cloudflare Access JWT
  (RS256 pinned, `admin/_middleware.js:81`) as second mechanism. Customers:
  no accounts — 128-bit track tokens are the capability (`track.js:1-7`).
- **Deploy/env:** Cloudflare Pages git integration; secrets from dashboard
  env vars (`.env.example` documents names, fake values only). Only
  `.env.example` is tracked — no `.env`/`.dev.vars` in git.
- **Not present:** Docker/CI in repo, refresh-token system (sessions are
  single HMAC tokens, 12h/30d), no WebSocket, no file uploads found.

## STEP 2 — The five gaps

### 1. SECRETS — APPLIES, verdict: PASS with one INFO

- No `VITE_*` secret reaches the client: the only `import.meta.env` uses are
  `DEV` flags (`src/config/features.config.ts:23`, `src/App.tsx:367`).
- Documented client-baked key `VITE_BOOSTHIS_PROJECT_KEY="bk_ship_..."` in
  `.env.example` is a **publishable ship key by design** (measuring only);
  nothing in `src/` reads it today (no matches for `VITE_BOOSTHIS` in code).
- Server secrets (`ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `RESEND_API_KEY`,
  `TELEGRAM_BOT_TOKEN`, `CRON_SECRET`, …) live only in `env.*` server-side;
  no matches in `src/` or `dist/`-shipped code paths reviewed.
- CANNOT VERIFY from code alone: git-history secrets (no scanner run in
  this pass — needs gitleaks on history before calling this CLOSED).

### 2. VALUES THE CLIENT SENDS — APPLIES, verdict: PASS (server re-derives)

- **Prices/totals:** `validateOrderInput` re-resolves every line against the
  live menu — "NEVER trusts client prices or names"
  (`functions/_shared/orders.js:51-55`), unknown ids/variants/add-ons
  rejected (`orders.js:106-159`), totals recomputed
  (`functions/api/orders.js:83-90`, header comment line 4:
  "client-supplied totals are ignored").
- **Quantities:** clamped to menu min/max/step server-side (validator +
  `isValidQty`); count capped 1–30 lines (`orders.js:103-104`).
- **Ordering state:** re-evaluated server-side at submit; closed/paused →
  403, client state ignored (`functions/api/orders.js:92-101`).
- **Roles/tiers:** none exist client-side (no `isAdmin`/plan sent; plan is a
  server env `SITE_PLAN`). No mass assignment surface found.
- **IDs that pick records:** order `number` is always paired with the
  128-bit `track_token` checked in SQL (`track.js:50-62`,
  `track/cancel.js:62-79`); menu item ids are validated against the live
  menu, never trusted for pricing.
- Nothing trusted-as-sent found. (Browser cart math is UX only.)

### 3. WHO MAY MAKE THE REQUEST — APPLIES, verdict: PASS, one choke point

- **Single choke point:** `functions/api/admin/_middleware.js` gates ALL
  `/api/admin/*` (cookie session with revocation check, else Access JWT,
  else 403; fails closed when unconfigured, lines 65-67). No admin route
  outside it found.
- **Public writers are capability-gated, not hidden:** `track/cancel`
  (POST, 1KB body cap, token-checked atomic flip, only fresh `new` within
  5 min — `track/cancel.js:22-79`), `track/received`, `orders` (rate
  limited), `push-subscribe` (VAPID-validated per `push.js:30`), invite
  redeem/validate (20-attempt lock, `access.js:19`), telegram webhook
  (secret header gate, `webhook.js:1-19`).
- **No user-id-from-request:** tracking derives identity from
  number+token pair; unknown pairs get identical 404s (no oracle,
  `track.js:46-48,60-62`).
- **CSRF:** state-changing admin/customer POSTs require custom header +
  Origin check (`checkApiHeaders`, enforced e.g. `login.js:55-57`); no
  state changes via GET (cancel/received/orders are POST).

### 4. WHAT THE DATA LAYER ENFORCES — APPLIES, verdict: app-enforced (by design)

- KV/D1 have no per-row rules — **all safety is application code**. Stated
  plainly as required.
- Every query reviewed is scoped: parameterized binds only (no string-built
  SQL found), order reads always add `AND track_token = ?2` or run behind
  the admin middleware.
- **Browser cannot reach the store:** no KV/D1 credentials, endpoints, or
  tokens ship in the bundle (see §1). The only client-held capabilities are
  per-order track tokens (unguessable, single-order scope).

### 5. WHAT STOPS REPETITION — APPLIES, verdict: PASS with one WEAK spot

- Login: 5 failures / 15 min per IP → 429 (`login.js:21-23,90,149`).
- Orders: 15 / 10 min per IP → 429 (`orders.js:21,118-135`, `CF-Connecting-IP`
  based — spoof-proof behind Cloudflare).
- Invites: 20 attempts + 72h TTL (`access.js:18-20`).
- Costly admin ops (import/export/resend/test/customer-action): 429-guarded
  behind auth too.
- **WEAK (not exploitable for money, but noisy):** public GETs
  (`/api/menu`, `/api/track`, `/api/ordering-state`) have NO rate limit —
  only CDN + Cache-Control in front. An hour of polling burns edge cache
  reads, not KV/D1 writes; no paid API/SMS per call exists on public
  routes (mail/Telegram are server-initiated). Belongs in hardening backlog:
  add the existing `hitRateLimit` helper (`_shared/ratelimit.js:7`) to
  `track.js`/`ordering-state.js`.

## STEP 3 — Report table (ordered)

| # | Item | Status | Evidence | If left | Fix in this stack |
|---|---|---|---|---|---|
| 1 | Prices/totions forged from browser | FINE (exploitable: no) | `_shared/orders.js:51-55`, `api/orders.js:83-90` | — | none needed |
| 2 | Admin auth bypass | FINE | `admin/_middleware.js:28-131` (HMAC+revocation, RS256 pinned, fail-closed) | — | none needed |
| 3 | IDOR on orders | FINE | `track.js:50-62`, `cancel.js:62-79` (token-gated, flat 404s) | — | none needed |
| 4 | Secrets in client | FINE | no `VITE_*` secrets in `src/`; only `.env.example` tracked | — | run gitleaks on history to close |
| 5 | XSS (stored/reflected/DOM) | FINE | zero `innerHTML`/`dangerouslySetInnerHTML` in `src/`; React escaping default | — | none needed |
| 6 | CSRF on state changes | FINE | `checkApiHeaders` + POST-only mutations | — | none needed |
| 7 | Open redirects / CORS | FINE | no redirects, no `Access-Control-*` in `functions/` | — | none needed |
| 8 | Verbose errors / stacks | FINE | no `.stack` in `functions/`; generic 4xx/503 bodies | — | none needed |
| 9 | Login brute force | FINE | 5/15min/IP → 429 | — | none needed |
| 10 | SSRF (user-URL fetch) | N/A | outbound fetches go to fixed hosts (Telegram/Resend/JWKS); map/geo fetches are client-side | — | — |
| 11 | File uploads | N/A | none found in routes or UI | — | — |
| 12 | Public-GET rate limits | FIXED 2026-11-01 | `track.js` now `checkRateLimit` 120/5min/IP → 429 (`functions/api/track.js:8-27`); both clients fail soft (`OrdersBell.tsx:50`, `TrackView.tsx:90,118`) | — | verify live 429 with a bounded loop on staging |
| 13 | History secret scan | CLOSED 2026-11-01 | gitleaks 8.28.0: 238 commits, 3.84 MB, **2 hits — both false positives** (test fixtures `'test-backup-secret-1234567890'` / `'other-secret-…'` in `scripts/test-backup*.mjs:70,78`, HMAC-mismatch test data). Raw: `raw/gitleaks.json`. npm audit prod deps: **0 vulns** (`raw/npm-audit.json`) | none | no rotation needed; keep scanner in CI backlog |

**Exploitable now:** none found. **Weak:** #12. **Fine:** rest.

## §6 — Approved tamper fix (implemented separately, 2026-11-01)

DOM price edits snap back via `src/hooks/useGuardedText.ts`
(MutationObserver restoring the React-computed text, no re-renders):
`CartBar` total, `OrderSummaryLines` grand total, `ItemDetailsModal`
header pill + Add-button total. Cosmetic layer only — enforcement stays
server-side (§2). Commit: `tamper-proof money display` (+ this report).
