# Add a New Client in <1h (checklist)

1. `git clone base-system new-client && cd new-client && npm install`
2. Run: `node scripts/setup-new-client.mjs "Client Name" "#PRIMARY" [starter|pro|signature]` — patches `src/config/*` + `src/styles/base.css`. Or edit manually:
   - `src/config/client.config.ts` (companyName, logo, supportEmail)
   - `src/config/theme.config.ts` (primary, background) + mirror in `src/styles/base.css :root`
   - `src/config/features.config.ts` (enableReports/orderLogging per package: starter=false, pro/signature=true)
   - `public/assets/` (replace `logo-final.png` + `email-logo.png`, or update client.config logo path)
3. Env (Cloudflare Pages → Settings → Production): `SITE_PLAN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `RESEND_API_KEY`, `MAIL_FROM_DOMAIN_EMAIL`, `REPLY_TO`, `SITE_URL`, `CRON_SECRET`, `BACKUP_SECRET`, `AUDIT_SECRET`.
4. Resources: create fresh D1 + KV + R2, bind as `ORDERS_DB`, `MENU_KV`, `REPORTS`. Run `npx wrangler d1 migrations apply ORDERS_DB --remote`.
5. `npm run build` → deploy Pages → smoke test: menu loads, order 403/200, admin login, reports 404 on starter.
6. Backend untouched. Never `if (client === …)` — use config flags.

Phase 2 note: ~100 legacy `bg-[#FFC400]` hardcodes remain (App wired, rest queued). New code MUST use `themeConfig`/`components/ui`. Codemod: `bg-[#FFC400]` → `bg-[var(--yellow)]`, `bg-[#0A0A0A]` → `bg-[var(--black)]`.
