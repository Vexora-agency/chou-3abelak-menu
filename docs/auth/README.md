# Customer Auth — Master Tracker

> **بالعربي باختصار:** المشروع ده بيضيف تسجيل دخول/إنشاء حساب للعملاء
> (إيميل + باسورد، وجوجل) باستخدام Better Auth + Cloudflare D1، مع الحفاظ
> على تصفح المنيو بدون تسجيل. الملف ده هو خريطة الشغل: كل مرحلة، حالتها،
> الملفات، والقرارات المفتوحة. أي حد (أو أي agent) يفتح المشروع يبدأ من هنا.

Last updated: 2026-11-13
Project: `chou-3abelak-menu-main` (React + Vite + Tailwind + Cloudflare Pages Functions)
Status legend: ⬜ pending · 🟨 in progress · ✅ done · ⛔ blocked (needs owner)

---

## 1. Phase status

| # | Phase | Status | Deliverable |
|---|-------|--------|-------------|
| 1 | Investigate + Better Auth docs + plan | ✅ done | `01-investigation.md`, `02-plan.md` |
| 2 | Backend: Better Auth + D1 + migrations (local) + email/password + session helper + rate-limit table | ✅ done (local + production) | Auth factory, `/api/auth/*`, `0033_better_auth.sql`, session helper, tests |
| 3 | Frontend: login/signup UI + header state + protected routes + link orders + admin customers | ✅ done (local + production) | Auth/account sheets, profile button, account APIs, admin Accounts view |
| 4 | Google login + Google Console instructions | 🟨 code + UI deployed; awaiting Google credentials | Google provider config + `05-google-oauth.md` |
| 5 | Hardening: rate-limit tuning, headers, reset password + email verification | ✅ done (local) | Resend reset/verify emails + UI + hardening |
| 6 | Testing + Cloudflare Pages deployment guide | ⬜ pending | Manual test checklist + deploy runbook |

**Current step:** Phase 5 complete locally (reset + verification + Resend + rate limits). Production rollout and one real-inbox test are next; Google code is already live with credentials.

---

## 2. Documents

| File | Purpose |
|------|---------|
| `01-investigation.md` | Repo audit: stack, backend, DB, existing auth, UI/design system |
| `02-plan.md` | Proposed files, schema, env vars, route protection, open questions |
| `03-phase-2-report.md` | Phase 2 local results, test evidence, preview CPU checklist |
| `04-phase-3-report.md` | Phase 3 customer account UI, order linking, admin customers, test evidence |
| `05-google-oauth.md` | Phase 4 Google OAuth code status, Console steps, exact URIs, test checklist |
| `06-phase-5-report.md` | Phase 5 reset/verification emails, hardening, test evidence |
| `decisions.md` | Decision log (pinned versions, provider choices, owner answers) |
| `manual-checklist.md` | Everything only the owner can do (Google Console, secrets, D1, deploy) — created in Phase 6 |

---

## 3. Owner decisions needed (blocking later phases)

| # | Question | Needed by | Answer |
|---|----------|-----------|--------|
| D1 | Which routes become login-required? (proposal in `02-plan.md` §7) | Phase 3 | ✅ approved as listed; menu/cart/tracking/invite stay public |
| D2 | Keep guest checkout or require login at checkout? | Phase 3 | ✅ keep guest checkout; link only with a valid session; lookup failure never blocks the order |
| D3 | Email provider for verification/reset (proposal: Resend free tier) | Phase 5 | ✅ Resend free tier, reuse `RESEND_API_KEY`; Phase 5 only |
| D4 | Production domain + stable preview URL for `BETTER_AUTH_URL` / `trustedOrigins` | Phase 6 (preview) | ✅ production: `https://chou3abelak.site` + `https://www.chou3abelak.site`; preview host still pending |
| D5 | Order-to-user linking migration approval | Phase 3 | ✅ approved: nullable `customer_user_id`, index, no backfill |
| D6 | If preview hits the Free CPU limit: PBKDF2 100k fallback or Paid plan? | Phase 2 | ✅ built-in scrypt verified in production: signup `cpuTime 172`, signin `cpuTime 162`, both `outcome: ok`; no fallback needed |
| D7 | Signup: `autoSignIn: false` (no enumeration) vs instant login | Phase 2 | ✅ `autoSignIn: false`; revisit with email verification in Phase 5 |
| D8 | Google avatar display (adds one CSP `img-src` host) | Phase 4 | ✅ add `https://lh3.googleusercontent.com` in Phase 4 only |

---

## 4. Hard rules (do not violate)

- Menu browsing stays public. Auth only for checkout, order history, profile.
- Better Auth official docs are the source of truth; pin the version in `decisions.md`.
- No secrets in git. Local secrets in `.dev.vars` (gitignored); production in Cloudflare.
- D1 binding (`ORDERS_DB`) is read per-request inside the handler — never at import time.
- Server-side session validation for every protected API. UI hiding is not protection.
- Small, focused diffs. No unrelated refactors. No new dependencies without a reason.
- Production commands (remote migrations, deploys, secrets) are run by the owner.

---

## 5. Session log

| Date | Phase | What happened |
|------|-------|---------------|
| 2026-11-13 | 1 | Repo audit started; Better Auth docs research started; tracker created |
| 2026-11-13 | 1 | Frontend + backend audit complete; Better Auth 1.7.23 docs verified; workerd hashing benchmark (scrypt 115–144 ms, PBKDF2 100k 123 ms); catch-all syntax corrected to Cloudflare's `[[all]]`; `02-plan.md` written; awaiting owner approval |
| 2026-11-13 | 2 | Installed `better-auth@1.7.23` (exact); added auth factory + `/api/auth/[[all]].js` + customer session helper + validation; generated/reviewed `0033_better_auth.sql` (5 tables); applied locally; signup/login/logout/update/duplicate-email/rate-limit tests passed; admin login/session/logout still hit their static routes; temp schema endpoint deleted; lint green |
| 2026-11-13 | 2 | PR #117 merged to `main`; production deployment `701a5708-470d-493b-942f-ea6bb182a381` active. Production signup/signin/get-session/signout verified on `https://chou3abelak.site`; cookie `__Secure-chou.session_token` (HttpOnly/Secure/SameSite=Lax); CPU tail `outcome: ok` at 162–172 ms; admin routes still JSON; evil origin 403. Test accounts deleted (0 remaining). |
| 2026-11-13 | 3 | Added auth/account sheets, header profile button, profile phone/address table, session-scoped order history (365 days), order linking, admin registered-customer badge, and admin Accounts view. Migrations 0034/0035 applied locally. Browser-tested EN/dark + AR/light, prefill, orders, settings, signout. |
| 2026-11-13 | 3 | PR #119 merged; production D1 backed up + 0034/0035 applied; deployment `fa5fdd99` active. Production signup/sign-in/profile PATCH/account orders/sign-out verified; anonymous admin customers 403; profile button + auth sheet present. Test account deleted (0 remaining). |
| 2026-11-13 | 4 | Google OAuth code + UI: provider gated by both secrets, public-config probe, Google button + or divider, CSP avatar host, exact Console runbook. Fake-credential test confirmed redirect URI + minimal scopes; real consent pending owner credentials. |
| 2026-11-13 | 4 | PR #120 merged; production deployment `1470eaf0` active; `/api/auth/public-config` → `{"google":false}` so the button is safely hidden until the owner adds the two Google secrets. |
| 2026-11-14 | 5 | Added Resend reset/verification emails (bilingual), require-email-verification gate, forgot/reset UI, resend verification, token stripping, and new rate limits. Tests/lint/build/depcruise green; local AR/RTL forgot/reset UI verified. Production rollout + real inbox test pending. |
