# Phase 1 — Implementation Plan

Status: ✅ Phase 1 approved; Phase 2 implemented, deployed to production, and verified (see `03-phase-2-report.md`).
Last updated: 2026-11-13
Companion docs: `01-investigation.md` (repo facts), `README.md` (phase tracker)

> **بالعربي باختصار:** الخطة بتضيف تسجيل دخول/إنشاء حساب للعملاء
> (إيميل + باسورد، وبعدين جوجل) على Cloudflare Pages باستخدام Better Auth
> و D1. المنيو يفضل مفتوح للكل. الحساب مطلوب بس للطلبات المحفوظة،
> بيانات الحساب، وسجل الطلبات. مفيش أي كود إنتاج هيتكتب قبل موافقتك على
> الخطة والأسئلة في آخر الملف.

---

## 1. Scope

### In scope (phases 2–6)

- Customer signup / login / logout with email + password.
- Google sign-in (Phase 4).
- Server-side session helper for Pages Functions.
- Customer account page: profile summary + order history.
- Link new orders to the signed-in customer (Phase 3, after approval).
- Rate limiting, security headers, password reset, email verification (Phase 5).
- Local D1 migrations + owner-run production runbook (Phase 6).

### Out of scope (unless the owner asks later)

- Migrating or changing the existing admin/staff auth.
- Social providers other than Google.
- Two-factor auth, passkeys, magic links, phone OTP.
- Customer account deletion / data export (can be added later).
- Native mobile apps.
- Paid Cloudflare plan, paid auth providers, paid email providers.

### Non-negotiable behaviour

- Menu, cart, tracking link, and invite pages keep working without login.
- Guest checkout stays available **unless the owner chooses otherwise** (D2).
- Existing admin routes, cookies, and roles are untouched.
- No secret is ever committed or printed in logs.

---

## 2. Pinned versions (and why)

| Package | Version | Why |
|---------|---------|-----|
| `better-auth` | **1.7.23** (exact, no `^`) | Latest stable on 2026-11-13. Native D1 support, dynamic config fixes, current security patches. Pinning avoids a surprise breaking change between phases. |
| `auth` (CLI) | **not installed** — run `npx auth@1.7.23` only if a schema check is ever needed | `@better-auth/cli` is deprecated. The CLI cannot reach D1, and schema generation uses the official `getMigrations()` API inside the Worker, so a permanent devDependency would be unused. |

Deliberately **not** installed:

- `better-auth-cloudflare` (community package) — native D1 is simpler, official, and one less supply-chain dependency.
- `drizzle-orm`, `kysely`, `kysely-d1` — Better Auth's built-in Kysely adapter talks to the D1 binding directly (`database: env.ORDERS_DB`).
- `better-auth/minimal` — we need the full handler, OAuth, and rate limiting.
- `zod` — reuse the project's hand-written validators; no new dependency for Phase 2.

Upgrade rule: a version bump is a separate change with its own test pass, never mixed into a feature phase.

---

## 3. Architecture

### 3.1 Request flow

```
Browser (React SPA)
  │  fetch('/api/auth/...', credentials: 'include')
  ▼
Cloudflare Pages Function
  functions/api/auth/[[all]].js   ← Better Auth catch-all
  │   createAuth(env, request, waitUntil)
  │   auth.handler(request)
  ▼
Better Auth 1.7.23
  │   built-in Kysely adapter
  ▼
D1 binding ORDERS_DB  (user, session, account, verification, rateLimit)
```

Protected customer APIs use the same factory:

```
GET /api/account/orders
  → requireCustomer(request, env)
  → auth.api.getSession({ headers: request.headers })
  → 401 if no session, else query orders WHERE customer_user_id = session.user.id
```

The catch-all wraps every auth response with `Cache-Control: no-store` (auth payloads and `Set-Cookie` must never be cached by a browser or proxy).

### 3.2 Why a per-request auth factory

Cloudflare Pages bindings (`env.ORDERS_DB`, secrets) only exist inside a request. Reading them at module import time is undefined and breaks local/preview/production differences. Therefore:

- `functions/_shared/auth.js` exports `createAuth(env, request, waitUntil)`.
- Every entry point calls it once per request.
- No top-level `betterAuth({...})` singleton, no top-level `env` access.
- The factory reads `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `TRUSTED_ORIGINS`, and Google credentials from `env`.

### 3.3 Route coexistence with admin auth

`functions/api/auth/` already contains exactly three static files:

- `login.js`
- `logout.js`
- `session.js`

Cloudflare Pages routing is specificity-based: an exact static route wins over a catch-all. Adding `functions/api/auth/[[all]].js` therefore leaves the three admin endpoints working, while every other `/api/auth/*` path (sign-up, sign-in, callback, get-session, sign-out, …) goes to Better Auth. The repo already uses this pattern at `functions/api/images/[[path]].js`.

Verification in Phase 2:

1. `POST /api/auth/login` still hits the admin handler.
2. `GET /api/auth/session` still returns the admin session shape.
3. `GET /api/auth/get-session` returns the customer session (Better Auth).
4. `POST /api/auth/sign-out` hits Better Auth.

If Cloudflare's live routing disagrees with the documented specificity, fallback plan: move admin endpoints to `/api/admin-auth/*` and update the three frontend callers. That is a small, contained change — but we only do it if the live test fails.

### 3.4 Client and server modules

| File | Purpose |
|------|---------|
| `functions/_shared/auth.js` | `createAuth(env, request, waitUntil)` — the only place `betterAuth()` is called |
| `functions/api/auth/[[all]].js` | Catch-all handler: `onRequest = ({ request, env, waitUntil }) => createAuth(...).handler(request)` |
| `functions/_shared/auth-session.js` | `getCustomerSession(request, env)`, `requireCustomer(request, env)`, `checkCustomerApiHeaders(request)`; 401 helper; no SQL |
| `functions/_shared/validate-auth.js` | Name/email/password/order-number validation helpers, mirroring `validate-*.js` |
| `functions/_shared/repositories/orders.repo.js` | Add `listOrdersForUser(db, userId, limit, offset)` and `findOrderForUser(db, userId, number)` (SQL stays here) |
| `src/lib/auth-client.ts` | `createAuthClient({ baseURL: window.location.origin })`, `useSession`, `signIn`, `signUp`, `signOut` |
| `src/features/auth/*` | UI components, strings, validation, hooks |
| `functions/api/account/orders.js` | Protected: list the caller's orders |
| `functions/api/account/orders/[number].js` | Protected: one order, ownership-scoped |
| `functions/api/dev/auth-schema.js` | Temporary local-only endpoint that prints `compileMigrations()` SQL; deleted before commit |
| `migrations/0033_better_auth.sql` | Generated SQL, reviewed by hand before applying |
| `migrations/0034_orders_customer_link.sql` | Nullable `orders.customer_user_id` + index (Phase 3) |

---

## 4. Database

### 4.1 Better Auth tables (migration `0033_better_auth.sql`)

Generated from the pinned version, not copied from a blog. Expected tables:

| Table | Key columns |
|-------|-------------|
| `user` | `id` TEXT PK, `name`, `email` UNIQUE, `emailVerified` INTEGER, `image`, `createdAt`, `updatedAt` |
| `session` | `id` TEXT PK, `expiresAt`, `token` UNIQUE, `createdAt`, `updatedAt`, `ipAddress`, `userAgent`, `userId` → `user.id` |
| `account` | `id` TEXT PK, `accountId`, `providerId`, `userId` → `user.id`, `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`, `password`, `createdAt`, `updatedAt` |
| `verification` | `id` TEXT PK, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt` |
| `rateLimit` | `id` TEXT PK, `key` UNIQUE, `count`, `lastRequest` |

Notes:

- Column names use Better Auth's camelCase defaults. Do **not** rename them in Phase 2; renaming adds mapping risk for zero user-visible benefit.
- `user.email` must be unique and case-insensitive in practice. Better Auth normalizes email to lowercase; add a `COLLATE NOCASE` unique index only if the generated SQL does not already guarantee it.
- Foreign keys use `ON DELETE CASCADE` where Better Auth's schema specifies it.
- `rateLimit` is required because we choose database-backed rate limiting (serverless-safe; memory storage is per-isolate and useless on Pages).
- `advanced.database.validateSchema` stays at its default (`true` outside production) so a missing migration fails loudly with a fix message instead of silent 500s.

Generation and review process (Phase 2, local only):

1. Write the real `createAuth` config.
2. Add a temporary `functions/api/dev/auth-schema.js`, guarded by `ALLOW_LOCAL_DEV === "1"` (404 otherwise), which calls `getMigrations(auth.options)` and returns `compileMigrations()`.
3. Run `serve-local.bat`, then `curl http://localhost:3000/api/dev/auth-schema` → SQL.
4. Compare table/column names with the pinned package's schema.
5. Save as `migrations/0033_better_auth.sql`; delete the temporary endpoint.
6. Apply locally: `npx wrangler d1 migrations apply chou-3abelak-orders --local`.
7. Run the auth smoke test against `wrangler pages dev`.

`getMigrations` needs a real adapter, so it must run inside the Worker with the local D1 binding. A plain Node script cannot open a D1 binding; that is why the temporary endpoint exists.

No production migration in Phase 2.

### 4.2 Order linking (migration `0034_orders_customer_link.sql`, Phase 3)

```sql
ALTER TABLE orders ADD COLUMN customer_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_customer_user_id
  ON orders(customer_user_id, created_at DESC);
```

Rules:

- Nullable. Existing and guest orders stay `NULL`.
- Value is always taken from the server-side session, never from the request body.
- `GET /api/account/orders` filters by `customer_user_id = session.user.id`; it never accepts a user id parameter.
- PII retention still nulls `customer_name`, `customer_phone`, `customer_address` after the retention window. Order history must render purged orders without crashing (show items/total/date, hide missing PII).
- No backfill. We cannot prove which historical guest order belongs to which new account, and guessing would leak data.
- Idempotent replay must not attach an existing order to a different user: set `customer_user_id` only on insert, never on an idem-key replay.

This migration is **additive** and reversible by ignoring the column; no table rebuild.

### 4.3 Local vs production

| Environment | Database | Command |
|-------------|----------|---------|
| Local | `.wrangler/state` D1 | `npx wrangler d1 migrations apply chou-3abelak-orders --local` |
| Preview | `chou-3abelak-orders-preview` | owner runs `--remote --env preview` after backup |
| Production | `chou-3abelak-orders` | owner runs `--remote` after backup |

The owner runs every remote command. The plan and Phase 6 runbook give exact copy-paste commands, expected output, and rollback.

---

## 5. Environment variables

### 5.1 Names

| Variable | Required | Example (fake) | Notes |
|----------|----------|----------------|-------|
| `BETTER_AUTH_SECRET` | yes | 44-char base64 | 32+ random bytes. Generate with `openssl rand -base64 32` or Node `crypto.randomBytes(32).toString('base64')`. Never reuse `SESSION_SECRET`. |
| `BETTER_AUTH_URL` | yes | `https://menu.example.com` | Exact origin, no trailing slash. Used for cookies, OAuth redirects, and trusted-origin checks. |
| `TRUSTED_ORIGINS` | yes | `https://menu.example.com,http://localhost:3000` | Comma-separated exact origins. No wildcards. Parsed and trimmed by the factory. |
| `GOOGLE_CLIENT_ID` | Phase 4 | `...apps.googleusercontent.com` | Public identifier. |
| `GOOGLE_CLIENT_SECRET` | Phase 4 | `GOCSPX-...` | Secret. Cloudflare secret only. |

Optional, only if needed:

| Variable | Purpose |
|----------|---------|
| `AUTH_COOKIE_PREFIX` | Override the default `better-auth` cookie prefix (e.g. `chou`). Default is fine. |

### 5.2 Where they live

- Local: `.dev.vars` (already git-ignored). Add fake values to `.dev.vars.example` with `<...>` placeholders.
- Preview/production: Cloudflare Pages → Settings → Environment variables / Secrets. Never in `wrangler.toml`.
- `wrangler.toml` stays binding-only. No secrets.

### 5.3 Fail-fast rules

`createAuth` throws a clear error at request time if:

- `BETTER_AUTH_SECRET` is missing or shorter than 32 characters.
- `BETTER_AUTH_URL` is missing, not `http(s)`, or has a path/query.
- `TRUSTED_ORIGINS` contains `*`.
- `BETTER_AUTH_URL` is `https` in production but a trusted origin is `http` (except localhost).

The error message names the variable, never its value.

---

## 6. Better Auth configuration decisions

| Setting | Value | Reason |
|---------|-------|--------|
| `appName` | `Chou 3abelak` | Shown in account/2FA contexts later. |
| `baseURL` | `env.BETTER_AUTH_URL` (static string) | Explicit, stable, no request inference. |
| `basePath` | `/api/auth` (default) | Matches the required mount. |
| `secret` | `env.BETTER_AUTH_SECRET` | 32+ chars, separate from admin secret. |
| `trustedOrigins` | parsed `env.TRUSTED_ORIGINS` | Exact origins only, no wildcards. |
| `database` | `env.ORDERS_DB` | Native D1; no adapter package. |
| `emailAndPassword.enabled` | `true` | Phase 2. |
| `emailAndPassword.minPasswordLength` | `10` | Stronger than the default 8. |
| `emailAndPassword.maxPasswordLength` | `128` | Matches Better Auth default; prevents DoS via huge inputs. |
| `emailAndPassword.autoSignIn` | `false` | Prevents signup email enumeration (same 200 for existing emails) and gives an explicit "account created, sign in" step. Owner can flip to `true` if they prefer instant login. |
| `emailAndPassword.requireEmailVerification` | `false` in Phase 2, `true` in Phase 5 | Avoids blocking signups before an email provider exists. |
| `emailAndPassword.sendResetPassword` | absent in Phase 2, added in Phase 5 | No email provider yet. |
| `session.expiresIn` | `604800` (7 days) | Better Auth default; stated for the owner. |
| `session.updateAge` | `86400` (1 day) | Session refresh cadence. |
| `session.cookieCache` | **disabled** (default) | Immediate revocation; D1 read per request is cheap. Can enable 5 min later if latency demands it. |
| `account.encryptOAuthTokens` | `true` | Google tokens encrypted at rest. |
| `account.storeStateStrategy` | `"database"` (default with DB) | OAuth state validated against a signed cookie + DB row. |
| `verification.storeIdentifier` | `"hashed"` | Reset/verification tokens hashed at rest. |
| `rateLimit.enabled` | `true` | `NODE_ENV` is unset on Pages, so we set it explicitly. |
| `rateLimit.storage` | `"database"` | Per-isolate memory would not limit anything across Pages instances. |
| `rateLimit.window` / `max` | `60` / `60` | Global baseline per IP. |
| `rateLimit.customRules` | see below | Tighter limits on credential endpoints. |
| `advanced.ipAddress.ipAddressHeaders` | `["cf-connecting-ip"]` | Cloudflare replaces this header; do not trust `x-forwarded-for`. |
| `advanced.useSecureCookies` | `true` when `BETTER_AUTH_URL` starts with `https` | `NODE_ENV` is unset on Pages. |
| `advanced.defaultCookieAttributes` | `httpOnly: true`, `secure` (see above), `sameSite: "lax"`, `path: "/"` | OAuth callback needs Lax. |
| `advanced.cookiePrefix` | `"chou"` | Avoids collisions with admin cookies and other apps. |
| `advanced.disableCSRFCheck` | **never set** (stays `false`) | Built-in CSRF/origin checks stay on. |
| `advanced.disableOriginCheck` | **never set** (stays `false`) | Redirect/callback validation stays on. |
| `advanced.backgroundTasks.handler` | **not set** | Global background tasks can defer rate-limit writes (eventual consistency). In Phase 5, call `waitUntil` explicitly inside the email callbacks instead. |
| `databaseHooks.user.create.before` / `update.before` | trim `name`, enforce 1–80 characters | Server-side name validation for signup and profile update; throws `APIError` with a stable code. |
| `onAPIError.onError` | log `{ path, status, code }` only | No passwords, tokens, cookies, or emails in logs. |
| `logger.level` | `"warn"` | Quiet in production. |

Rate-limit rules:

```js
customRules: {
  "/sign-in/email":        { window: 60, max: 10 },
  "/sign-up/email":        { window: 60, max: 5 },
  "/request-password-reset": { window: 60, max: 3 },
  "/reset-password":       { window: 60, max: 5 },
  "/sign-in/social":       { window: 60, max: 10 },
  "/callback/*":           { window: 60, max: 20 },
  "/get-session":          false, // header polling must not burn the budget
}
```

### 6.1 Password policy (server-side, not only UI)

Better Auth exposes length limits but not complexity. Add a `hooks.before` middleware with `createAuthMiddleware`:

- Paths: `/sign-up/email`, `/reset-password`.
- Rules: 10–128 characters; at least one letter and one digit; reject a small list of obvious passwords (`password`, `12345678`, `qwerty123`, the site name).
- Read `ctx.body.password` / `ctx.body.newPassword`.
- Throw `APIError("BAD_REQUEST", { message: "..." })` with a stable code the UI translates.
- Never log the password.

The UI shows the same checklist live, so users are not surprised by a server rejection.

### 6.2 Error messages

- Sign-in failures always show one generic message: "Email or password is incorrect." Never reveal whether the email exists.
- Signup with an existing email returns the same success shape as a new signup (`autoSignIn: false` enables this protection per the official docs). The UI says "If this email is new, the account was created. Sign in to continue." — no enumeration.
- Rate limit: "Too many attempts. Try again in a minute." Read `X-Retry-After` when present.
- Validation errors map to field-level messages; never echo raw server text.

### 6.3 Redirect safety

- `callbackURL` / `redirectTo` accept only same-origin relative paths (`/account`, `/`, `/checkout`).
- Absolute URLs are rejected unless their origin is in `TRUSTED_ORIGINS`.
- Better Auth's origin check stays enabled; we do not add a second hand-rolled redirect parser.
- Google callback is fixed by `BETTER_AUTH_URL`; no user input reaches it.

### 6.4 Phase 5 email verification note

Enabling `requireEmailVerification` later will block password sign-in for accounts created in Phase 2 that never verified. Plan: enable `sendOnSignIn: true` first, give existing users a verification window, then flip the requirement. Google sign-in is not gated by `emailAndPassword.requireEmailVerification` (it has its own per-provider option).

---

## 7. Route protection proposal (needs owner confirmation — D1)

### 7.1 Public (no login)

| Route | Notes |
|-------|-------|
| `/`, menu, cart, checkout UI | Browsing and cart stay public. |
| `GET /api/menu`, `GET /api/ordering-state`, `GET /api/health` | Unchanged. |
| `POST /api/orders` | Public **if guest checkout stays**. If the caller has a session, the server links the order; otherwise `customer_user_id` stays `NULL`. A session-lookup failure must **not** block guest checkout: catch it, treat the order as guest, and log without secrets. |
| `GET /api/track`, `POST /api/track/batch`, `POST /api/track/received`, `POST /api/track/cancel` | Token-based tracking stays public. |
| `/invite/*`, `POST /api/invite/validate`, `POST /api/invite/redeem` | Unchanged. |
| `/api/auth/*` | Better Auth endpoints (signup, signin, callback, session, signout). |
| Admin routes | Unchanged; still protected by the existing admin cookie/Cloudflare Access. |

### 7.2 Customer-protected (new)

All account routes follow `docs/ADD_NEW_FEATURE.md`: thin route → `checkCustomerApiHeaders` → `requireCustomer` → validate → repository → `jsonNoStore`. SQL lives only in `functions/_shared/repositories/orders.repo.js`.

| Route | Method | Behaviour |
|-------|--------|-----------|
| `/api/account/orders` | `GET` | Returns only the caller's orders, newest first, paginated (`limit` 20, max 50). Summary fields only: number, date, status, total, item count. No `track_token`, no PII of other customers. |
| `/api/account/orders/:number` | `GET` | Returns one order only if `customer_user_id = session.user.id`; 404 otherwise (not 403, to avoid existence leaks). `:number` is parsed as a positive integer and rejected with 400 if not. Items and totals only; no `track_token`. |
| `/account` | page | SPA route; server shell is public, data calls are protected. `no-store`, `noindex`. |

**Profile read/update uses Better Auth's built-in endpoints**, not a custom route:

- Read: `authClient.useSession()` already returns `{ id, name, email, image }`.
- Update: `authClient.updateUser({ name })` → `POST /api/auth/update-user` through the catch-all.
- Server-side validation: a `databaseHooks.user.update.before` hook trims the name and rejects empty/over-80-character values with `APIError("BAD_REQUEST", ...)`.
- This keeps the official origin/CSRF checks and avoids duplicating session logic in a custom route.

### 7.3 Deliberately still public

- `GET /api/orders` does not exist today; do not add a public list endpoint.
- Tracking links remain capability URLs (token + order number). A logged-in customer does not need them, but guests do.
- Admin order search stays admin-only; it is not reused for customer history.

### 7.4 If the owner chooses "login required at checkout" (D2)

- `POST /api/orders` returns 401 without a session.
- The cart UI prompts sign-in before submitting, then resumes checkout.
- Guest tracking still works for orders placed before the change.
- This is a bigger UX change; the recommendation is to **keep guest checkout** and link orders when a session exists.

---

## 8. Frontend plan

### 8.1 Header

- Insert a 44×44 `glass-pill btn-tactile rounded-full` button in `HeaderTopBar.tsx` between the theme toggle and the admin gear (line ~75).
- Logged out: `UserRound` icon. On desktop (≥ md), add a short visible label "Sign in" / "تسجيل الدخول"; on mobile, icon only with an `aria-label`.
- Loading: same button with a neutral skeleton dot — **never** show the logged-out state while `useSession()` is pending.
- Logged in: avatar image if Google provides one, otherwise the first letter of the name on the gold background. On desktop, show the first name next to the avatar. Opens a small menu: name/email, "My account", "My orders", "Sign out".
- The profile button sits before the admin gear; the admin gear remains visible only to admins, as today.
- Keyboard: Enter/Space opens, Escape closes, focus returns to the button.
- Mobile: menu becomes a bottom sheet, matching the cart drawer.

### 8.2 Auth sheet / modal

Reuse the cart drawer shell (bottom sheet on mobile, centered card on desktop) and `useBodyScrollLock`.

Contents:

1. Tabs: "Sign in" / "Create account".
2. Google button first, then an "or" divider, then the email form (common, familiar order).
3. Fields:
   - Name (signup only): `autoComplete="name"`, label above, required.
   - Email: `type="email"`, `inputMode="email"`, `autoComplete="email"`, `dir="ltr"` inside RTL layout.
   - Password: `type="password"`, `autoComplete="current-password"` or `"new-password"`, show/hide button with `aria-pressed`, caps-lock hint.
4. Password checklist on signup: 10+ characters, letter, number.
5. Submit: full-width gold button, disabled + spinner while loading, Enter submits.
6. Errors: inline `role="alert"` box above the submit button; field-level messages linked with `aria-describedby`.
7. Footer: "Forgot password?" (Phase 5), "By continuing you agree to the terms" if the site has such a page.
8. Close button, backdrop click, Escape; focus trap inside the sheet.
9. RTL: logical spacing (`ps-*`, `pe-*`), icons mirror where meaningful, text alignment follows `dir`.

### 8.3 Account page (`/account`)

- Server shell + SPA route, added to `public/_redirects` (`/account/* /index.html 200`). Bare `/account` uses the platform's unknown-path fallback, exactly like bare `/admin` (see the comment in `_redirects`; do not add an exact-path rule — it caused 308s on this project).
- Add both `/account` and `/account/*` to `public/_headers` with `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.
- Header stays the same; the page shows:
  - Profile card: avatar, name, email, "Edit name".
  - Order history: date, order number, status badge, items count, total, "View" (opens the order detail sheet, not the public track link).
  - Empty state with a "Browse menu" button and a short note that guest orders are tracked via their link, not shown in account history.
  - Sign out.
- Loading skeleton; 401 redirects to the auth sheet with `callbackURL=/account`.
- Purged orders (PII nulled) render date/total/items without blanks or "null".

### 8.4 Strings and design

- One feature string table `src/features/auth/strings.ts` with `en` and `ar` keys; no scattered ternaries for long copy.
- Expose the feature through `src/features/auth/index.ts`; `HeaderTopBar` and `App.tsx` import the barrel only (the repo's `lint:isolation` rule).
- Colors only from existing CSS variables (`--primary`, `--surface`, `--border`, `--muted`).
- Radius 28px for sheets, 0.75rem for inputs, matching existing components.
- Fonts inherited (Poppins / Cairo). No new font.
- Light and dark mode tested; gold-on-black and black-on-gold contrast checked (4.5:1 for text, 3:1 for controls).
- Touch targets ≥44×44; inputs 16px minimum on iOS (existing `base.css` rule).
- No toast system; inline alerts only.

### 8.5 State and caching

- `authClient.useSession()` is the single source of truth.
- Account **order** calls use `apiFetch` plus `X-Requested-With: menu-customer` (never the admin header); `checkCustomerApiHeaders` rejects anything else. Profile calls go through `authClient.updateUser` and Better Auth's own origin check.
- After sign-in/sign-out, invalidate the session query and refetch; do not keep a parallel `localStorage` user copy.
- `customer_orders_v1` (12h local shelf) stays for guests; logged-in history comes from the server and takes precedence.
- Do not store tokens in `localStorage`; the session lives in HttpOnly cookies.

---

## 9. Google OAuth (Phase 4)

### 9.1 Google Cloud Console steps (owner)

1. Create/select a project in Google Cloud Console.
2. APIs & Services → OAuth consent screen:
   - User type: External.
   - App name, support email, developer email.
   - Scopes: `openid`, `email`, `profile` only.
   - Test users while in testing mode; publish when ready.
3. Credentials → Create credentials → OAuth client ID → Web application.
4. Authorized JavaScript origins:
   - `https://<production-domain>`
   - `https://<stable-preview-host>`
   - `http://localhost:3000`
5. Authorized redirect URIs (exact, no wildcards):
   - `https://<production-domain>/api/auth/callback/google`
   - `https://<stable-preview-host>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
6. Copy the client ID and secret into Cloudflare secrets (never into git).

### 9.2 App config

```js
socialProviders: {
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
  },
},
```

- Do not add Google to `account.trustedProviders`. Default linking rules stay.
- `requireLocalEmailVerified` defaults to `true`: a Google sign-in with an email that already has an unverified password account will not silently link. Phase 5 email verification resolves this cleanly; until then the UI explains "sign in with your password first, then link Google from your account".
- If Google avatars are displayed, add `https://lh3.googleusercontent.com` to `img-src` in `public/_headers`. Prefer storing the URL and falling back to initials.
- No CSP change is needed for the OAuth redirect itself.

### 9.3 Failure handling

- `access_denied` → "Google sign-in was cancelled."
- `state_invalid` → "This sign-in link expired. Please try again."
- Network/5xx → generic retry message.
- Never display raw provider errors.

---

## 10. Security checklist (mapped to the requirements)

| Requirement | Implementation | Verification |
|-------------|----------------|--------------|
| No secrets in git | `.dev.vars` local, Cloudflare secrets prod, `.dev.vars.example` placeholders only | `git grep` for secret patterns; review diff |
| `BETTER_AUTH_SECRET` 32+ chars | Factory rejects shorter values | Unit test + local boot |
| Correct `baseURL` | Static `BETTER_AUTH_URL`, exact origin | Local + preview sign-in |
| `trustedOrigins`, no wildcard | Exact list from env; factory rejects `*` | Unit test + cross-origin POST rejected |
| HttpOnly/Secure/SameSite Lax | `defaultCookieAttributes` + `useSecureCookies` | Inspect `Set-Cookie` in devtools |
| Built-in CSRF/origin checks | Never set `disableCSRFCheck` / `disableOriginCheck` | Cross-origin POST returns 403 |
| Built-in password hashing | Better Auth default scrypt | Signup → login round-trip; D1 `account.password` is a hash, never plaintext |
| Sensible password policy | 10–128, letter+digit, common-password block | Server test + UI checklist |
| Rate limiting, serverless-safe | `storage: "database"` + custom rules | Burst test returns 429 with `X-Retry-After` |
| Generic login errors | UI maps all credential failures to one message | Wrong email vs wrong password look identical |
| Server-side validation | Length/type checks in hooks and route handlers | Invalid payload tests |
| Safe callback/redirect | Same-origin relative paths only; origin check on | `callbackURL=https://evil.test` rejected |
| No secret logging | `onAPIError.onError` logs path/status/code only; the catch-all never logs headers, cookies, or bodies | Grep logs; review logger config |
| Session expiry/refresh | 7 days / 1 day, stated in docs | Cookie `Max-Age` + D1 `expiresAt` |
| No caching of auth data | `Cache-Control: no-store` on every `/api/auth/*` response | `curl -I` on `get-session` |
| Security headers | Existing CSP/headers; add `/account` no-store/noindex | `curl -I` on preview |
| Admin isolation | Separate cookie name/prefix and routes | Admin login/logout still work |

Additional hardening included:

- `account.encryptOAuthTokens: true`.
- `verification.storeIdentifier: "hashed"`.
- `rateLimit` table in D1 (no per-isolate memory).
- `cf-connecting-ip` only for client IP.
- Session revocation on password reset (Phase 5, `revokeSessionsOnPasswordReset: true`).
- No customer data in URL query strings except the existing tracking token.

---

## 11. Password hashing decision (important)

### 11.1 What we measured

Local workerd (the same runtime as Pages), 2026-11-13:

| Algorithm | Parameters | Wall time |
|-----------|------------|-----------|
| `node:crypto` scrypt | N=16384, r=16, p=1 | **115–144 ms** |
| WebCrypto PBKDF2-SHA-256 | 100,000 iterations | **123 ms** |
| WebCrypto PBKDF2-SHA-256 | 260,000 iterations | **278 ms** |

Reference: Node scrypt with the same parameters was 182–213 ms.

### 11.2 What it means

- Cloudflare Workers Free has a **10 ms CPU** limit per invocation; Paid allows up to 5 minutes.
- Native crypto runs outside the JS isolate, and Cloudflare's CPU accounting may not bill the full wall time. The existing admin login uses PBKDF2 (the example hash is 260k) and is reported to work in production; **if** that deployment is on Free, it suggests native crypto wall time is not fully billed. This is an assumption to verify, not a guarantee.
- However, Cloudflare Free **rejects** WebCrypto PBKDF2 above 100,000 iterations (reported October 2026, runtime error `iteration counts above 100000 are not supported`). If the production project is on Free, the existing admin login at 260k is at risk. This is outside the auth feature's scope but must be raised with the owner.
- Better Auth 1.7.23 uses native `node:crypto` scrypt on workerd (not the old pure-JS fallback). No PBKDF2 iteration cap applies to scrypt.
- scrypt at N=16384, r=16 needs about **64 MB** per hash (`maxmem = 128 * N * r * 2`). Workers have 128 MB per isolate, so one hash fits; avoid parallel hashing inside a single request.

### 11.3 Recommendation

1. Keep Better Auth's **built-in scrypt** exactly as the owner requested.
2. In Phase 2, deploy to a **preview** environment and perform one real signup + login. Watch for `Exceeded CPU` / 1102 errors.
3. If preview succeeds, keep scrypt. No custom hashing, no weakening.
4. If preview fails on Free:
   - Option A (recommended if the owner will not pay): use Better Auth's official custom `emailAndPassword.password.hash/verify` with PBKDF2-SHA-256 at **100,000 iterations** (the Free maximum) via WebCrypto. This is a documented Better Auth extension point, not a hack. It is weaker than scrypt and must be an explicit owner decision.
   - Option B: upgrade to Workers Paid (5 min CPU) and keep scrypt.
5. Never silently lower the work factor. The chosen parameters go in `decisions.md`.

> **Owner decision D6:** approve the fallback only if preview fails. Default is to keep built-in scrypt.

---

## 12. Testing plan

### 12.1 Automated (local, no network)

Add lightweight `scripts/test-auth-*.mjs` tests in the existing style (fake D1/Request objects):

- `test-auth-config.mjs`: missing/short secret, missing URL, wildcard origin, http origin in production → throws with the right variable name.
- `test-auth-session.mjs`: no cookie → 401; valid session → user; expired session → 401; malformed cookie → 401.
- `test-auth-password-policy.mjs`: too short, no digit, no letter, common password, valid → expected results.
- `test-auth-name-policy.mjs`: empty, whitespace-only, 81 chars, valid → trimmed/accepted or rejected.
- `test-auth-redirect.mjs`: relative path allowed; same-origin absolute allowed; `https://evil.test` rejected; `//evil.test` rejected; `javascript:` rejected.
- `test-account-orders.mjs`: query is scoped to `session.user.id`; a client-supplied `userId` is ignored; pagination caps at 50.
- `test-order-link.mjs`: session present → `customer_user_id` set from session; no session → `NULL`; body-supplied id ignored.

Run `npm run lint` and the new tests. The full `npm run test:all` is run in Phase 6 (it is long).

### 12.2 Manual (local `serve-local.bat`)

- Signup with a new email → "account created, sign in" → sign in → header shows name/avatar.
- Refresh → still signed in; close/reopen browser → still signed in (7 days).
- Sign out → header returns to logged-out state; protected API returns 401.
- Wrong password and unknown email → identical generic message.
- Duplicate signup → same success shape, no email leak.
- Password show/hide, caps lock hint, Enter submits, loading disables the button.
- Keyboard-only: tab order, focus trap, Escape closes, focus returns.
- RTL Arabic + LTR English; dark + light; 360px, 768px, 1280px.
- Google sign-in (Phase 4) on localhost; cancel flow; invalid state.
- Rate limit: 6 rapid bad logins → 429 with a friendly message.
- `/account` direct load (hard refresh) works via `_redirects`.
- Admin login/logout/session still work at the old URLs.

### 12.3 Preview (owner-assisted)

- Apply preview migration.
- Set preview secrets.
- Signup/login/logout, Google callback, cookies `Secure` + `HttpOnly` + `SameSite=Lax`.
- Check CPU errors in `wrangler tail` / Cloudflare logs.
- `curl -I` for CSP, `no-store`, `noindex` on `/account`.

### 12.4 Regression

- Guest checkout still creates an order.
- Tracking link still opens.
- Invite flow still works.
- Admin dashboard loads and can update an order.
- Menu/cart unaffected with auth code deployed.

---

## 13. Deployment outline (details in Phase 6)

1. Owner backs up D1 (`wrangler d1 export` or dashboard export).
2. Owner applies `0033` (and later `0034`) to preview, then production.
3. Owner sets `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS` (and Google credentials in Phase 4) as Pages secrets for both environments.
4. Deploy the branch to preview; run the manual checklist.
5. Deploy to production; run a smoke test (signup with a test address, login, logout, one guest order).
6. Monitor logs for 24 hours; watch for 429s that are too aggressive and CPU errors.
7. Rollback: redeploy the previous build. Auth tables are additive and unused by the old build; `orders.customer_user_id` is nullable. No destructive rollback needed.

---

## 14. Owner decisions (blocking)

| # | Decision | Recommendation | Needed by |
|---|----------|----------------|-----------|
| D1 | Confirm the protected routes in §7 | Approve as listed | Phase 3 |
| D2 | Keep guest checkout or require login? | **Keep guest checkout**; link orders when signed in | Phase 3 |
| D3 | Email provider for reset/verification | **Resend free tier**, reusing the existing `RESEND_API_KEY` setup | Phase 5 |
| D4 | Production domain + stable preview host | Needed for `BETTER_AUTH_URL` and `TRUSTED_ORIGINS`; can be deferred until preview (local uses `http://localhost:3000`) | Phase 6 (preview) |
| D5 | Approve `orders.customer_user_id` migration | Approve (nullable, additive, no backfill) | Phase 3 |
| D6 | If preview hits the Free CPU limit: PBKDF2 100k fallback or Paid plan? | Try scrypt first; decide only if it fails | Phase 2 |
| D7 | Signup behaviour: `autoSignIn: false` (no enumeration, one extra sign-in) vs instant login | **`autoSignIn: false`** | Phase 2 |
| D8 | Google avatar display (needs one CSP `img-src` addition) | Add `https://lh3.googleusercontent.com` | Phase 4 |

---

## 15. Approval gate

No production code, dependency install, migration, or secret change happens until the owner says **"continue"** and confirms **D7** (signup behaviour). D1/D2/D5 are needed before Phase 3; D4 before a preview deploy; D3/D6/D8 can be answered by their phase.

Phase 2 will start with:

1. `npm install better-auth@1.7.23` (no CLI dependency).
2. `functions/_shared/auth.js` + catch-all.
3. Confirm the production compatibility date/flags support `node:crypto` scrypt; raise the local `compatibility_date` if needed and give the owner the dashboard values to mirror.
4. Schema generation + local migration.
5. Local signup/login/logout smoke test.
6. Preview signup/login to measure CPU (D6 evidence).
7. A short Phase 2 report and a stop for approval before Phase 3.
