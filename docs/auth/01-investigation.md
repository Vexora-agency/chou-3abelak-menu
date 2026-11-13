# Phase 1 — Repository Investigation

Status: ✅ complete (frontend, backend, and Better Auth docs research)
Last updated: 2026-11-13

---

## 1. Executive summary

- **Framework:** React 19 + Vite 8 + Tailwind CSS v4 (SPA, no SSR, no router library).
- **Hosting:** Cloudflare Pages + Pages Functions (plain ESM JavaScript in `functions/`).
- **Data:** Cloudflare D1 (`ORDERS_DB`), KV (`MENU_KV`), R2 (`REPORTS`, `MENU_IMAGES`).
- **Package manager:** npm (`package-lock.json`).
- **Language/direction:** bilingual EN/AR, full RTL, Arabic is first-class; fonts Cairo (AR) + Poppins (EN); default theme dark, default lang EN.
- **Customer auth today:** **none**. No customer account table, no customer login/signup UI, no customer session. Checkout is guest-only.
- **Existing auth:** owner/staff admin only — custom HMAC cookie sessions at `/api/auth/login|logout|session`, cookie `__Host-admin-session`, plus Cloudflare Access fallback and kitchen/client roles.
- **Menu browsing:** public. Orders: `POST /api/orders` (guest). Tracking: public token link (`/?track=...&t=...`).
- **Design system:** dark-first gold (`#FFC400`) on near-black (`#0A0A0A`), glass pills, tactile buttons, rounded 28px sheets, Cairo/Poppins, logical RTL utilities.
- **Profile icon insertion point:** `src/components/header/HeaderTopBar.tsx:57-87`, between the theme toggle (ends line 74) and the admin gear (starts line 76), using the same `glass-pill btn-tactile w-11 h-11 rounded-full` pattern.

---

## 2. Stack & tooling

| Item | Value | Evidence |
|------|-------|----------|
| UI | React 19.0.1, React DOM 19.0.1 | `package.json:99-100` |
| Build | Vite 8.3.0, `@vitejs/plugin-react` 6.1.1 | `package.json:93,101` |
| Styling | Tailwind CSS 4.3.3 via `@tailwindcss/vite` | `package.json:92,117` |
| Animation | `motion` 12.23.24 | `package.json:98` |
| Icons | `lucide-react` 0.546.0 | `package.json:97` |
| Fonts | `@fontsource/cairo`, `@fontsource/poppins` | `package.json:87-88` |
| Backend | Cloudflare Pages Functions (JS, ESM) | `functions/` |
| DB | D1 binding `ORDERS_DB`, 32 migrations (0001–0032) | `wrangler.toml:13-19`, `migrations/` |
| Local run | `serve-local.bat` → build + `wrangler pages dev ./dist --port 3000` | `serve-local.bat:5,17` |
| Dev server | `npm run dev` = Vite only, **no API** | `package.json:7`, `README.md:78-84` |
| Deploy | Cloudflare Pages git integration; dashboard owns production bindings | `wrangler.toml:1-5` |
| Tests | ~70 lightweight `scripts/test-*.mjs` with fake D1/KV/R2; no Vitest/Jest | `package.json:14-84` |
| Type check | `tsc --noEmit` (`npm run lint`) | `package.json:11` |

**No zod in root dependencies.** (Only inside `.opencode/node_modules`, not usable by the app.) If server input validation needs zod, it must be added — or reuse the existing hand-written validators (`functions/_shared/validate*.js`). Prefer existing validators to avoid a dependency.

---

## 3. Frontend architecture (confirmed)

### 3.1 Entry and routing
- Entry: `src/main.tsx:59-63`; `applyTheme()` before first render (`main.tsx:14`).
- No react-router. Manual routing in `src/App.tsx:359-391`:
  1. `/invite/<token>` → `InvitePage`
  2. `?track=N&t=<token>` → `TrackView`
  3. `/admin` + tabs → admin app (session-gated)
  4. otherwise → storefront
- Cloudflare SPA fallback only for `/admin/*` and `/invite/*`: `public/_redirects:1-8`. New `/account` route would need a rule.

### 3.2 State management
- **No React Context anywhere.** All state is lifted into `App.tsx` and prop-drilled.
- Hooks: `useAppPrefs` (lang/theme), `useAdminSaveAuth` (admin session), `useShopCartState` (cart), `useOrderingState` (open/paused).
- Persistence keys: `menu_lang_v1`, `menu_theme_v1`, `menu_cache_v3`, `cart_v1`, `cart_timestamp_v1`, `customer_orders_v1`, `customer_details_v1`, `customer_email_v1`.
- Cart expiry: 7 days (`src/config/client.config.ts:13-17`).

### 3.3 Header and theme toggle
- Header only in storefront branch: `App.tsx:517-528`.
- Header: `src/components/Header.tsx:27-113`; utility row `src/components/header/HeaderTopBar.tsx`.
- Language pill: `HeaderTopBar.tsx:30-55`; theme toggle: `57-74`; admin gear: `76-86`.
- Theme toggle exact classes: `glass-pill btn-tactile w-11 h-11 rounded-full text-[var(--primary)] flex items-center justify-center`.
- **Profile icon slot:** `HeaderTopBar.tsx:75` (between theme and admin gear). Same 44×44 glass pill; `UserRound`/`CircleUserRound` from lucide.
- Header is **not sticky**; cart bar is floating bottom (`CartBar.tsx:68-71`), orders bell floating (`OrdersBell.tsx:566-577`). Profile icon scrolls with header unless we add a floating/sticky variant later.

### 3.4 Design system (must match)
- Tokens: `src/config/theme.config.ts:8-34` — primary `#FFC400`, background `#0A0A0A`, surface `#141414`, border `#262626`, muted `#8A8A8A`, radius 0.75rem.
- CSS vars: `src/styles/base.css:1-12`.
- Fonts: Poppins default, Cairo under `[dir="rtl"]` (`base.css:14-16,39-41`).
- Core classes: `.btn-tactile`, `.glass-pill` (no backdrop-filter), `.btn-glass`, `.btn-primary-shine`, `.edge-line*` (`src/styles/components.css`).
- Focus: 3px solid `var(--primary)` (`base.css:57-60`); iOS 16px input rule (`base.css:94-98`).
- RTL: logical utilities `ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`; `dir` set on `<html>` in `useAppPrefs.ts:45-51`.
- i18n: inline `isAr ? '...' : '...'`; bilingual data via `pickLangText`; per-feature string tables exist (admin login, invite).

### 3.5 Checkout / order flow
- Cart hook: `src/features/cart/hooks/useShopCartState.ts`.
- Checkout hook: `src/features/cart/hooks/useCartCheckoutSubmit.ts`; `sendOrder()` at `211-402`.
- API: `POST /api/orders` via `publicPostRaw` (`src/features/cart/services/cart.api.ts:34-115`).
- Payload: name, phone, address, optional email, items, notes, idempotency key, location/pin (`cart.api.ts:6-24`).
- **No auth header/session today. Guest checkout only.**
- Success: cart drawer success screen (`CartDrawer.tsx:202-244`) with track link.
- Order history today: 12h local shelf `customer_orders_v1` + `OrdersBell` (`src/features/track/components/OrdersBell.tsx:566-700`). Not server-side.

### 3.6 Reusable UI for auth
- `src/components/ui/Modal.tsx:5-17` (minimal, z-70).
- Cart drawer shell (bottom sheet mobile / centered desktop): `CartDrawer.tsx:134-166` — best pattern for auth sheet.
- Admin login fields: `src/features/admin/components/admin-login/loginStyles.ts` + `loginForm.tsx`.
- Signup/password pattern: `src/features/invite/components/InviteForm.tsx:90-233` (show/hide, caps warning, policy checklist, error box).
- Body scroll lock: `src/hooks/useBodyScrollLock.ts:29-31`.
- No toast system; use inline `role="alert"`.

---

## 4. Existing auth and admin area

- Admin cookie auth: `functions/_shared/session.js` (PBKDF2 + HMAC), cookie `__Host-admin-session`, `SameSite=Strict`, `Secure`, `HttpOnly`.
- Endpoints: `functions/api/auth/login.js`, `logout.js`, `session.js`.
- Admin middleware: `functions/api/admin/_middleware.js` — cookie session first, Cloudflare Access JWT fallback, kitchen role gate; fails closed 403.
- Admin UI: `/admin` route, `AdminLogin.tsx`, `useAdminSaveAuth.ts`; `whoami` role probe.
- **Admin area is owner/staff-only and separate from customer auth.** No admin signup path. Customer auth must not touch it.
- `/api/auth/*` prefix is currently owned by admin login/logout/session. Better Auth also needs `/api/auth/*`. **Route coexistence strategy is a Phase 2 design point** (catch-all specificity vs moving admin routes).

---

## 5. Backend, data model, env, rate limiting

### 5.1 Runtime and bindings

| Item | Value | Evidence |
|------|-------|----------|
| Runtime | Cloudflare Pages Functions, ESM JavaScript | `functions/` |
| Node compat | `nodejs_compat` enabled locally; production must mirror it in the Pages dashboard | `wrangler.toml:7-11` |
| Compatibility date | `2025-06-01` in `wrangler.toml` (local tooling only) | `wrangler.toml:6` |
| D1 | binding `ORDERS_DB`, database `chou-3abelak-orders` | `wrangler.toml:13-19` |
| D1 preview | `chou-3abelak-orders-preview`, separate id | `wrangler.toml:47-51` |
| KV | `MENU_KV` (menu cache, flags) | `wrangler.toml:21-25` |
| R2 | `REPORTS`, `MENU_IMAGES` | `wrangler.toml:27-40` |
| Local run | `serve-local.bat` → build + `wrangler pages dev ./dist --port 3000` | `serve-local.bat` |
| Deploy | Cloudflare Pages git integration; dashboard owns production bindings | `wrangler.toml:1-5` |

**Important:** production bindings and compatibility flags are configured in the Cloudflare dashboard, not read from `wrangler.toml`. Any new flag/date needed by Better Auth must be mirrored there by the owner.

### 5.2 Existing auth (admin/staff only)

- `functions/_shared/session.js`:
  - PBKDF2-SHA-256 password hashing, format `pbkdf2$<iterations>$<saltB64>$<hashB64>`.
  - `MIN_PBKDF2_ITERATIONS = 50000`; current hashes use 260,000.
  - HMAC-signed session cookie `__Host-admin-session`, `Path=/; HttpOnly; Secure; SameSite=Strict`.
  - Timing-safe compare and a dummy PBKDF2 path for unknown users.
- Endpoints:
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/session`
- Admin middleware `functions/api/admin/_middleware.js`:
  - Admin cookie first, Cloudflare Access JWT fallback.
  - Kitchen/client role gate; fails closed with 403.
- Admin UI: `/admin`, `AdminLogin.tsx`, `useAdminSaveAuth.ts`.
- **No customer accounts, no customer sessions, no signup.** Customer auth is a separate system.

**Coexistence:** the three admin routes are exact static files. A Better Auth catch-all at `functions/api/auth/[[all]].js` is lower specificity, so the admin routes keep winning. This must be verified live in Phase 2; fallback is moving admin routes to `/api/admin-auth/*`.

### 5.3 Orders data model

`orders` (after migrations 0001–0032):

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Internal id |
| `number` | INTEGER UNIQUE | Human order number |
| `idem_key` | TEXT UNIQUE | Global idempotency key |
| `created_at`, `updated_at` | TEXT | ISO timestamps |
| `status` | TEXT | `new`, `confirmed`, `completed`, `cancelled` |
| `type` | TEXT | `delivery`, `pickup`, `dinein` |
| `customer_name`, `customer_phone`, `customer_address`, `customer_table` | TEXT nullable | PII, nulled by retention |
| `notes` | TEXT | Customer notes |
| `items_json` | TEXT | Line items snapshot |
| `subtotal`, `delivery_fee`, `total` | INTEGER | Minor currency units |
| `lang` | TEXT | `en` / `ar` |
| `pii_purged_at` | TEXT | Set when PII is nulled |
| `track_token` | TEXT | Capability token for public tracking (added later) |
| `sent_via`, `parent_number`, etc. | various | Notification/linking metadata |

**No `user_id` / `customer_user_id`.** Orders are guest-only. Linking requires an additive migration (Phase 3).

Other relevant tables: `rate_counters` (atomic per-key rate limits), `phone_blocks` (abuse), `invites`, `settings`, `versions`, `reports`. None are customer accounts.

### 5.4 Migrations

- Plain SQL files `migrations/NNNN_name.sql`, applied in filename order.
- 32 applied migrations: `0001`–`0032`. Next free number: **0033**.
- Conventions in `migrations/README.md`: additive first, table rebuild only when SQLite requires it, indexes in the same file.
- Local apply: `npx wrangler d1 migrations apply chou-3abelak-orders --local`.
- Remote apply is owner-run only, after a backup.
- Better Auth's D1 adapter cannot be reached by the CLI (D1 is Worker-only), so the schema is generated programmatically with `getMigrations()` and committed as SQL.

### 5.5 Environment variables today

From `.dev.vars.example` and code:

- `ALLOW_LOCAL_DEV`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`
- `SITE_PLAN`, `RESEND_API_KEY`, `MAIL_FROM_DOMAIN_EMAIL`, `REPLY_TO`, `SITE_URL`
- `CRON_SECRET`, `PII_RETENTION_DAYS`, `ORDER_RETENTION_MONTHS`, `REPORT_RETENTION_MONTHS`
- `BACKUP_SECRET`, `AUDIT_SECRET`
- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `VITE_SENTRY_*`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`

New names for customer auth: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. No overlap with existing names; `SESSION_SECRET` must not be reused.

### 5.6 Existing rate limiting

- `rate_counters` table with atomic UPSERT (migration 0027).
- Per-IP order cap (15 / 10 min) and per-phone caps.
- KV-based counters elsewhere.
- **No general auth rate limiter.** Better Auth will add its own `rateLimit` table; do not reuse `rate_counters` (different key shape and semantics).

### 5.7 Headers / CSP

`public/_headers`:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`
- CSP: `default-src 'self'`; `connect-src 'self'` plus map/translate/Sentry hosts; `img-src 'self' data: blob: https://tile.openstreetmap.org`; `frame-ancestors 'none'`; `base-uri 'none'`; `form-action 'self'`.
- `/admin*` and `/invite*` get `no-store` + `noindex`.

Implications:

- Same-origin `/api/auth/*` fetch is already allowed by `connect-src 'self'`.
- Google OAuth is a top-level redirect, not a fetch; no CSP change.
- Google avatars need `https://lh3.googleusercontent.com` in `img-src` **only if** we render them.
- `/account` should get `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.

### 5.8 Test harness

- ~70 `scripts/test-*.mjs` files, run with `node` or `tsx`.
- Fake D1/KV/R2 objects, no network.
- `npm run lint` = `tsc --noEmit`.
- `npm run test:all` is long; Phase 2 runs targeted tests + lint, Phase 6 runs the full suite.

### 5.9 Deployment and preview

- Git integration: push to the configured branch → Pages build.
- Preview environment has separate D1/KV/R2 resources (`wrangler.toml:42-63`).
- Preview hostnames are per-deployment unless a stable branch alias is configured. `BETTER_AUTH_URL` needs a **stable** origin, so the owner must confirm one (D4).
- Dashboard must have `nodejs_compat` and a compatibility date/flags combination that provides `node:crypto` scrypt. The local benchmark succeeded with `2026-08-04`; verify the production value in Phase 2 and raise it if scrypt is missing.

---

## 6. Better Auth docs research

Source of truth: <https://better-auth.com/docs> (checked 2026-11-13). Pinned version: **1.7.23**.

### 6.1 Installation and D1

- `better-auth` is the runtime package; `auth` is the current CLI package (`@better-auth/cli` is deprecated).
- Native D1 support since 1.5: pass the binding directly.
  ```js
  betterAuth({ database: env.ORDERS_DB })
  ```
- Built-in Kysely adapter; no Drizzle/Prisma/Kysely package needed.
- `getMigrations(auth.options)` from `better-auth/db/migration` works with the built-in adapter, including D1. It returns `{ toBeCreated, toBeAdded, runMigrations }`; `compileMigrations()` produces the SQL. This is how we generate `0033_better_auth.sql` without CLI access to D1.
- `advanced.database.validateSchema` checks tables/columns on first use and reports fixes.

### 6.2 Mounting on Cloudflare Pages

- Better Auth handler is a standard `Request → Response` function.
- Pages Functions catch-all `functions/api/auth/[[all]].js` with `onRequest` is the correct mount. (Cloudflare uses `[[name]]`, not Next.js's `[[...name]]`.)
- Create the instance per request so `env` is available.
- `advanced.backgroundTasks.handler: waitUntil` can defer email sends/cleanup, but it also makes rate-limit writes eventual; do not enable it globally. Use `waitUntil` inside the Phase 5 email callbacks instead.

### 6.3 Core schema

`user`, `session`, `account`, `verification`, plus `rateLimit` when `rateLimit.storage: "database"`.

- Passwords live in `account.password` with `providerId = "credential"`.
- Session fields include `token`, `expiresAt`, `ipAddress`, `userAgent`, `userId`.
- OAuth tokens live in `account`; `account.encryptOAuthTokens: true` encrypts them.

### 6.4 Email/password

- `emailAndPassword.enabled: true`.
- Defaults: min 8, max 128, `autoSignIn: true`, no email verification.
- `autoSignIn: false` (or `requireEmailVerification: true`) activates signup email-enumeration protection: existing and new emails get the same 200 response.
- Custom password hashing is an official option: `emailAndPassword.password.hash/verify`.
- Reset password needs `sendResetPassword`; verification needs `sendVerificationEmail`. Both are Phase 5.
- `revokeSessionsOnPasswordReset: true` is available.
- Built-in hashing is **scrypt** (`@better-auth/utils/password`), native on workerd in 1.7.23.

### 6.5 Sessions and cookies

- `session.expiresIn` default 604800 s (7 days); `updateAge` default 86400 s (1 day).
- `session.cookieCache` default disabled; enabling caches the session in a signed cookie for a short time (revocation lag).
- Cookie attributes configurable via `advanced.defaultCookieAttributes`, `advanced.cookies`, `advanced.cookiePrefix`.
- `advanced.useSecureCookies` forces `Secure`; needed because `NODE_ENV` is unset on Pages.
- SameSite Lax is required for the Google OAuth callback.
- `advanced.disableCSRFCheck` and `advanced.disableOriginCheck` must stay `false`.

### 6.6 Rate limiting

- Defaults in production: 10 s window, 100 requests; disabled in development unless `enabled: true`.
- Default storage is memory (per isolate) — unsuitable for Pages.
- `storage: "database"` uses the `rateLimit` table; `modelName` defaults to `rateLimit`.
- `customRules` per path; `false` disables a path (e.g. `/get-session`).
- Client IP from `advanced.ipAddress.ipAddressHeaders`; Cloudflare sets `cf-connecting-ip`.
- 429 responses include `X-Retry-After`.

### 6.7 Google OAuth

- `socialProviders.google.{clientId, clientSecret}`.
- Default scopes are sufficient (`openid email profile`); can pass `scope` explicitly.
- Redirect URI is `<baseURL>/api/auth/callback/google`.
- `prompt: "select_account"` avoids silent account switching.
- Account linking is on by default; `requireLocalEmailVerified` defaults to true, so an unverified password account is not silently linked to Google.
- Do not add Google to `trustedProviders` for this project.

### 6.8 Base URL and trusted origins

- `baseURL` can be a static string or a dynamic object with `allowedHosts` (supports wildcards).
- The owner requires **no wildcard origins**, so we use a static `BETTER_AUTH_URL` and an exact `TRUSTED_ORIGINS` list.
- Request inference is explicitly discouraged by the docs.
- `trustedOrigins` accepts exact origins; wildcard support exists but is not used.

### 6.9 Cloudflare gotchas

- `NODE_ENV` is not set on Pages → set `rateLimit.enabled` and `useSecureCookies` explicitly.
- Memory rate-limit storage does not work across isolates → use D1.
- D1 has no interactive transactions; Better Auth's D1 path is designed for it. Password reset with session revocation is documented as weaker without transactions (Phase 5 note).
- Native crypto wall time is high (see §7); Free CPU limits are the main risk.
- Production compatibility date must support `node:crypto` scrypt; mirror the local flag/date in the dashboard.

---

## 7. Risks / constraints to resolve in the plan

1. **`/api/auth/*` collision** with existing admin auth routes — mitigated by Pages route specificity; verify live in Phase 2.
2. **Password hashing CPU cost** — measured in workerd: scrypt 115–144 ms, PBKDF2 100k 123 ms, PBKDF2 260k 278 ms. Free plan is 10 ms CPU; native crypto may not be fully billed (existing admin 260k works), but preview must prove it.
3. **PBKDF2 Free cap** — Cloudflare Free rejects WebCrypto PBKDF2 above 100,000 iterations (reported 2026-10-06). The existing admin login uses 260k, so it may already be at risk on Free. Out of scope to change, but the owner must know.
4. **D1 adapter choice** — native D1 binding (`database: env.ORDERS_DB`), no adapter package.
5. **D1 migrations** — plain SQL, local first, owner runs remote after backup.
6. **Guest checkout** — decision D2 affects `POST /api/orders` and order linking.
7. **Order linking migration** — nullable `customer_user_id`, additive, no backfill; owner approval D5.
8. **Trusted origins** — need the real production domain and a stable preview host; no wildcards (D4).
9. **Email provider** — Phase 5; Resend free tier is already integrated for reports.
10. **No customer tables** — Better Auth adds `user`, `session`, `account`, `verification`, `rateLimit`.
11. **No zod** — reuse existing validators and a small auth-specific validator module.
12. **Production compatibility date/flags** — must support `node:crypto` scrypt and `nodejs_compat`; dashboard-owned, owner must mirror.
13. **Signup enumeration** — `autoSignIn: false` gives the documented equal-response protection; decision D7.
14. **Google account linking** — default `requireLocalEmailVerified` blocks silent linking to unverified password accounts; Phase 5 verification resolves it.
15. **Session revocation lag** — avoid `cookieCache` so logout/revocation is immediate.
