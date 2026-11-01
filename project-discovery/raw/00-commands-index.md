# Raw outputs index — project-discovery (read-only)

Project: C:\Users\Mina\Desktop\Chou 3abelak\chou-3abelak-menu-main (app scope).
Sidecars (excluded from app metrics, counted separately): C:\Users\Mina\Desktop\Chou 3abelak\tour-export, ...\remotion-video.
Date: 2026-11-01. All commands read-only. Tool policy: `npx --no-install` first; nothing installed globally; package.json/lock/node_modules untouched.

| File | Command (workdir = app root, PowerShell 5.1) |
|---|---|
| 01-git.txt | `git log --oneline -20`, `git shortlog -sne HEAD`, `git status --short --branch`, `git branch -a`, `git log --format='%h %ad %an <%ae> %s' --date=short` (first 5), `git count-objects -v`, `Test-Path .git/shallow`, `git check-ignore -v .dev.vars`, hotspot log `--pretty=format: --name-only` grouped |
| 02-loc.txt | Get-ChildItem counts + line sums per dir (src/functions/scheduler/migrations/scripts); sidecar counts for tour-export + remotion-video; 12 largest files |
| 03-deps.txt | `npm outdated --depth=0`; `node --version`; `npm --version` |
| 04-quality.txt | `npx --no-install tsc --noEmit`; `npx --no-install eslint .` (TIMED OUT at 120s); `npx --no-install depcruise src functions scheduler scripts --output-type err-long`; TODO Select-String scan |
| 05-tests.txt | `node scripts/test-plan.mjs`; `npx --no-install tsx scripts/test-parity.mjs`; `node scripts/test-pricing.mjs`; test-file listing; network-touch scan of scripts/test-* |
| 06-cloudflare-limits.md | Web docs fetched 2026-11-01 (URLs inside) |
