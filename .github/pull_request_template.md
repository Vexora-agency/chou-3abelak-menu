<!-- PR template: delete sections that do not apply. CI must be green before review. -->
## What / why (1-2 lines)

## Evidence (paste, don't describe)

- [ ] `npm run test:all` green (paste tail: `… passed, 0 failed`, exit code)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint:isolation` (depcruise) 0 violations
- [ ] Prod build into temp dir + bundle grep clean (`dev-admin`, `REMOVE BEFORE COMMIT`, `wa.me`, `waapi`)
- [ ] If pricing touched: parity suite green, both mirrors updated (`src/utils/pricing*.ts` + `functions/_shared/pricing*.js`)

## Secrets

- [ ] No real secret committed (`.dev.vars`, hashes, tokens, keys). `git status` shows no credential files.

## Dev-admin gate

- [ ] No `?dev-admin` / backdoor traces ship (covered by the bundle grep above).

## Migrations (if any)

- [ ] New file only (`00NN_*.sql`), never edited an applied one; D1 Time Travel window considered; applied `--local` at least.

## Staging (if behavior changed)

- [ ] Verified on the preview deployment (`<branch>.<site>.pages.dev`) against preview bindings, not production.
