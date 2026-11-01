# Contributing

## Branching

- `main` deploys to production on push (Pages git integration). **Never push
  directly to `main`.** All development happens on the single permanent
  branch `maintenance`; the owner merges `maintenance` into `main` (via
  Pull Request) when a batch is verified on the staging preview.
- One small commit per task with a clear message (`step-1: … (TN)` style).
  Never mix a fix with a refactor in one commit.

## Before every PR

1. `npm run test:all` — must be green (excludes `test:live`, which needs a
   live dev server / emulator state; see README quick start).
2. `npx tsc --noEmit` clean; `npm run lint:isolation` clean.
3. `npm run build` into a temp dir (never commit `dist/`) + bundle grep:
   `dev-admin`, `REMOVE BEFORE COMMIT`, `wa.me`, `waapi` must be absent.
4. `.dev.vars` / real secrets never committed (`git status` clean of them).
5. No applied migration edited — new behavior needs a new `00NN_*.sql`.
6. No new dependency without owner approval (`package.json` scripts only).

## Adding a feature

Follow `docs/ADD_NEW_FEATURE.md` (feature barrel + validation + repo +
tests). Plan-gated features: gate the **server route** with `hasFeature`
(404 when off) and hide the UI behind `features.config` — never UI-only.

## Commit style

Short imperative subject + evidence: what changed, which suite proves it
(`pricing 92/0`, `depcruise 0 violations`). Reference red-flag IDs (RF-01…)
when closing one.
