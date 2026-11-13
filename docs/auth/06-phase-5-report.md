# Phase 5 — Password Reset, Email Verification, Hardening

Status: ✅ complete locally; production rollout + real inbox test pending in this phase's PR.
Date: 2026-11-14

> **بالعربي باختصار:** دلوقتي العميل يقدر يعمل "نسيت كلمة المرور" ويستقبل
> رابط على إيميله، وأي حساب جديد بالإيميل لازم يتأكد من بريده قبل الدخول.
> الإيميلات بتتبعت من Resend المجاني، بالعربي والإنجليزي. الرابط صالح ساعة،
> وإعادة تعيين الباسورد بتلغي كل الجلسات القديمة. كل ده اتجرب محليًا،
> وناقص بس النشر واختبار وصول الإيميل الحقيقي.

---

## 1. What shipped

### Email verification

- New email/password accounts must verify their email before sign-in.
- Verification email: bilingual HTML + plain text, valid **1 hour**.
- `sendOnSignUp: true`, `autoSignInAfterVerification: true`.
- Sign-in with an unverified account shows a clear message + **Resend verification email** button.
- Google accounts are verified by Google; this gate applies to email/password only.
- Local convenience: `AUTH_REQUIRE_EMAIL_VERIFICATION=0` in `.dev.vars` skips the gate. **Production must leave it unset (default true).**

### Password reset

- "Forgot password?" link in the sign-in form.
- Forgot form always answers the same way, whether the email exists or not (no enumeration).
- Reset email: bilingual HTML + text, valid **1 hour**.
- Reset form opens from `/?reset=1&token=...`; the token is stripped from the URL immediately after reading.
- New password + confirmation, same 10–128 / letter+digit policy.
- Successful reset revokes all existing sessions (`revokeSessionsOnPasswordReset: true`).
- Invalid/expired token shows a clear message and a "Back to sign in" path.

### Hardening

- Rate limits added:
  - `/send-verification-email`: 3 / 60s
  - `/verify-email`: 10 / 60s
  - existing reset request 3 / 60s, reset 5 / 60s.
- Email sending is queued through Pages `waitUntil`; auth responses never wait on Resend.
- Email templates escape user names, validate the URL scheme, and never log recipients or tokens.
- Resend failure logs only `{ ok, reason/status }`.
- Existing CSP/headers remain; Google avatar host is already allowed.

---

## 2. Email provider

Resend free tier, reusing the existing production setup:

| Variable | Production value (already present) |
|----------|-------------------------------------|
| `RESEND_API_KEY` | secret |
| `MAIL_FROM_DOMAIN_EMAIL` | `orders@chou3abelak.site` |
| `REPLY_TO` | `info@vexora.agency` |

No new secrets are required. The Resend domain must be verified in the Resend
dashboard (Domains → DNS records). If it is not verified, sending fails
silently from the user's perspective (auth still answers normally); check
Resend → Emails/Logs.

---

## 3. Files

### New

- `functions/_shared/auth-email.js` — bilingual reset/verify templates + Resend sender + `waitUntil` queue.
- `scripts/test-auth-email.mjs` — template escaping, payload, failure, queue, config tests.
- `docs/auth/06-phase-5-report.md` — this report.

### Changed

- `functions/_shared/auth.js` — `requireEmailVerification`, reset/verify callbacks, new rate limits, `AUTH_REQUIRE_EMAIL_VERIFICATION` local override.
- `functions/api/auth/public-config.js` — exposes `requireEmailVerification` (boolean only).
- `src/features/auth/hooks/useAuthProviders.ts` — reads both capability flags.
- `src/features/auth/components/AuthSheet.tsx` — forgot/reset modes, resend verification, updated success messages.
- `src/App.tsx` — parses `/?reset=1&token=...`, opens reset mode, strips the token.
- `.dev.vars.example` — local verification override.
- `package.json` — `test:auth` includes the email tests.

No database migration was needed.

---

## 4. Verification

| Check | Result |
|-------|--------|
| `npm run test:auth` | ✅ 10 files green |
| `npm run lint` | ✅ |
| `npm run build` | ✅ |
| `npx depcruise src functions scheduler scripts` | ✅ |
| `npm run test:headers` | ✅ 21/21 |
| Email template: URL + bilingual + escaped name | ✅ |
| Resend payload: from / to / reply_to / bearer | ✅ |
| Missing Resend config skips safely | ✅ |
| Provider failure returns `ok:false` | ✅ |
| `waitUntil` receives the send promise | ✅ |
| Verification required by default | ✅ |
| Local override disables the gate | ✅ |
| Forgot UI (AR + RTL) | ✅ |
| Reset form from `?reset=1&token=bad` | ✅ |
| Invalid token error | ✅ |
| Forgot unknown email → generic success | ✅ |

The local `.dev.vars` has a fake/absent Resend key, so no real email was sent
locally. Production delivery needs one real inbox test (below).

---

## 5. Production rollout + test (owner-assisted)

1. Merge the Phase 5 PR (no migration, no new secret).
2. Confirm in Cloudflare that `RESEND_API_KEY`, `MAIL_FROM_DOMAIN_EMAIL`, and
   `REPLY_TO` are still present in **Production**.
3. Confirm the sending domain is verified in Resend.
4. Test with a real inbox you own:
   - Sign up with a new email → expect the verification email.
   - Click the link → expect auto sign-in; header shows the account.
   - Sign out; sign in with the same email/password.
   - Click "Forgot password?" → expect the reset email.
   - Open the link → set a new password → sign in with it.
5. Check Resend → Emails for delivery status.
6. Check `GET /api/auth/public-config` → `requireEmailVerification: true`.
7. If delivery fails: check Resend domain DNS, API key, and the `from` address;
   auth itself should still answer normally.

### Note for existing accounts

Production had 0 customer users at rollout time. If any unverified
email/password account is created before this phase, enabling the gate will
require that user to verify (or use the resend button) before signing in.
Google accounts are unaffected.

---

## 6. Remaining after this phase

- Real inbox verification in production.
- Phase 6: full regression pass, manual accessibility/RTL/theme checklist,
  deployment/rollback runbook, and final handover.
