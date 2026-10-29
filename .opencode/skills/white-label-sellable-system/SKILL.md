---
name: white-label-sellable-system
description: "Transform this repo into a white-label sellable base system. Adapted for this project's actual stack: React 19 + Vite + Tailwind v4 + Cloudflare Pages Functions + D1 SQLite + KV + R2. Enforces feature-based frontend, thin Pages routes, D1 SQL only in functions/_shared, config-driven theming and feature flags for selling to multiple clients."
---

# White-Label Sellable System — Adapted for Chou 3abelak

> This is an ADAPTED version of the MASTER React+SQL prompt.
> The original prompt assumed Node/Express + MySQL/Postgres + React Router + React Query + Zustand + Axios.
> This repo is DIFFERENT. This skill is the source of truth — follow it, not the original.

## 0. Actual Stack (verified)

- Frontend: React 19 + Vite 8 + Tailwind v4 + TypeScript + motion + lucide + Leaflet. No Router, no Query, no Zustand, no Axios — native `fetch` via hooks.
- Backend: Cloudflare Pages Functions `functions/api/**/*.js` with `onRequest({request, env})`. No Express.
- DB: D1 SQLite (`ORDERS_DB`, bind `?1` syntax) + KV (`MENU_KV` menu doc + rate limits) + R2 (`REPORTS` CSVs/backups). Migrations in `migrations/*.sql` via wrangler.
- Scheduler: separate Worker in `scheduler/` (cron `0 5 * * *`).
- Validation: `functions/_shared/validate*.js` (backend) + `src/utils/*` + `src/types/menu.ts` (frontend). Must stay in sync manually.

## 1. Non-Negotiable Architecture

```
chou-3abelak-menu-main/
├── src/
│   ├── config/                  # !!! MOST IMPORTANT FOR WHITE-LABEL — CREATE THIS !!!
│   │   ├── client.config.ts     # companyName, logo, supportEmail, siteUrl
│   │   ├── theme.config.ts      # colors, fonts, radius — design tokens → CSS vars
│   │   ├── features.config.ts   # { invoicing, chat, analytics, orderLogging, reports } per package tier
│   │   └── navigation.config.ts # sidebar links, driven by features.config
│   ├── features/                # FEATURE-BASED — CREATE THIS (migrate to it gradually)
│   │   ├── menu/                # components/, hooks/, services/, types.ts, index.ts
│   │   ├── cart/
│   │   ├── orders/
│   │   ├── admin/
│   │   ├── reports/
│   │   └── [new-feature]/       # same shape
│   ├── components/
│   │   ├── ui/                  # ONLY generic UI: Button, Input, Modal, Table, Card — CREATE THIS
│   │   └── ...                  # existing domain components stay until migrated
│   ├── lib/
│   │   └── api-client.ts         # SINGLE fetch wrapper — ALL features must use it — CREATE THIS
│   ├── hooks/                   # existing global hooks (useMenuLoader, useAdminApi…) — keep, slim down
│   ├── utils/ types/ styles/
│   └── App.tsx                  # ROUTING ONLY (<30 lines per view, imports from features/)
│
├── functions/
│   ├── api/                     # THIN Pages routes: validate → _shared service → jsonNoStore
│   └── _shared/                 # ONLY place where D1 SQL lives (db.prepare/bind). Service + validation layer.
│                                # status.js, orders.js, reports*.js, versions*.js, plan.js, session.js
├── migrations/                  # D1 migrations, numbered: 0006_*.sql — never edit applied ones
├── scheduler/                   # cron Worker — untouched per client except CLIENT_ENDPOINTS secret
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ADD_NEW_FEATURE.md
│   └── ADD_NEW_CLIENT.md
└── scripts/setup-new-client.mjs  # copy repo + patch src/config + logos + SITE_PLAN (Node, cross-platform)
```

## 2. Backend Rules (Cloudflare, NOT Express)

1. **SQL ONLY in `functions/_shared/*.js`:** `db.prepare`, `.bind`, `SELECT/INSERT` forbidden outside `_shared`. If found in `functions/api/`, MOVE it.
   ```js
   // _shared/orders.js — ONLY place for SQL
   export async function insertOrder(db, order) {
     return db.prepare('INSERT INTO orders (id, number, ...) VALUES (?1,?2,...)').bind(...).run();
   }
   ```

2. **Routes THIN:** `functions/api/orders.js` validates input, checks ordering-state/plan gate, calls `_shared`, returns `jsonNoStore`. No business logic, no raw SQL.
   ```js
   export async function onRequest({ request, env }) {
     const body = await readJsonBody(request, MAX_BODY_BYTES);
     const checked = validateOrderInput(body, menu); // from _shared
     if (!checked.ok) return jsonNoStore({ error: checked.errors[0] }, 400);
     return jsonNoStore({ ok: true, ... });
   }
   ```

3. **Migrations:** every DB change = new file `migrations/NNNN_name.sql` with `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE`. Apply: `npx wrangler d1 migrations apply ORDERS_DB --local` then `--remote`.

4. **Validation:** every route validates via `functions/_shared/validate*.js`. Never trust client totals — recompute from KV menu.

5. **Plan gates:** `functions/_shared/plan.js` (`SITE_PLAN` env: starter/pro). Starter returns 404 for gated features (reports/orderLogging/backups/announcements). Never branch on client name.

## 3. Frontend Rules (React, no Router/Query)

1. **App thin:** `App.tsx` composes features only. No `useState` business logic in pages — move to `features/[x]/hooks/`.

2. **Feature isolation:** `features/menu` must not deep-import from `features/orders`. Only via `features/orders/index.ts` public API. Deleting `features/X` must not break other builds.

3. **Single API client** `src/lib/api-client.ts`:
   ```ts
   export async function apiFetch(url: string, init?: RequestInit) {
     const res = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'X-Requested-With': 'menu-admin', ...(init?.headers||{}) } });
     if (!res.ok) throw new ApiError(res.status, await res.text());
     return res.json();
   }
   ```
   All `features/*/services/*.api.ts` must use it. No raw `fetch('/api/...')` outside it after migration.

4. **Config-driven UI — CRITICAL FOR SELLING:**
   ```ts
   // config/client.config.ts
   export const clientConfig = { companyName: 'Chou 3abelak', logo: '/assets/logo-final.png', supportEmail: 'info@vexora.agency' };
   // config/theme.config.ts
   export const themeConfig = { colors: { primary: '#FFC400', bg: '#0A0A0A' }, fontFamily: 'Inter', radius: '0.75rem' };
   // config/features.config.ts
   export const featuresConfig = { enableReports: false, enableOrderLogging: false, enableChat: false };
   ```
   NEVER hardcode colors/logo/company. Read from config → CSS vars.

5. **Design system:** build `components/ui/*` (Button, Input, Card, Table, Modal). All features use them, not raw HTML.

## 4. Shared / Contract Rules

- No `shared/contracts` TS package (original prompt) — instead: `src/types/menu.ts` + `functions/_shared/validate*.js` + `src/utils/safeJson.ts` must describe the SAME shape. When menu schema changes, update all three + `menu.seed.json`.
- Never duplicate zod-like logic: backend `validate*.js` is normative; frontend `normalizeMenu` mirrors it for fail-open cache.

## 5. White-Label Selling Strategy

1. Backend agnostic: returns raw data, never client-specific UI.
2. Frontend decides presentation via `src/config/*` + `SITE_PLAN` env.
3. **NEVER:** `if (client === 'clientA')`. Use feature flags.
4. Sell to new client:
   - `git clone base new-client`
   - Edit ONLY: `src/config/client.config.ts`, `theme.config.ts`, `features.config.ts`, `public/assets/` logos, `.env` (`SITE_PLAN`)
   - `npm run build` → deploy Pages + bind fresh D1/KV/R2 → `wrangler d1 migrations apply --remote`
   - Backend untouched.

## 6. Maintainability Protocol

**New feature (e.g. Invoices):**
1. Migration `migrations/0006_invoices.sql`
2. Backend: `_shared/invoices.js` (SQL+logic) + `functions/api/invoices.js` (thin route) + validate
3. Frontend: `src/features/invoices/` (components/hooks/services/types/index.ts)
4. Page wiring in `App.tsx`, flag in `features.config.ts`

**New client:** `node scripts/setup-new-client.mjs "Name" "#PRIMARY" [plan]` → patch config + logos → build → bind resources.

**Modify feature:** touch only its folder. No cross-feature edits.

## 7. Documentation to Create

- `README.md`: install, `serve-local.bat`, env vars, architecture ASCII
- `docs/ARCHITECTURE.md`: data flow (KV menu → React, D1 orders, R2 reports), why this shape
- `docs/ADD_NEW_FEATURE.md`, `docs/ADD_NEW_CLIENT.md`: checklists <1h

## 8. Coding Standards

- TS strict, no `any`; ESLint + Prettier; kebab-case folders, PascalCase components, camelCase fns
- Barrel exports per feature (`index.ts` public API only)
- No circular deps (`npm run lint:circular` must pass)
- Errors: `jsonNoStore({error})` backend; ErrorBoundary frontend; D1 `?1` binds only (no string interpolation)

## 9. Execution Workflow

1. SCAN: list routes (`functions/api`), tables (`migrations`), components, hooks, messy areas
2. PLAN: write `REORGANIZATION_PLAN.md` (features found, moves, new files) — log it
3. SCAFFOLD: create `src/config/`, `src/features/`, `src/components/ui/`, `src/lib/api-client.ts` with placeholders
4. MIGRATE backend: ensure no SQL outside `_shared`; thin routes; plan gates via `plan.js`
5. MIGRATE frontend: move domain code into `features/`; pages thin; replace hardcodes with config
6. CLEANUP: delete old, fix `@/` imports, `npm run lint` + `build` green, remove dead code
7. DOCUMENT: README + 3 docs + `.env.example`

## 10. Done Definition

- [ ] Change logo + primary in ONE file → whole site changes
- [ ] `enableReports: false` hides Reports tab + API 404s on starter
- [ ] Deleting `src/features/X` breaks nothing else
- [ ] No `db.prepare` outside `functions/_shared/*.js`
- [ ] No raw `fetch('/api')` outside `lib/api-client.ts` + `features/*/services/`
- [ ] No hardcoded client name/logo/color
- [ ] `npm run lint` + `npm run build` green
- [ ] New dev understands system in 10 min via `docs/ARCHITECTURE.md`
- [ ] Backend testable via curl/Postman standalone
- [ ] `docs/ADD_NEW_CLIENT.md` accurate

## 11. Anti-Patterns

- ❌ Express `req/res/next`, `pool.query`, MySQL `?` placeholders — this is Pages+D1 (`onRequest`, `?1`)
- ❌ Installing React Router / React Query / Zustand / Axios for this — use existing hooks + fetch wrapper
- ❌ `utils.ts` monster — split `utils/format.ts`, `utils/validation.ts`
- ❌ Business logic in components; SQL in routes; hardcoded client values
- ❌ Deep imports across features; leaving old folders beside new structure
