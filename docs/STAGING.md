# Staging via Pages preview environments (per-client account)

Previews are NOT a second project. Every pull request gets an isolated
deployment (`<hash>.<site>.pages.dev`, plus a `<branch>.<site>.pages.dev`
alias) that can carry its OWN bindings — so staging data can never touch
production data, even though it runs the same code.

Sources (fetched 2026-11-01):
- Preview deployments: https://developers.cloudflare.com/pages/configuration/preview-deployments/
- Wrangler configuration (env.preview overrides): https://developers.cloudflare.com/pages/functions/wrangler-configuration/
- Free-plan Pages limits: https://developers.cloudflare.com/pages/platform/limits/ (500 builds/mo, 20k files/site)

## What "staging" means here

| Environment | URL | D1 | KV | R2 | Secrets |
|---|---|---|---|---|---|
| Production | custom domain + `<site>.pages.dev` | prod ORDERS_DB | prod MENU_KV | prod REPORTS | real keys |
| Preview (staging) | `<branch>.<site>.pages.dev` | `chou-3abelak-orders-preview` (`9011d17f-…`, migrated through 0017) | `MENU_KV_PREVIEW` (`d4ef20c5…`, seeded with `menu.seed.json`) | `chou-3abelak-reports-preview` | fake keys, `SITE_PLAN` as needed |
| Local | `localhost:3000` | `--local` emulator | local KV | throwaway | `.dev.vars` (git-ignored) |

Preview bindings are configured in the Cloudflare dashboard (Settings >
Bindings); the `[env.preview]` block in `wrangler.toml` documents the same
mapping for CLI deploys. VERIFIED 2026-11-01: for git-connected deploys the
dashboard wins — a fresh preview deploy WITH `[env.preview]` ids in the file
still served no D1 binding (`/api/health?deep=1` → 503 while `/api/health`
→ 200 `{"ok":true}`). The file block is documentation + CLI convenience only.

## Owner hand-do list (Cloudflare dashboard, per client account)

1. Workers & Pages → project → Settings → Bindings → **Preview** tab (NOT Production):
   - D1: create `chou-3abelak-orders-preview` (`wrangler d1 create …`), bind as `ORDERS_DB`, then `npx wrangler d1 migrations apply ORDERS_DB --remote` while the preview database is selected.
   - KV: create `MENU_KV_PREVIEW`, bind as `MENU_KV`.
   - R2: create `chou-3abelak-reports-preview`, bind as `REPORTS`.
2. Settings → Environment variables → **Preview**: `SITE_PLAN` (match what you test), fake `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` / `SESSION_SECRET` (generate fresh — never copy production), leave Resend/Telegram/WhatsApp keys **unset**.
3. Settings → Builds & deployments → Preview deployments: keep "All non-production branches" ON (this is the staging flow: every PR gets a URL).
4. Optional hardening: Access → protect preview deployments so only the team can open staging URLs (see preview-deployments doc, "Customize preview deployments access").
5. Verify: open `<branch>.<site>.pages.dev`, place a fake order, confirm it appears ONLY in the preview DB (`npx wrangler d1 execute <preview-db> --remote --command "SELECT count(*) FROM orders"`), then delete the test rows.
6. Confirm which config wins (file vs dashboard): after the first preview deploy, check deployment details → Bindings and record the answer here.

## Free-plan preview costs (same account quotas)

- Each PR push consumes one of **500 builds/month**; preview requests count toward the 100k/day Workers budget; preview D1/KV/R2 usage counts toward the same free quotas as production. For one restaurant client this is noise; do not run load tests against preview.
- Cron triggers do NOT fire on preview deployments — the scheduler Worker only calls production `/api/internal/run-reports`.

## Local staging (no dashboard needed)

`npx wrangler pages dev ./dist --port 3000` uses the local emulator with throwaway state (see README). For a persistent local stand-in, copy `.dev.vars.example` to `.dev.vars` (git-ignored, never commit) — values are fake by design.
