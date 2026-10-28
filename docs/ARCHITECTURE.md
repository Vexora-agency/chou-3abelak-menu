# Architecture — White-Label Base System (5-min read)

```
Browser (React 19 + Vite + Tailwind)
  App.tsx (thin) → features/{menu,cart,orders,admin,reports,backup} → hooks/utils
       │  reads src/config/{client,theme,features,navigation}.config.ts
       │  all /api via src/lib/api-client.ts (adminFetch/publicGet) or features/*/services/*.api.ts
       ▼
Cloudflare Pages Functions (functions/api/**/*.js — THIN: validate → _shared → jsonNoStore)
       ▼
functions/_shared/** (ONLY place with D1 SQL)
  repositories/*.repo.js (orders, reports, report-settings, customer-data)
  orders.js / pricing.js / validate*.js / status.js / plan.js / session.js
       ▼
D1 ORDERS_DB (migrations/*.sql) + KV MENU_KV (menu doc) + R2 REPORTS (CSV/backups)
Scheduler Worker (scheduler/, cron 0 5 * * *) → POST /api/internal/run-reports
```

## Why this shape

- Backend is the PRODUCT (unchanged per client). Frontend is the SKIN (config per client).
- No Express, no MySQL: Pages `onRequest({request,env})` + D1 `?1` binds. SQL lives ONLY in `_shared/**`.
- No Router/Query/Zustand/Axios: single `App.tsx` view + native fetch via `lib/api-client.ts`.
- Plan gates (`SITE_PLAN`, `plan.js` FEATURES.monthlyReports/orderLogging) 404 on starter — frontend flags only hide UI.
- Menu doc in KV is source for prices/names; D1 stores orders; R2 stores CSVs/backups. Validation mirrored: `functions/_shared/validate*.js` (normative) + `src/utils/*` + `src/types/menu.ts`.
