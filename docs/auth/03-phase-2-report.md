# Phase 2 — Backend Report (local only)

Status: ✅ complete locally. No remote command, deploy, or production secret was run.
Date: 2026-11-13

> **بالعربي باختصار:** الباك إند اتعمل واتجرب محليًا: تسجيل/دخول/خروج،
> التحقق من الباسورد والاسم، rate limit، وجداول D1. مسارات الأدمن القديمة
> لسه شغالة. مفيش أي حاجة اترفعت أو اتغيرت في الإنتاج. الخطوة الجاية
> اختبار الـ CPU على preview (أوامرها تحت) وبعدها Phase 3.

---

## 1. Files added

| File | Purpose |
|------|---------|
| `functions/_shared/auth.js` | Per-request Better Auth factory, env validation, rate limits, hooks |
| `functions/_shared/auth-session.js` | `getCustomerSession`, `requireCustomer`, `checkCustomerApiHeaders` |
| `functions/_shared/validate-auth.js` | Pure name/password/redirect/order-number validation |
| `functions/api/auth/[[all]].js` | Better Auth catch-all at `/api/auth/*` |
| `migrations/0033_better_auth.sql` | Generated + hand-reviewed auth schema |
| `scripts/test-auth-config.mjs` | Env/origin/secure-cookie tests |
| `scripts/test-auth-password-policy.mjs` | Password policy tests |
| `scripts/test-auth-name-policy.mjs` | Name normalization/limits tests |
| `scripts/test-auth-session.mjs` | CSRF gate + session helper tests |
| `scripts/test-auth-redirect.mjs` | Callback/redirect safety tests |

## 2. Files changed

| File | Change |
|------|--------|
| `package.json` | Added `"better-auth": "1.7.23"` (exact) and `test:auth` |
| `package-lock.json` | Locked Better Auth 1.7.23 and its dependencies |
| `functions/_shared/session.js` | `checkApiHeaders(request, expectedHeader = 'menu-admin')` — backward-compatible |
| `.dev.vars.example` | Added local auth placeholders |
| `migrations/README.md` | Documented `0033_better_auth.sql` |

Local-only, git-ignored: `.dev.vars` received `ALLOW_LOCAL_DEV=1`, a freshly generated `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:3000`, and exact local `TRUSTED_ORIGINS`.

## 3. Schema (local D1)

Generated from the real config with `getMigrations(auth.options).compileMigrations()`, reviewed by hand, then applied locally:

| Table | Key columns |
|-------|-------------|
| `user` | `id` PK, `name`, `email` UNIQUE, `emailVerified`, `image`, timestamps |
| `session` | `id` PK, `expiresAt`, `token` UNIQUE, `ipAddress`, `userAgent`, `userId` → `user.id` CASCADE |
| `account` | `id` PK, `accountId`, `providerId`, `userId` → `user.id` CASCADE, OAuth tokens, `password` |
| `verification` | `id` PK, `identifier`, `value`, `expiresAt`, timestamps |
| `rateLimit` | `id` PK, `key` UNIQUE, `count`, `lastRequest` |

Indexes: `session_userId_idx`, `account_userId_idx`, `verification_identifier_idx`.

No existing table was altered. `orders.customer_user_id` is **not** in this migration; it belongs to Phase 3 (`0034`).

## 4. Test results

### Automated

| Command | Result |
|---------|--------|
| `npm run test:auth` | ✅ all 5 files green |
| `npm run lint` (`tsc --noEmit`) | ✅ clean |
| `npm run test:access` | ✅ all green |
| `npm run test:headers` | ✅ 20 passed, 0 failed |
| `npm run test:kitchen-role` | ✅ all green |
| `npm run test:kitchen-gate` | ✅ all green |
| `npm run build` | ✅ built |

### Live local (`wrangler pages dev ./dist --port 3000`)

| Check | Result |
|-------|--------|
| Admin `GET /api/auth/session` | ✅ 200 `{"authenticated":false}` — static admin route still wins |
| Admin `POST /api/auth/login` (wrong creds) | ✅ 401 `{"error":"invalid"}` — admin handler, not Better Auth |
| Admin `POST /api/auth/logout` | ✅ 200 `{"ok":true}` |
| Better Auth `GET /api/auth/get-session` (guest) | ✅ 200 `null` |
| Signup (`autoSignIn: false`) | ✅ 200, `token: null`, user created |
| Duplicate email signup | ✅ 200 synthetic response, **no second DB row** (no enumeration) |
| Sign-in | ✅ 200 + `chou.session_token` cookie |
| Cookie attributes (local http) | ✅ `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`; no `Secure` locally (expected) |
| `GET /api/auth/get-session` with cookie | ✅ returns user + session |
| `POST /api/auth/sign-out` | ✅ `{"success":true}` |
| Weak password (`short1`) | ✅ 400 `password_too_short` |
| Password without digit | ✅ 400 `password_number_required` |
| Name > 80 chars | ✅ 400 `name_too_long` |
| Empty name update | ✅ 400 `name_required` |
| Valid name update | ✅ 200, trimmed to `Phase Two Updated` |
| Rate limit `sign-in/email` | ✅ 10th rapid request returned 429 with `X-Retry-After: 59` |
| Password storage | ✅ `account.password` is 161-char `salt:key` hash (not plaintext) |

Local test users (local D1 only): `phase2+1794594493@example.com` and `phase2final+...@example.com`. Session rows, credential accounts and rate-limit rows exist only in `.wrangler/state`.

## 5. Admin route coexistence

Confirmed live:

- `login.js`, `logout.js`, `session.js` are exact static routes and still answer.
- Better Auth answers `/api/auth/get-session`, `/sign-up/email`, `/sign-in/email`, `/sign-out`, `/update-user`.
- No admin endpoint was moved or changed; only the optional `expectedHeader` parameter was added with the old default.

## 6. Temporary schema endpoint

`functions/api/dev/auth-schema.js` was created, guarded by `ALLOW_LOCAL_DEV === "1"`, used once, then deleted.

`git status` after deletion shows **no** `functions/api/dev/auth-schema.js`. A request to `/api/dev/auth-schema` now returns the SPA shell, not SQL.

## 7. Cloudflare settings for preview/production

Tested locally with `wrangler.toml`:

- `compatibility_date = "2025-06-01"`
- `compatibility_flags = ["nodejs_compat"]`

Set the same in the Pages dashboard:

- Pages project → **Settings → Functions → Compatibility date**: `2025-06-01` (or newer; never older).
- **Compatibility flags**: `nodejs_compat`.

The local run used the real native D1 binding and Better Auth's `workerd` export; signup hashing completed without a CPU error. This is not proof of the Free-plan limit — the preview test below is.

## 8. Preview CPU test (owner-run, in order)

1. **Set Preview env vars/secrets** in Pages → Settings → Environment variables → **Preview**:
   - `BETTER_AUTH_SECRET` = a fresh 32+ byte random value (do not reuse `SESSION_SECRET`).
   - `BETTER_AUTH_URL` = `https://<stable-preview-host>` (exact origin).
   - `TRUSTED_ORIGINS` = `https://<stable-preview-host>` (plus production origin if the preview must call it; no wildcards).
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are **not** needed yet.
2. **Apply migrations to the preview D1** (after a backup):
   ```bash
   npx wrangler d1 migrations apply ORDERS_DB --remote --env preview
   ```
3. **Deploy the branch to preview** through the normal Pages git integration (or `npx wrangler pages deploy ./dist --project-name <PROJECT> --branch <BRANCH>` if you deploy by CLI).
4. **Watch logs**:
   ```bash
   npx wrangler pages deployment tail --project-name <PROJECT> --environment preview --format pretty
   ```
5. Open the preview URL and:
   - Create a test account with a new email.
   - Sign in, refresh, sign out.
   - Open the admin login once (must still work).
6. Look for `Exceeded CPU`, `1102`, or a 500 on signup/sign-in.
7. **If a CPU error appears: STOP.** Do not change hashing. Report the exact log line; the owner chooses between PBKDF2 100k and Workers Paid.
8. Check the cookie in devtools: `__Secure-chou.session_token`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.

### Stable preview host

Pages gives each branch a stable alias automatically: `<sanitized-branch>.<project>.pages.dev`. The current branch is `preview/msa-arabic`, so check the dashboard's branch alias (likely `preview-msa-arabic.<project>.pages.dev`). If you want a cleaner host, create a dedicated `preview` branch; its alias is normally `preview.<project>.pages.dev`. Use that exact origin in `BETTER_AUTH_URL` and `TRUSTED_ORIGINS`.

## 9. Deferred (not in Phase 2)

- `orders.customer_user_id` + index (`0034`, Phase 3).
- Customer UI, profile icon, `/account` page (Phase 3).
- Google OAuth + Console setup + `lh3.googleusercontent.com` CSP (Phase 4).
- Resend reset/verification emails (Phase 5).
- Production deploy and secrets (Phase 6).
