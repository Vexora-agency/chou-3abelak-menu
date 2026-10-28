# Architecture — White-Label Base System (5-min read)

```
Browser (React 19 + Vite + Tailwind v4)
  App.tsx (thin) → features/* barrels (cart, menu, orders, admin, reports,
    backup — each owns components/ + hooks/ + services/, index.ts is the
    public API; cross-feature imports go via barrels only, enforced by
    `npm run lint:isolation`) → shared shell (components/Header, Footer,
    ui/*) + src/hooks (app-shell only) + src/utils
  reads src/config/{client,theme,features,navigation}.config.ts
  all /api via src/lib/api-client.ts (adminFetch/publicGet) or features/*/services/*.api.ts
        ▼
Cloudflare Pages Functions (functions/api/**/*.js — THIN: validate → _shared → jsonNoStore)
        ▼
functions/_shared/** (ONLY place with D1 SQL)
  repositories/*.repo.js — CANONICAL SQL (orders, reports, report-settings, customer-data)
  orders.js / pricing*.js / reports*.js / validate*.js / status.js / plan.js / session.js (logic only, call repos)
        ▼
D1 ORDERS_DB (migrations/*.sql — no 0002 by design, see migrations/README.md) + KV MENU_KV (menu doc) + R2 REPORTS (CSV/backups)
Scheduler Worker (scheduler/, cron 0 5 * * *) → POST /api/internal/run-reports
```

## Why this shape

- Backend is the PRODUCT (unchanged per client). Frontend is the SKIN (config per client).
- No Express, no MySQL: Pages `onRequest({request,env})` + D1 `?1` binds. SQL lives ONLY in `_shared/**`.
- No Router/Query/Zustand/Axios: single `App.tsx` view + native fetch via `lib/api-client.ts`.
- Plan gates (`SITE_PLAN`, `plan.js` FEATURES.monthlyReports/orderLogging) 404 on starter — frontend flags only hide UI.
- Menu doc in KV is source for prices/names; D1 stores orders; R2 stores CSVs/backups. Validation mirrored: `functions/_shared/validate*.js` (normative) + `src/utils/*` + `src/types/menu.ts`. Pricing parity: `src/utils/pricing*.ts` is source of truth, `functions/_shared/pricing*.js` is the mirror — `npm run test:parity` fails on drift (see `docs/PRICING.md`).
