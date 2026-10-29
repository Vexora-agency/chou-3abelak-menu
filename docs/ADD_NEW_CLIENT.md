# Add a New Client in <1h (checklist)

1. `git clone base-system new-client && cd new-client && npm install`
2. Run: `node scripts/setup-new-client.mjs "Client Name" "#PRIMARY" [starter|pro|plus]` — patches `src/config/*` + `src/styles/base.css`. Or edit manually:
   - `src/config/client.config.ts` (companyName, logo, supportEmail)
   - `src/config/theme.config.ts` (primary, background) + mirror in `src/styles/base.css :root`
   - `src/config/features.config.ts` (enableReports/orderLogging/backup/customerData/announcements per package: starter=false, pro/plus=true)
   - `public/assets/` (replace `logo-final.png` + `email-logo.png`, or update client.config logo path)
3. Env (Cloudflare Pages → Settings → Production): `SITE_PLAN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `RESEND_API_KEY`, `MAIL_FROM_DOMAIN_EMAIL`, `REPLY_TO`, `SITE_URL`, `CRON_SECRET`, `BACKUP_SECRET`, `AUDIT_SECRET`.
4. Resources: create fresh D1 + KV + R2, bind as `ORDERS_DB`, `MENU_KV`, `REPORTS`. Run `npx wrangler d1 migrations apply ORDERS_DB --remote`.
5. `npm run build` → deploy Pages → smoke test: menu loads, order 403/200, admin login, reports 404 on starter.
6. Backend untouched. Never `if (client === …)` — use config flags.

Phase 2 note: brand codemod complete — `theme.config.ts primary` drives the whole site via `var(--primary)`. Intentionally left as-is: `#8a6d00` light-mode tints, canvas particle fallback, `public/privacy.html` static page (own `<style>`, future work).
