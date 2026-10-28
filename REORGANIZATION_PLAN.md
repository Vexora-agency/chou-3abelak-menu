# REORGANIZATION_PLAN — White-Label Sellable System (Adapted)

Generated: 2026-10-28. Source of truth: `.opencode/skills/white-label-sellable-system/SKILL.md` (adapted, NOT the original Express/MySQL prompt).

## 1. SCAN Results (verified from code)

**Routes — 35 files in `functions/api/`**
- Public: `menu.js`, `ordering-state.js`, `orders.js` (POST), `privacy-info.js`, `reports/confirm.js`, `auth/session|login|logout.js`, `internal/run-reports.js`
- Admin: `admin/menu.js`, `admin/orders.js`, `admin/orders/[id].js`, `admin/reports.js`, `admin/reports/[month].js`, `admin/report-settings*.js` (+`/resend`, `/test`), `admin/backup/*` (export|csv|print|auto), `admin/versions*.js` (+`[id]/changes`, `[id]/restore`), `admin/trash*.js` (+`[id]`, `[id]/restore`), `admin/import/analyze|apply.js`, `admin/ordering/pause.js`, `admin/customer-data/status|search|action.js`, `admin/activity.js`, `admin/_middleware.js`

**Tables — `migrations/` (D1 SQLite, `?1` binds)**
- `0001_orders.sql` orders (id, number UNIQUE, idem_key UNIQUE, status CHECK, type CHECK, items_json, subtotal/delivery_fee/total, lang)
- `0003_reports.sql` monthly_reports + report_settings
- `0004_orders_nullable_pii.sql` PII nullable (retention NULLs — must stay nullable)
- `0005_location_phone_norm.sql` location_lat/lng + phone_norm + index + backfill

**Frontend — `src/` (~100+ files)**
- `App.tsx` (292 lines, composes everything) + `main.tsx`
- components: Header, Footer, SearchAndChips, FeaturedCarousel, MenuList, CartBar, CartDrawer, ItemDetailsModal, ItemEditModal, AdminPanel, AdminLogin, OrdersDashboard, ReportsPanel, BackupPanel, CustomerData, LocationPicker + subfolders (admin/, admin-login/, backup/, cart/, header/, item-editor/, item-view/, menu-list/, orders/, location/, features/)
- hooks (22): useMenuLoader, useShopCartState, useAdminSaveAuth, useAdminSaveMenu, useAdminApi, useAdminCatalog, useAdminOrders, useAppPrefs, useOrderingState, useCartCheckoutSubmit, useReportCenter, useBackupHistory, useOrdersDash*, useHeader*, useTickerLoop, useItemEditorSections, useMenuList*, useMidSplitLocationMap, useMenuSaver
- utils (13): pricing, pricing-menu, pricing-badges, menuHelpers, menuValidation, status.ts (mirrors `functions/_shared/status.js`), serverTime, safeJson, tz, whatsapp, cardMark, announcement, settingsDefaults
- types: `menu.ts` (must stay in sync with `functions/_shared/validate*.js` + `menu.seed.json`)

**Messy areas (must fix per skill)**
1. 100+ hardcoded `bg-[#FFC400]` / `bg-[#0A0A0A]` / `text-[#FFC400]` across `src/` + `:root` in `src/styles/base.css` (`--yellow`, `--black`) duplicated in TS nowhere → need `src/config/theme.config.ts`.
2. Hardcoded `/assets/logo-final.png` + `Chou 3abelak` in `App.tsx:84,111-112` → need `src/config/client.config.ts`.
3. 12 raw `fetch('/api…')` in `useAdminSaveAuth.ts:23,42,69`, `useCartCheckoutSubmit.ts:186`, `useReportCenter.ts:27,59,95,112,123`, `useMenuLoader.ts:38,90`, `utils/status.ts:29` → need `src/lib/api-client.ts`.
4. 12 SQL violations (SQL directly in `functions/api/`): `orders.js:133,152,184,192,232`, `admin/orders.js:57`, `admin/orders/[id].js:51,58`, `admin/reports.js:38`, `reports/confirm.js:37,54`, `admin/report-settings.js:107`, `admin/customer-data/action.js:55,58,63` → must move to `functions/_shared/repositories/*.repo.js`.
5. Missing: `src/config/`, `src/features/`, `src/components/ui/`, `src/lib/api-client.ts`, `docs/ARCHITECTURE.md`, `docs/ADD_NEW_FEATURE.md`, `docs/ADD_NEW_CLIENT.md`, `scripts/setup-new-client.sh`.
6. Backend already thin + plan-gated via `functions/_shared/plan.js` (`SITE_PLAN`, `FEATURES.monthlyReports/orderLogging`) — keep, expose to frontend via `features.config.ts`.

## 2. What Will Be Created (additive, no deletions)

- `src/config/client.config.ts`, `theme.config.ts`, `features.config.ts`, `navigation.config.ts`, `index.ts`
- `src/lib/api-client.ts` (+ `src/lib/query-client.ts` placeholder doc)
- `src/components/ui/Button.tsx`, `Input.tsx`, `Card.tsx`, `Table.tsx`, `Modal.tsx`, `index.ts`
- `src/features/menu|cart|orders|admin|reports|backup/index.ts` (public API re-exports of EXISTING code — zero behavior change)
- `functions/_shared/repositories/orders.repo.js`, `reports.repo.js`, `report-settings.repo.js`, `customer-data.repo.js`, `index.js`
- `docs/ARCHITECTURE.md`, `docs/ADD_NEW_FEATURE.md`, `docs/ADD_NEW_CLIENT.md`
- `scripts/setup-new-client.sh` (+ `.env.example` already exists — verify)

## 3. What Will Be Moved (behavior-preserving)

- Backend: `functions/api/*.js` SQL → calls into `repositories/*.repo.js`. Same queries, same binds, same responses. `orders.js` insert+idem logic extracted verbatim.
- Frontend: 12 `fetch()` call sites → `apiFetch()` with identical headers (`credentials:same-origin`, `X-Requested-With: menu-admin`), identical timeouts (2.5s ordering-state, 4s orders), identical fail-open/fail-closed semantics.
- `App.tsx`: loader + progress bar read `themeConfig`/`clientConfig` (visual identical — same hex). Rest of hardcodes documented for Phase 2 codemod (too risky to rewrite 100 files in one turn).

## 4. What Will NOT Be Touched (to lose nothing)

- No migration files edited. No `menu.seed.json` shape change. No `admin` auth flow change. No WhatsApp message change. No retention/purge logic change. No scheduler change.
- No deletions of old folders — `src/components/*`, `src/hooks/*`, `src/utils/*` stay; `features/` re-exports them.
- No new deps (no Router/Query/Zustand/Axios) — skill forbids them for this repo.

## 5. Verification

- `npx tsc --noEmit` (== `npm run lint`) green
- `npm run build` (vite) green
- Spot API route import check: every refactored `functions/api/*.js` still exports `onRequest`
- Done checklist from skill §10 evaluated honestly (partial hardcodes remain → Phase 2 noted in docs).

## Verification log (2026-10-28, post-review fixes)

- `npx tsc --noEmit` → clean (TSC-OK)
- `npm run build` → `✓ built in ~2.5s`
- `npm run test:client` → 23 passed, 0 failed
- `node scripts/test-status.mjs` → 31 passed, 0 failed
- `node scripts/test-features.mjs` → 21 + 25 passed, 0 failed
- `grep db.prepare|INSERT|UPDATE|DELETE functions/api` → 0 matches (SQL only in `functions/_shared/**`)
- `grep fetch('/api src` → 0 matches (all transport via `src/lib/api-client.ts`)

## Review fixes applied (code-review: Standards + Spec)

- `cart.api.ts` uses `publicPostRaw` from `lib/api-client` (no raw fetch in features)
- `insertOrderWithNumber(db, cleaned, num, nowIso)` — one timestamp per request (verbatim retry semantics)
- Order window SQL templates moved into `listOrdersByWindow` (routes pass values only)
- `markReportAttempt(db, month, attempts, maxAttempts)` — threshold from route `MAX_ATTEMPTS`
- `updateAttemptState` shared by pending/attempt; `likePhoneNorm` shared by customer-data repo
- Reports tab gated on `featuresConfig.enableReports` in `AdminDashboardTab` (current client: no visual change)
- `setup-new-client.sh` (perl) replaced by `setup-new-client.mjs` (Node, validates `#RRGGBB`, correct `public/assets/` paths)
- `AdminFetch` shared type in `lib/api-client` (was duplicated in 4 files); `postJson` dead helper removed
- Intentionally kept: `features/*/index.ts` Phase-1 re-export bridge (no file moves — zero breakage risk);
  `bg-black` in `App.tsx` auth view (original `#000`, NOT theme bg — changing it would alter pixels);
  `[adminFetch]` effect dep (stable `useCallback([])` identity → same behaviour, lint-clean).
