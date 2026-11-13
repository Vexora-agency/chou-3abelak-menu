# Decision Log

Last updated: 2026-11-13
Status: Phase 1 approved; Phase 2 complete locally and in production; Phase 3 complete locally and in production. Preview host pending.

> Format: one decision per row, with the date, the choice, and the reason.
> When an owner answer arrives, fill the "Answer" column and the date — do not
> rewrite history. If a decision changes, add a new row that supersedes it.

---

## 1. Technical decisions (made in Phase 1)

| # | Date | Decision | Reason |
|---|------|----------|--------|
| T1 | 2026-11-13 | Pin `better-auth@1.7.23` (exact) | Latest stable on 2026-11-13; native D1; current security fixes. Exact pin avoids surprise breaking changes between phases. |
| T2 | 2026-11-13 | ~~Pin CLI `auth@1.7.23` as a devDependency~~ → superseded by T21 | Original plan was to install the CLI. |
| T3 | 2026-11-13 | Use native D1 (`database: env.ORDERS_DB`) | Official since Better Auth 1.5; built-in Kysely adapter; no extra adapter package; fewer moving parts. |
| T4 | 2026-11-13 | Do **not** use `better-auth-cloudflare` | Community package adds supply-chain risk for no benefit over native D1. |
| T5 | 2026-11-13 | Do **not** use Drizzle/Prisma/Kysely packages | The built-in adapter is sufficient; the project has no ORM. |
| T6 | 2026-11-13 | Mount Better Auth at `functions/api/auth/[[all]].js` | Required `/api/auth/*` mount. Pages route specificity keeps the three existing admin static routes working. Verify live in Phase 2; fallback is moving admin routes to `/api/admin-auth/*`. |
| T7 | 2026-11-13 | Create the auth instance per request | Pages bindings/secrets only exist inside a request; no import-time env reads. |
| T8 | 2026-11-13 | Keep admin auth untouched | Owner/staff auth is separate; customer auth must not break it. |
| T9 | 2026-11-13 | Customer cookie prefix `chou`; admin stays `__Host-admin-session` | Clear separation; no cookie-name collisions. |
| T10 | 2026-11-13 | `SameSite=Lax` for customer cookies | Required for the Google OAuth callback. Admin stays `Strict`. |
| T11 | 2026-11-13 | Set `rateLimit.enabled: true` and `advanced.useSecureCookies` explicitly | `NODE_ENV` is unset on Pages; defaults cannot be trusted. |
| T12 | 2026-11-13 | `rateLimit.storage: "database"` (D1 `rateLimit` table) | Memory storage is per-isolate and useless across Pages instances. |
| T13 | 2026-11-13 | `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]` | Cloudflare replaces this header; `x-forwarded-for` is client-spoofable. |
| T14 | 2026-11-13 | Keep account-linking defaults; do **not** add Google to `trustedProviders` | `requireLocalEmailVerified` defaults true; silent linking to an unverified password account is unsafe. |
| T15 | 2026-11-13 | Email verification + password reset deferred to Phase 5 | Resend approved for Phase 5; schema does not change when they are enabled. |
| T16 | 2026-11-13 | No session cookie cache (default disabled) | Immediate logout/revocation; D1 read per request is acceptable. |
| T17 | 2026-11-13 | Signup `autoSignIn: false` (approved D7) | Activates Better Auth's documented signup email-enumeration protection; one extra sign-in step. Revisit in Phase 5. |
| T18 | 2026-11-13 | Password policy 10–128 + letter + digit, enforced server-side via `hooks.before` | Better Auth exposes length only; complexity needs a hook. UI mirrors the checklist. |
| T19 | 2026-11-13 | No new validation library | Reuse the project's hand-written validators; avoid a dependency for one feature. |
| T20 | 2026-11-13 | Order link column `orders.customer_user_id` (nullable, no backfill) | Additive and safe; server takes the id from the session only; guest orders stay `NULL`. |
| T21 | 2026-11-13 | No CLI devDependency; use `npx auth@1.7.23` on demand (supersedes T2) | The CLI cannot reach D1; schema generation uses the official `getMigrations()` API inside the local Worker. Avoid an unused dependency. |
| T22 | 2026-11-13 | Add `checkCustomerApiHeaders` (`X-Requested-With: menu-customer` + same-origin Origin on mutations) | Reuses the repo's existing anti-CSRF pattern without overloading the admin header value. |
| T23 | 2026-11-13 | Rate limits: sign-in 10/60s, sign-up 5/60s, reset request 3/60s, reset 5/60s | Owner relaxed sign-in/sign-up for shared mobile IPs; reset limits stay strict. |
| T24 | 2026-11-13 | `.dependency-cruiser.json` excludes `node_modules` from the graph | Better Auth bundles kysely, whose internal circular imports are third-party code, not our no-circular rule. |
| T25 | 2026-11-13 | Account UI is a lazy sheet (orders + settings), not a separate `/account` route | The owner's required interaction is "tap profile → see orders/settings"; a sheet is faster on mobile and avoids a new SPA route. A page can be added later without data changes. |
| T26 | 2026-11-13 | Phone/address live in `customer_profiles`, not Better Auth's `user` | Keeps the auth schema untouched; name/email/image stay Better Auth-owned. |
| T27 | 2026-11-13 | Order link is `orders.customer_user_id` written only from the session | Guest checkout stays available; no client-supplied user id; idempotent replays never re-link. |
| T28 | 2026-11-13 | Google provider enabled only when both env credentials exist; UI reads `/api/auth/public-config` | No dead Google button in production before Console setup; no secret exposed to the browser. |
| T29 | 2026-11-13 | Google OAuth uses the canonical apex and `/?account=1` callback | Keeps the OAuth state cookie and callback on one host; account sheet opens after the redirect. www should 301 to apex. |

---

## 2. Password hashing

| Item | Value |
|------|-------|
| Better Auth default | `scrypt` (native `node:crypto` on workerd in 1.7.23) |
| Measured in workerd (local) | 115–144 ms per hash |
| PBKDF2 100k (workerd) | 123 ms |
| PBKDF2 260k (workerd) | 278 ms |
| Workers Free CPU | 10 ms per invocation |
| Workers Paid CPU | up to 5 minutes |

**Decision:** keep the built-in scrypt unless a preview deployment proves it exceeds the Free CPU budget. If it does, the owner chooses between:

- **A:** official custom `password.hash/verify` using PBKDF2-SHA-256 at 100,000 iterations (the Free maximum), or
- **B:** Workers Paid and keep scrypt.

No silent weakening. No custom hashing without an owner decision.

**Related risk (out of scope):** Cloudflare Free rejects WebCrypto PBKDF2 above 100,000 iterations (reported 2026-10-06). The existing admin login uses 260,000, so it may already fail on Free. This feature does not change admin auth; the owner should verify admin login on the current plan.

---

## 3. Owner decisions

| # | Question | Recommendation | Answer | Date |
|---|----------|----------------|--------|------|
| D1 | Confirm protected routes (`02-plan.md` §7) | Approve as listed | ✅ Approved as listed; menu/cart/tracking/invite public | 2026-11-13 |
| D2 | Keep guest checkout or require login? | Keep guest checkout; link orders when signed in | ✅ Keep guest checkout; link only with a valid session; lookup failure never blocks | 2026-11-13 |
| D3 | Email provider for reset/verification | Resend free tier (already integrated for reports) | ✅ Resend free tier, Phase 5 only | 2026-11-13 |
| D4 | Production domain + stable preview host | Exact origins, no wildcards | ✅ production `https://chou3abelak.site` + `https://www.chou3abelak.site`; preview host still pending | 2026-11-13 |
| D5 | Approve `orders.customer_user_id` migration | Approve (nullable, additive, no backfill) | ✅ Approved; Phase 3 | 2026-11-13 |
| D6 | If preview hits Free CPU: PBKDF2 100k or Paid? | Try scrypt first; decide only if it fails | ✅ Production scrypt verified: signup `cpuTime 172`, signin `cpuTime 162`, both `outcome: ok`; no fallback | 2026-11-13 |
| D7 | Signup: `autoSignIn: false` vs instant login | `autoSignIn: false` | ✅ `autoSignIn: false`; revisit in Phase 5 | 2026-11-13 |
| D8 | Google avatar display (one CSP host) | Add `https://lh3.googleusercontent.com` | ✅ added to CSP; provider code ready | 2026-11-13 |

---

## 4. Rejected options (and why)

| Option | Why rejected |
|--------|--------------|
| `better-auth-cloudflare` | Extra dependency; native D1 is official and simpler. |
| Drizzle/Prisma adapter | Project has no ORM; adds schema duplication and migration tooling. |
| Stateless/JWT-only sessions | No immediate revocation; D1 sessions are cheap and simple. |
| Memory rate limiting | Per-isolate; ineffective on Pages. |
| Wildcard `trustedOrigins` | Owner requirement; exact origins only. |
| Reusing `SESSION_SECRET` | Separate systems must have separate secrets; rotation and blast radius. |
| Storing session tokens in `localStorage` | XSS-exposed; HttpOnly cookies are the safe default. |
| Guest order backfill | Cannot prove ownership; guessing leaks data. |
| Changing admin auth to Better Auth | High risk, no user benefit, out of scope. |
