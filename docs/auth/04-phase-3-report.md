# Phase 3 — Customer Account UI + Admin Customers

Status: ✅ complete locally and deployed to production.
Date: 2026-11-13

> **بالعربي باختصار:** العميل بقى له أيقونة حساب جنب زرار الثيم. لو مش مسجل
> تفتح شيت دخول/إنشاء حساب، ولو مسجل تفتح شيت فيه طلباته آخر سنة وبياناته
> (الاسم/الهاتف/العنوان) مع زرار خروج. الطلب بيتسجل باسم الحساب لو مسجل،
> والأدمن بيشوف بادج "عميل مسجل" على الطلبات، وله تبويب "الحسابات" فيه
> كل العملاء المسجلين وتفاصيلهم وإحصائياتهم. الواجهة اتجربت عربي/إنجليزي
> ودارك/لايت، واترفعت على production واتجربت على الدومين الحقيقي.

---

## 1. What shipped

### Customer

- Header profile button beside the theme toggle (44×44, label on desktop, icon on mobile).
- Sign-in / create-account bottom sheet (desktop centered modal):
  - labels, autocomplete, show/hide password, password checklist, loading/disabled submit, Enter submit, inline errors.
  - generic sign-in error (no email enumeration).
  - after signup: "account created, sign in" (server `autoSignIn: false`).
- Account sheet opened from the profile button:
  - **My orders**: last 365 days, expandable cards with items, totals, address, notes, status, date.
  - **Settings**: name, phone, default address; email read-only; member-since; save.
  - **Sign out**.
- Checkout prefill: empty name/phone/address/email fields are filled from the signed-in profile; typed values are never overwritten.
- Empty/loading/error states, retry, session-expired state.
- Dark + light themes, Arabic/English, full RTL.
- Lazy chunks for both sheets; motion is transform/opacity/height only; no backdrop-filter.

### Orders

- New orders placed while signed in get `orders.customer_user_id` from the **server session only**.
- Guest orders stay `NULL`; session lookup failure never blocks a guest order.
- Idempotent replay never re-attaches an existing order to another user.
- Account order queries are scoped by `customer_user_id = session.user.id`; a client-supplied user id is ignored.
- Order detail returns 404 for a different customer (no existence probe).

### Admin

- Orders list shows a "Registered customer" badge when `customerUserId` is present.
- New dashboard sub-view **Accounts** ("الحسابات"):
  - search by name/email/phone;
  - every registered account with email verification badge, phone, address, joined date, last order, order count, total spent;
  - loading/error/empty states; owner/client only (kitchen excluded by the existing gate).

---

## 2. Data changes

| Migration | What |
|-----------|------|
| `0034_orders_customer_link.sql` | `orders.customer_user_id` nullable + `(customer_user_id, created_at DESC)` index |
| `0035_customer_profiles.sql` | `customer_profiles` (user_id PK → user cascade, phone, address, updated_at) + phone index |

No backfill. Existing orders stay guest orders.

### APIs

| Route | Purpose |
|-------|---------|
| `GET /api/account/orders?days=365&limit=50` | own history, session-scoped |
| `GET /api/account/orders/:number` | own order detail, 404 if not owner |
| `GET /api/account/profile` | own name/email/image + phone/address |
| `PATCH /api/account/profile` | update phone/address (name via Better Auth `updateUser`) |
| `GET /api/admin/customers?q=&limit=200` | registered accounts + stats (admin middleware) |

All customer routes require `X-Requested-With: menu-customer` and a valid session. The admin route keeps the existing `menu-admin` gate and is denied to kitchen.

---

## 3. Files

### New

- `src/lib/auth-client.ts`
- `src/features/auth/` (components, hooks, services, strings, types, barrel)
- `src/features/admin/components/admin/AdminCustomersTab.tsx`
- `functions/api/account/{orders.js,profile.js,orders/[number].js}`
- `functions/api/admin/customers.js`
- `functions/_shared/repositories/customers.repo.js`
- `migrations/0034_orders_customer_link.sql`, `0035_customer_profiles.sql`
- `scripts/test-auth-profile-policy.mjs`, `test-order-link.mjs`, `test-account-orders-scope.mjs`

### Changed

- `App.tsx` — sheets + header callbacks.
- `Header.tsx`, `HeaderTopBar.tsx` — profile button/session state.
- `CartDrawer.tsx`, `useCartCheckoutSubmit.ts` — profile prefill.
- `functions/api/orders.js`, `orders.repo.js`, `orders.js` — session link + mapping.
- `OrdersDashList.tsx`, `ordersDashTypes.ts` — registered badge.
- `AdminDashboardTab.tsx`, `AdminPanel.tsx`, `useReportCenter.ts` — Accounts view + `/admin/accounts` deep link.
- `migrations/README.md`, `package.json` (test:auth additions).

---

## 4. Verification

| Check | Result |
|-------|--------|
| `npm run test:auth` | ✅ 8 test files green |
| `npm run lint` | ✅ |
| `npm run build` | ✅ (AuthSheet/AccountSheet split into own chunks) |
| `npx depcruise src functions scheduler scripts` | ✅ |
| `npm run test:headers` | ✅ 20/20 |
| `npm run test:access` | ✅ |
| `npm run test:kitchen-gate` | ✅ |
| Local signup → sign-in | ✅ |
| Profile GET/PATCH | ✅ phone/address persisted |
| Real `POST /api/orders` while signed in | ✅ `customer_user_id` stored |
| Account history + detail | ✅ 200; no-cookie 401 |
| Admin customers API | ✅ account + stats returned |
| Admin orders API | ✅ `customerUserId` present |
| Browser EN + dark | ✅ account sheet, orders, settings, prefill, signout |
| Browser AR + light | ✅ RTL, white sheet, Arabic labels, order history |
| Test rows | ✅ removed locally |

---

## 5. Pending

- Google button remains Phase 4.
- Password reset/email verification remain Phase 5.
- A dedicated `/account` URL is not required by this design: the profile button opens the account sheet. A page can be added later without changing the data layer.

## 6. Production deployment (2026-11-13)

| Item | Value |
|------|-------|
| PR | #119 `feat/customer-accounts-ui` → `main` |
| Merge commit | `18fa37f` |
| Pages deployment | `fa5fdd99-d1c7-455b-bd51-d1557f967447` (Active, Production, branch `main`) |
| Production domain | `https://chou3abelak.site` |
| D1 backup | `C:\Users\Mina\Desktop\backups\chou-before-accounts-2026-11-13.sql` (17,335 bytes; outside repo) |
| Migrations | `0034_orders_customer_link.sql` + `0035_customer_profiles.sql` applied remotely; verified `customer_profiles`, `idx_orders_customer_user_id`, and `orders.customer_user_id` |

### Production verification

| Check | Result |
|-------|--------|
| Signup | ✅ 200, `token: null` |
| Sign-in | ✅ 200 + secure cookie |
| Profile GET | ✅ 200, empty phone/address |
| Profile PATCH | ✅ 200, phone/address persisted |
| Account orders | ✅ 200, `count: 0` for a fresh account |
| Sign-out | ✅ 200 |
| Anonymous admin customers | ✅ 403 |
| Storefront header | ✅ "Sign in" profile button present |
| Production auth sheet | ✅ opens, LTR, "Welcome back" |

The production test account was deleted; D1 returned `remaining = 0`.

