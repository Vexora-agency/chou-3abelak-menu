# TASKS tracker — where we are and what is next (branch `maintenance/phase-0`)

## DONE — discovery (2026-11-01, evidence in `../project-discovery/`)
- [x] Inventory + stack + sidecar split → `raw/02-loc.txt`, `raw/03-deps.txt`
- [x] Architecture + ~53 routes + ER + white-label (per-client clone) + deploy path → overview §§2-4,9
- [x] Git: bus factor 1, 230 commits/10d, `.dev.vars` ignored-not-read, hotspots → `raw/01-git.txt`
- [x] Quality gates: tsc clean, depcruise 0 violations, pricing/parity/plan suites → `raw/04-quality.txt`, `raw/05-tests.txt`
- [x] Free-plan limits from live docs → `raw/06-cloudflare-limits.md`
- [x] Extensibility: 3 paper traces → overview §10
- [x] Capacity estimate → overview §11 (revised per-client 2026-11-01)

## DONE — WhatsApp removal (branch `maintenance/remove-whatsapp`, NEVER push; owner reviews + pushes)
- [x] C1 (3d5b894): orders.js Cloud API block + sentVia removed; cart.api + submit hook updated same commit
- [x] C2 (64798c8): deleted 6 files (whatsapp-api.js, admin route, WhatsappApiSection, whatsapp.ts builder, 2 test files — 1,135 lines)
- [x] C3 (1b80eb3): guard transferred settings.whatsapp→settings.phone; legacy strip + 5 new test-status assertions (62/0)
- [x] C4 (59001f4): contact number/links/picker/social removed (35 files); deleted CountryCodePicker, dialCodes, test-dial-codes; fixtures keep whatsapp as tolerance coverage
- [x] C5 (0906b3e): migration 0017 (NOT run) + markOrderSentVia removed; sent_via kept
- [x] C6 (6819ee4): README/privacy(llms/llms.txt/seed/cart-isolation docs; no legal claims invented
- [x] Verify: tsc clean; depcruise 0 violations (365 modules/1061 deps); eslint 99 problems (was 100; -3 deleted files, +3 owner WIP hook, net my-change 0); prod build + grep clean except orphaned aistudio artifact + fixed index.html meta
- [x] External event logged: owner committed 59df5ad on this branch + cherry-picked to main (ad01666, appears pushed); my 6 commits untouched underneath; zero overlap with WhatsApp paths

## DOING
- [ ] Await owner: (1) review + push `maintenance/remove-whatsapp`; (2) Generate_pass.txt removal approval (Phase-0); (3) package.json dangling scripts — RESOLVED in step-1 T1 (7e6425c, test:all green); (4) privacy.html hand-review; (5) orphaned `public/assets/aistudio/Main.*.html` — delete or archive? (6) run migration 0017 per client explicitly

## DONE — Phase-0 (branch `maintenance/phase-0`, NEVER push; owner reviews)
- [x] A. RF-06 inspected (54 lines, tracked since d63ded6, UNCERTAIN credential-like, proposal awaiting approval — NOT deleted) — evidence §A in final report
- [x] B. RF-01 fixed: `scripts/test-pricing.mjs:128` (commit 7d1fb71) — pricing 92/0, parity 82/0, plan 46/0, no regressions
- [x] C. RF-08 verified: prod build in `Temp/opencode/chou-dist-phase0` has ZERO `dev-admin` traces; CI grep step proposed (report only)
- [x] D. RF-04 verified: output `_headers` ≡ `public/_headers` (2091 B); root file (785 B) unshipped/stale; unified file proposed (report only)
- [x] E. RF-12: eslint full run 75.5s, 51 files, 100 problems (86/14) → `raw/11-eslint.txt` + `raw/11-eslint-timing.txt` (commit 60ac295)
- [x] F. `.github/dependabot.yml` created (npm minor/patch grouped, majors ignored, no workflows) (commit 457e2ba)
- [x] Docs revised: RF-10 per-client, capacity §11, Scalability 2→3/5, RF-13 added, RF-01 closed, retention demoted to gate
- [x] Baseline suite `raw/10-phase0-baseline.txt` (pre-existing failures recorded: features-orders 20+1, features-customer anonymize/CSV, sound 4+5, backup/features harness crashes)

## DOING
- [ ] Await owner: (1) Generate_pass.txt removal approval, (2) review + push `maintenance/phase-0` yourself, (3) answers to overview §8 (Q3-Q12)


## DONE � Boosthis removal (branch `maintenance/remove-boosthis`, NEVER push; owner reviews)
- [x] PHASE A inventory (read-only): Boosthis = Veqtara telemetry kit (vitals/traces/snapshots, owner-only bubble). 3 measurement-only touchpoints: functions/_middleware.js (all-routes wrapper), scheduler/src/index.js (cron wrapper), src/types/boosthis-runtime-web.shim.ts (types only, nothing imports runtime). Vendored lib/ 152 files/~64.5k lines + 7x BOOSTHIS_* docs. Zero entanglement: no pricing/order/validator/plan/auth/DB (migrations clean, no KV keys, seed clean, public/ clean, no UI strings EN/AR). GATE -> PROCEED.
- [x] C1 (8d51eee): scheduler unwrap + edge-middleware drop. NOTE: functions/_middleware.js was never tracked (never-commit rule) - deleted from disk, no commit possible. FLAGGED FOR REVIEW: all-routes wrapper removal (responses identical, measurement only).
- [x] C2 (disk-only, uncommittable): deleted lib/, 7x BOOSTHIS_*, shim; tsconfig edit reverted local-only mods back to committed state (no diff).
- [x] C4 (a0db478): .env.example VITE_BOOSTHIS block removed + legacy-tolerance test (settings with boosthis: block -> no-throw, defaults applied).
- [x] C5: skipped - DB not involved. Next free migration number verified: 0018 (unused).
- [x] C6: skipped - README/privacy.html/llms.txt contain zero boosthis matches, nothing to rewrite.
- [x] (a) (980c6d0): adopted pending package.json scripts cleanup (test:whatsapp/test:dial gone - files confirmed absent; test:all rebuilt). Scripts section only.
- [x] (b) (81b4b49): deleted unreferenced public/assets/aistudio/ (frozen AI-Studio preview; zero code refs; contained WhatsApp CTAs, no boosthis).
- [x] (c): eslint problems from 59df5ad LISTED ONLY, untouched: ItemDetailsModal.tsx:111,113 (useGuardedText after early return - conditional hooks), useGuardedText.ts:18 (ref written during render).
- [x] Verify (isolated worktree Temp/opencode/rb-verify): tsc clean; depcruise 0 violations (330/982); suites settings 39/0 (+2 new), parity 82/0, safe-json 23/0, cart 20/0; prod build -> Temp/opencode/rb-dist green with ZERO boosthis matches in JS/CSS/HTML.
- [x] Final sweep: 8 remaining tracked matches, all justified (agent.md rule text; package.json+lock dep entries per no-dep-changes rule; scheduler explanatory comment; tolerance-test subject; audit record; historical project-discovery logs).
- [ ] Await owner: review + push maintenance/remove-boosthis yourself. Interference note: a second session flipped the main worktree HEAD repeatedly (step-1 <-> remove-boosthis) mid-run; verification was done in an isolated worktree - see results.md section 13.
## TODO — roadmap (NOT started, no fixes proposed)
- [ ] Maintainability: god-file splits (in-code TODOs), full `strict: true`, eslint within budget
- [ ] Scalability: quota monitoring, KV-write-per-order reduction, per-client paid-plan trigger
- [ ] Testability: framework + coverage (pre-existing harness failures FIXED in step-1 T1)
- [ ] Operability: error tracking beyond logs (see results.md §12), unified `_headers` DONE (T3), dev-admin grep gate DONE in CI (T2), CI DONE (T2), staging DONE docs-only (T6), health endpoint DONE (T4)
- [ ] Extensibility: order-type registry, notifier abstraction, clone-drift process
- [ ] RF-13: cross-account deploy-credential story (later phase)

## DONE — Repo cleanup + stable branch name (2026-11-01)
- GitHub had 3 branches (main, remove-boosthis, step-1) → now exactly 2: `main` + `maintenance`.
- `maintenance/step-1` renamed to `maintenance` (single permanent dev branch; old name deleted from GitHub after verifying zero unique commits — containment check passed).
- CI trigger narrowed to `[main, maintenance]`; CONTRIBUTING updated to single-branch flow.
- remote `maintenance/remove-boosthis` DELETED from GitHub (verified: tip fbc164d fully contained in step-1, zero unique commits — lossless).
- GitHub now: `main` + `maintenance/step-1` only. Local `origin/*` tracking refs for deleted/exclusive branches left untouched (C:\ repo not mine to modify).
- step-1 pushed to GitHub through black-screen fix (96f75e6): triggers fresh preview build so staging serves the fix. Untouched: main (never), production bindings/data.

## DONE — Step 1 safety net (branch `maintenance/step-1`, dedicated clone D:/Chou 3abelak; owner merges)
- [x] T0 (392390d): rebased onto remove-boosthis tip; re-verified test:all exit 0, tsc clean, depcruise 0 violations (330/982) → raw/14-step1-reverify.txt
- [x] T1 (7e6425c + evidence 13-step1-triage.txt): triaged all failing suites as STALE (fake-DB track_token shift; per-action confirm words; retired two-tone engine → pattern engine; missing owner session in flows harness). test:all green exit 0; test:live defined (excluded).
- [x] T2 (5e47469): CI `.github/workflows/ci.yml` (PR+push, contents:read, 3 pinned SHAs, npm ci+cache, tsc, depcruise, test:all, temp-dir build + bundle grep, gitleaks, advisory eslint). actionlint v1.7.12 clean.
- [x] T3 (fbc0af8 + 1c9a5e6): root _headers deleted; public/_headers single source; scripts/test-headers.mjs (20 checks) in test:all.
- [x] T4 (15702b3): GET /api/health (shallow) + ?deep=1 (single SELECT 1, no KV/writes); 9 tests. Pinger math: 5-min ping = 288 req/day (0.3% of 100k); deep = 288 rows/day (0.006% of 5M).
- [x] T5 (5c1051e): request-id middleware + structured _shared/log.js (zero-dep, no PII); 12 tests. No SDK added.
- [x] T6 (538ab95): docs/STAGING.md + [env.preview] overrides (placeholder ids — fill per account); dashboard hand-do list inside.
- [x] T7 (ccb6e86): backup inventory + docs/RESTORE.md (KV/D1/R2/secrets matrix, Time Travel procedures, drill checklist — drill NOT run).
- [x] T8-docs (82d0266): README quick start, .dev.vars.example, CONTRIBUTING.md, PR template, 4 ADRs.
- [x] T9 (a155167): new-dev drill from temp clone — clone ~10s, npm ci 166s, test:all 65s exit 0, build 10s exit 0; fixed 2 README gaps (branch checkout note, wrangler download note).
- [x] Interference resolved: dedicated clone has no other session; guard held all run (branch step-1, HEAD stable per command).
- [x] MERGED TO MAIN + DEPLOYED (owner-authorized 2026-11-01): merged origin/main into maintenance (resolved ItemDetailsModal conflict keeping the hook fix; accepted main's deliberate test-mail endpoint removal after verifying zero callers), verified tsc/test:all/depcruise/build+grep green, pushed maintenance then fast-forwarded GitHub main 46604b3→2825704. Production verified live: /api/health 200, deep d1:ok, menu 53/5 intact. Staging preview auto-rebuilt too.
- [x] CI gate triage (2026-11-01): first CI run on `maintenance` flagged 4 generic-api-key findings — all in `.dev.vars.example`, all fake values I generated (hex-looking placeholders). Fix (a0bfb22, pushed): `<...>` placeholders matching `.env.example` convention + generation commands. No real secret ever committed (verified: findings were only the example file; Generate_pass.txt untouched).
- [x] Black-screen fix (96f75e6, reported live 2026-11-01): opening any menu item unmounted the whole app. Root cause — useGuardedText calls sat AFTER `if (!item) return null` in ItemDetailsModal (introduced in 59df5ad): closed renders call N hooks, open renders call N+2 → React throws hook-order error, no error boundary, black screen. Fix: computations + both hooks hoisted above the early return (closed = empty fallbacks); regression test scripts/test-hook-order.mjs (fails pre-fix at 113-vs-76, passes after); CartBar/OrderSummaryLines verified unconditional (safe). tsc clean, depcruise clean, test:all green, build+grep clean. Same bug exists on main (has 59df5ad via cherry-pick) — fixed via merge, main untouched. Left alone: useGuardedText.ts:18 ref-write-during-render lint (owner's file, no crash).
