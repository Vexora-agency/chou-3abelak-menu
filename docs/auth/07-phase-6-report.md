# Phase 6 — Final Handover, Regression & Deployment Runbook

Status: ✅ shipped to production; owner-only live checks listed below.
Date: 2026-11-14

> **بالعربي باختصار:** المشروع كله اتسلم: تسجيل/دخول بالإيميل وجوجل، حساب
> العميل وطلباته، ربط الطلبات، لوحة العملاء للأدمن، استعادة كلمة المرور،
> وتأكيد الإيميل. كله متطبق على production. ناقص بس 4 تجارب حقيقية منك:
> دخول جوجل بحساب حقيقي، فتح رابط تأكيد من إنبوكس، فتح رابط استعادة،
> ونظرة على شاشة الأدمن.

---

## 1. Final scope delivered

| Phase | Delivered |
|-------|-----------|
| 1 | Repo audit, Better Auth docs research, pinned plan |
| 2 | Better Auth 1.7.23 + native D1 + `/api/auth/*` + session helper + rate limits + migration 0033 |
| 3 | Profile button, auth/account sheets, 365-day order history, profile settings, checkout prefill, order linking, admin badge + Accounts view, migration 0034/0035 |
| 4 | Google OAuth with credential-gated button, CSP avatar host, Console runbook |
| 5 | Resend verification/reset emails, forget/reset UI, resend verification, new rate limits |
| 6 | Full runbook, regression evidence, rollback, owner live checks |

---

## 2. Production state

| Item | Value |
|------|-------|
| Domain | `https://chou3abelak.site` |
| Pages project | `chou-3abelak-menu` |
| Latest code deployment | `3ba19334-1d82-4a80-8bac-6717d4cf15fc` (`8755f8c`) |
| Latest docs deployment | `63303560-e27f-444d-bccc-ba941beb83e0` (`4ae7f8b`) |
| D1 | `chou-3abelak-orders` (`7d585e65-5bea-4b81-b727-ebb001bc72e6`) |
| Migrations | 0033, 0034, 0035 applied |
| Public flags | `{"google":true,"requireEmailVerification":true}` |
| Customer rows | 0 users / 0 sessions after test cleanup |
| Google OAuth | client configured; redirect URI verified |
| Resend | key + from + reply-to present; test send accepted |

No secrets are committed. Local secrets stay in `.dev.vars` (git-ignored);
production secrets live in Cloudflare Pages.

---

## 3. Security posture

- Better Auth 1.7.23 pinned exactly; native D1; no community adapter.
- Session cookie: `__Secure-chou.session_token`, `HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, 7-day expiry, 1-day refresh.
- Built-in CSRF/origin checks untouched; exact `TRUSTED_ORIGINS`, no wildcards.
- Password hashing: built-in scrypt (verified in production: CPU ~162–172 ms,
  `outcome: ok`).
- Password policy: 10–128, letter + digit, common-password block, Unicode-aware.
- Rate limits (D1-backed):
  - sign-in 10/60s, sign-up 5/60s
  - reset request 3/60s, reset 5/60s
  - send verification 3/60s, verify 10/60s
  - social start 10/60s, callback 20/60s
- Email enumeration: generic sign-in error; generic reset response; signup
  enumeration protection via `autoSignIn:false` / verification.
- Reset token 1 hour; successful reset revokes all sessions.
- Verification token 1 hour; unverified sign-in returns 403.
- Email templates: HTML-escaped names, URL scheme validated, no recipient/token
  logging; sends queued with `waitUntil`.
- CSP includes Google avatar host; Axe/headers checks remain green.
- Admin auth untouched (`__Host-admin-session`, separate routes/roles).
- Kitchen cannot read customer accounts (existing gate + UI hidden).

---

## 4. Test evidence

### Automated

| Check | Result |
|-------|--------|
| CI `verify` on PRs #117, #119, #120, #121 | ✅ `test:all`, typecheck, depcruise, build, bundle grep |
| `npm run test:auth` | ✅ 10 files green |
| `npm run lint` | ✅ |
| `npm run build` | ✅ |
| `npx depcruise src functions scheduler scripts` | ✅ |
| `npm run test:headers` | ✅ 21/21 |
| `npm run test:access` | ✅ |
| `npm run test:kitchen-gate` | ✅ |

### Production smoke

| Check | Result |
|-------|--------|
| Site `/` | ✅ 200 |
| `GET /api/auth/public-config` | ✅ `{"google":true,"requireEmailVerification":true}` |
| Google OAuth start | ✅ exact `redirect_uri` + minimal scopes |
| Signup + verification gate | ✅ 200 signup; 403 `EMAIL_NOT_VERIFIED` before verify |
| Unknown-email reset | ✅ 200 generic message |
| Resend send | ✅ accepted (no failure warning in deployment tail) |
| Admin order badge / accounts API | ✅ tested locally; production route protected |
| Test accounts | ✅ deleted (0 remaining) |

### Manual browser (local)

- EN + dark: auth sheet, account sheet, orders, settings, prefill, sign-out.
- AR + light: RTL, white sheet, Arabic labels, order history, forgot/reset forms.
- Google button appears only when configured; fake-credential redirect verified.
- Invalid reset token shows the friendly error.
- No wrong-state flash: header uses `isPending`; account sheet handles pending/expired.

---

## 5. Owner-only live checks (4)

These need a human inbox / Google account:

1. **Google:** open the site, profile → Continue with Google, pick a test account,
   confirm return to the account sheet + header name/avatar.
2. **Verify email:** sign up with an email you own, open the verification email,
   click the link, confirm auto sign-in. Then sign out/in with the password.
3. **Reset password:** sign in, sign out, Forgot password → open the email link,
   set a new password, sign in with it. Confirm old sessions are gone.
4. **Admin visual:** log in at `/admin`, open a linked order (Registered badge),
   open the **Accounts** view, search a customer, confirm details.

If any item fails, send the exact screen/status and the deployment time; the
runbook below gets us back safely.

---

## 6. Deployment runbook (repeatable)

### Local

```bash
npm ci
npx wrangler d1 migrations apply chou-3abelak-orders --local
npm run test:auth
npm run lint
npm run build
# serve-local.bat  (build + wrangler pages dev ./dist --port 3000)
```

Local `.dev.vars`:
- `AUTH_REQUIRE_EMAIL_VERIFICATION=0` (convenience only)
- Add real Google/Resend values only when testing those flows.

### Production change

1. Create a branch from `main`; keep migrations additive.
2. Open a PR; wait for `verify`, `secrets`, `lint-report`, Cloudflare Pages.
3. Take a D1 backup **outside the repo**:
   ```bash
   npx wrangler d1 export chou-3abelak-orders --remote --output "C:\Users\Mina\Desktop\backups\before-YYYYMMDD.sql"
   ```
4. Check pending migrations, then apply:
   ```bash
   npx wrangler d1 migrations list chou-3abelak-orders --remote
   npx wrangler d1 migrations apply chou-3abelak-orders --remote
   ```
5. Merge the PR; Cloudflare Pages deploys `main` automatically.
6. Watch logs:
   ```bash
   npx wrangler pages deployment tail <DEPLOYMENT_ID> --project-name chou-3abelak-menu --format pretty
   ```
7. Smoke test: `/`, `/api/auth/public-config`, sign-in, account sheet, admin login.

### Rollback

- **Code:** Pages → Deployments → previous deployment → Rollback. Auth tables are
  additive; the old build ignores them.
- **Email:** auth keeps working if Resend fails; the queue logs a reason only.
  Fix the Resend key/domain and redeploy; no DB change.
- **Google:** the button is gated by `/api/auth/public-config`; remove one secret
  and redeploy to hide it.
- **DB:** restore the backup only if a migration corrupted data. Never drop
  `user`/`session`/`account`/`verification`/`customer_profiles` as a "reset" —
  it deletes real accounts. Do not use the old "Forget" command as a local
  erase; it can delete history on Boosthis.

---

## 7. Known limitations

- **www vs apex:** Google OAuth is configured for the canonical apex. Add a
  Cloudflare 301 rule from `www.chou3abelak.site/*` to
  `https://chou3abelak.site/$1` to avoid `state_invalid` if users open www.
- **Preview host:** stable preview/branch alias is still pending (D4); production
  is the verified environment.
- **Admin visual:** the Accounts view and badge are API/typecheck/build verified;
  the owner's live admin look is the final visual check.
- **Real inbox:** Resend accepted a send, but the click-through needs a real inbox.
- **Google consent:** OAuth start is verified; the actual Google account picker
  needs a real Google login.
- **Account page URL:** the account lives in a sheet opened by the profile
  button; a dedicated `/account` route can be added later without data changes.

---

## 8. Final acceptance

- [x] Menu/cart/tracking/invite remain public.
- [x] Guest checkout works; signed-in orders link to the account.
- [x] Email/password auth + Google auth code.
- [x] Account orders (365 days), settings, sign-out.
- [x] Admin registered-customer badge + Accounts view.
- [x] Reset + verification emails + rate limits.
- [x] Dark/light + AR/EN RTL.
- [x] No secrets in git; production secrets in Cloudflare.
- [ ] Owner: real Google login.
- [ ] Owner: real inbox verify + reset click-through.
- [ ] Owner: admin visual pass.
