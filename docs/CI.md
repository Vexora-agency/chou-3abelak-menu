# CI / deploy verification

The deploy gate now runs inside the **Cloudflare Pages build**, not GitHub
Actions. This uses the included Pages builds instead of GitHub Actions
minutes, so it does not need a GitHub billing/spending-limit change.

## What runs on every deploy

Cloudflare Pages runs:

```bash
npm run verify
```

which is:

```bash
npm run lint                 # tsc --noEmit
npm run lint:circular        # dependency-cruiser: src, functions, scheduler, scripts
npm run lint:isolation       # dependency-cruiser: feature isolation
npm run test:all             # full contract/regression suite
npm run build                # vite build -> dist
node scripts/check-bundle.mjs # forbidden strings in the shipped bundle
```

If any step fails, the Cloudflare build fails and **no deployment is
published**. Production stays on the last successful deployment.

`scripts/check-bundle.mjs` replaces the old GitHub shell grep and blocks
`dev-admin`, `REMOVE BEFORE COMMIT`, `waapi`, and `sentVia` from reaching the
customer bundle.

## Local verification

```bash
npm run verify
```

Same full gate as Cloudflare. It takes roughly 3–4 minutes locally.

## GitHub Actions

`.github/workflows/ci.yml` is now **manual-only** (`workflow_dispatch`).
It is kept for an on-demand run that includes **gitleaks secret scanning**,
which is not part of the Cloudflare build. It no longer runs on every PR/push,
so it does not consume the account's monthly Actions minutes.

The previous GitHub Actions minutes were exhausted
(`$12.00 used / $12.00 included`), which is why those jobs could not start.
That has no effect on Cloudflare deploys.

## Cloudflare Pages settings

- Build command: `npm run verify`
- Build output directory: `dist`
- Production branch: `main`
- `NODE_VERSION` is set in the production environment variables.
- Preview deployments use the same build command and therefore the same gate.

## Notes

- Cloudflare Pages build failures do not take the live site down.
- Cloudflare Pages Free includes 500 builds/month; this project uses far fewer.
- The build command is project configuration in Cloudflare (dashboard/API),
  not in `wrangler.toml`.
- If the full gate ever needs to be skipped for an emergency deploy, that
  must be an explicit owner decision — do not silently weaken the build
  command.
