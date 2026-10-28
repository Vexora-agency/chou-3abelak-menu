# Add a New Feature (checklist)

Example: Invoices.

1. DB: create `migrations/0006_invoices.sql` (`CREATE TABLE IF NOT EXISTS invoices …`). Apply local: `npx wrangler d1 migrations apply ORDERS_DB --local`.
2. Backend repo: add `functions/_shared/repositories/invoices.repo.js` with SQL ONLY here.
3. Backend route: add `functions/api/admin/invoices.js` — thin: `checkApiHeaders` → validate → repo → `jsonNoStore`. Register via file-based routing (no app.ts).
4. Validation: extend `functions/_shared/validate*.js` (or new `validate-invoices.js`). Mirror type in `src/types/menu.ts` if menu-related.
5. Frontend: create `src/features/invoices/` with `components/`, `hooks/`, `services/invoices.api.ts` (uses `apiFetch`/`adminFetch` from `src/lib/api-client.ts`), `types.ts`, `index.ts` (public API only).
6. Wire: import in `App.tsx` (or AdminPanel) + add flag in `src/config/features.config.ts` + link in `navigation.config.ts`.
7. Test: `npx tsc --noEmit`, `npm run build`, curl the route, check 404 on starter if plan-gated via `hasFeature(env,…)`.
8. Docs: update this file + `docs/ARCHITECTURE.md` diagram if new table/binding added.
