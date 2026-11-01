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
- [ ] Await owner: (1) review + push `maintenance/remove-whatsapp`; (2) Generate_pass.txt removal approval (Phase-0); (3) package.json dangling scripts (`test:whatsapp`, `test:dial`, `test:all` chain) — 1-line cleanup needed, rule forbade touching it; (4) privacy.html hand-review; (5) orphaned `public/assets/aistudio/Main.*.html` — delete or archive? (6) run migration 0017 per client explicitly

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

## TODO — roadmap (NOT started, no fixes proposed)
- [ ] Maintainability: god-file splits (in-code TODOs), full `strict: true`, eslint within budget
- [ ] Scalability: quota monitoring, KV-write-per-order reduction, per-client paid-plan trigger
- [ ] Testability: framework + coverage, pre-existing suite failures (features/sound/backup harnesses)
- [ ] Operability: CI, staging, health endpoint, error tracking, unified `_headers`, dev-admin grep gate
- [ ] Extensibility: order-type registry, notifier abstraction, clone-drift process
- [ ] RF-13: cross-account deploy-credential story (later phase)
