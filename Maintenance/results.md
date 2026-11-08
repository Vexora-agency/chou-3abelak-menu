# Discovery results (2026-11-01) + Phase-0 updates (branch `maintenance/phase-0`)

## 1. Summary + health
White-label bilingual menu + WhatsApp-ordering base system (React 19 + Vite 8 + Tailwind 4 + Pages Functions + D1/KV/R2 + scheduler Worker). Modular monolith deployed as per-client clones (`ADD_NEW_CLIENT.md`: clone + `setup-new-client.mjs` + fresh D1+KV+R2 + env vars; backend untouched). **One Cloudflare account per client** (owner-confirmed) — free quotas are per-client; SITE_PLAN is app-level, unrelated to Cloudflare billing.

| Maintainability 3/5 | Scalability 3/5 (was 2/5 — rescored: per-client quotas, ~900 orders/day/client; constraint is ops-per-account, RF-13) | Testability 3/5 | Operability 2/5 | Extensibility 3/5 |
|---|---|---|---|---|
| depcruise 0 violations/373 modules, but god files (`telegram.js` 998, `App.tsx` 571) | stateless compute + bounded queries; clone model scales horizontally, ops cost per account | 36 scripts, tsc clean, parity 82/82, plan 46/46, pricing 92/0 (RF-01 fixed Phase-0) | no CI/staging/health/tracker; Pages git integration deploys | barrels + dual plan-gating + SQL repos; literals scattered, pricing mirrored FE/BE |

## 5. Metrics
App: 323 files / 39,565 lines (src 165/23,017; functions 91/11,010; scripts 49/5,196; scheduler 2/61; migrations 16/281). Sidecars excluded: tour-export 5,828/18; remotion-video 167,809/44. Largest: telegram.js 998, IdentitySection 573, App.tsx 571, OrdersBell.tsx 546. Tests: 36 custom scripts (no framework/coverage); depcruise clean; tsc clean; eslint full run 75.5s → 51 files, 100 problems (86 err/14 warn, `raw/11-eslint.txt`). Outdated: 9 (motion 12→14, lucide 0.5→1.6, TS 5.9→7 among them), caret ranges + lockfile. TODOs: 2 real split-notes. Contributors: 2 identities / 1 email → bus factor 1; ~230 commits/10d from 2026-10-22 (re-initialized). Hotspots: App.tsx 36, OrdersBell 25, MenuList 18, telegram.js 17.

## 6. Red flags (IDs stable)
RF-01 FIXED Phase-0 (7d1fb71: stale expectation → asserts 0=free; 92/0, parity 82/0) | RF-02 `telegram.js` 998-line god module | RF-03 `App.tsx` 571-line hotspot | RF-04 `_headers`: Phase-0 build proved output ≡ `public/_headers` byte-for-byte; root file unshipped (stale, geolocation-denying) — unification proposed, not applied | RF-05 reduced-motion forced off (owner decision) | RF-06 `Generate_pass.txt` tracked (54 lines, Arabic runbook + one 68-char base64-charset line; UNCERTAIN credential-like; proposal awaiting approval — NOT deleted) | RF-07 no CI/staging/health/tracker, git-push deploys | RF-08 `?dev-admin`: Phase-0 prod build (`Temp/opencode/chou-dist-phase0`) contains ZERO `dev-admin` traces — gate holds; CI grep step proposed | RF-09 caret ranges, 3 majors behind | RF-10 REVISED per-client (first breakage = KV writes 1k/day ≈ 900 orders/day/client) | RF-11 admin `SELECT *` LIMIT 2000 | RF-12 eslint 75.5s/100 problems (was: unknown duration) | RF-13 NEW: cross-account deploy credentials TODO (later phase).
Evidence: `../project-discovery/PROJECT_OVERVIEW.md` §6 + `../project-discovery/raw/`.

## 8. UNKNOWNs + owner questions
REVISED: account model answered (one/account/client); retention/legal deprioritized (pre-first-client gate only). Still UNKNOWN: traffic shape, DB size, slow queries, quota burn, CPU p99, bundle size, Resend/WhatsApp-template reality, restore drill, costs, roadmap. Open: WhatsApp-template ownership (Q3), `Generate_pass.txt` approval (Q4), `?dev-admin` keep/strip (Q6), staging (Q8), SITE_PLAN toggling (Q9), R2 lifecycle (Q10), OSM contracts (Q11), RF-13 token custody (Q12). Full text: overview §8.

## 10. Extensibility (paper traces — unchanged, see overview §10)
(a) New order type → ~8 areas, literals in ≥8 files. (b) New channel → new `_shared/<channel>.js` + waitUntil hook + admin + privacy + mirror tests; no notifier abstraction. (c) New monthly report → lowest risk (139-line layer, 4 test files).

## 11. Free-plan capacity — PER CLIENT (limits fetched 2026-11-01)
Per order: KV R2/W1, D1 read ~5 rows / write ~7 rows, ~7 Function requests with views. First breakage per client: KV WRITES 1,000/day → ~800-900 orders/day. View-heavy menus burn KV reads (100k/day ≈ 30k views) first. Client count unbounded by quotas; upgrade trigger per client: >500 orders/day sustained.

## 12. WhatsApp removal (branch `maintenance/remove-whatsapp`, 6 commits C1–C6)
Cloud API send-block + sentVia channel gone (FE+BE same commit); 6 files deleted (~1,135 lines); guard moved whatsapp→contact phone with legacy strip + tests (62/0); contact number/links/picker/social removed across ~35 files; migration 0017 written, NOT run; docs/privacy/seed updated (no legal claims). Deleted tests accounted: test-whatsapp.ts (40 passed), test-whatsapp-api.mjs (all-green ok-lines), test-dial-codes.ts (35 passed, subject deleted). Dangling package.json scripts (`test:whatsapp`, `test:dial`, `test:all` chain) need a 1-line cleanup — left untouched per no-package.json rule. Remaining sweep matches are intentional (removal comments, legacy fixtures, applied migrations, orphaned aistudio artifact proposed for follow-up). No rescore; recorded what changed.


## 14. Step-1 safety net (branch `maintenance/step-1`, dedicated clone D:/Chou 3abelak; commits T0+tasks below)
- T0 re-verify (392390d): test:all exit 0, tsc clean, depcruise 0 violations → raw/14-step1-reverify.txt.
- T1 triage (7e6425c + raw/13): all 4 failing suites were STALE TESTs (evidence: d190a30, ff29759, 7a219e2/c0946e6/0be640c+bellPatterns, acce2c1) — fixed, zero real bugs.
- T2 CI (5e47469): `.github/workflows/ci.yml` (verify/depcruise/test:all/temp-build+grep/gitleaks/advisory-eslint; 3 pinned SHAs, actionlint v1.7.12 clean). No deploy steps. NOTE: `test:dial`/`test:whatsapp` scripts removed; dangling-script issue from §12 resolved.
- T3 (fbc0af8 + 1c9a5e6): root `_headers` deleted; `public/_headers` single source; 20-check contract test in test:all. Full root-vs-public diff in final report.
- T4 (15702b3): `GET /api/health` + `?deep=1` (single SELECT 1); 9 tests. No version/config leakage; no-store.
- T5 (5c1051e): request-id middleware + structured `_shared/log.js` (zero-dep, PII-free); 12 tests. Failures now visible as JSON lines instead of silent 500s.
- T6 (538ab95): `docs/STAGING.md` + `[env.preview]` overrides (placeholder ids); preview = per-branch deploys with SEPARATE bindings.
- T7 (ccb6e86): backup inventory + `docs/RESTORE.md` (KV/D1/R2/secrets matrix, Time Travel procedures, drill checklist — drill NOT run).
- T8-docs (82d0266): README quick start, `.dev.vars.example`, CONTRIBUTING.md, PR template, 4 ADRs (clone-per-account; telegram-only; fail-closed gating; free-plan quotas).
- T9 (a155167): new-dev drill from temp clone — clone ~10s, `npm ci` 166s, `test:all` 65s exit 0, `npm run build` 10s exit 0, wrangler resolves in 21s. Fixed 2 README gaps (branch checkout note, wrangler download note).

## 15. Observability evaluation (docs fetched 2026-11-01) + proposal
- Workers Logs (new product): free 200k events/day, 3-day retention, dashboard queryable, JSON auto-indexed — https://developers.cloudflare.com/workers/observability/logs/workers-logs/ . From Dec 1 2026: unified observability pricing (free 0.5 GB/day, 7-day retention) — https://developers.cloudflare.com/observability/pricing/ .
- Pages Functions logs: stream-only (dashboard tail / `wrangler pages deployment tail`), NOT stored, max 10 viewers, no logs if >100 rps/5min — https://developers.cloudflare.com/pages/functions/debugging-and-logging/ .
- Logpush: PAID ONLY (Workers Logpush) — https://developers.cloudflare.com/workers/observability/logs/logpush/ . Tail Workers: extra worker = extra complexity. Workers Issues: groups failures (available in platform).
- Proposal (implemented T5, no SDK): zero-dependency structured error logs + request id (middleware echoes `x-request-id`; failures log one JSON line; hot paths log nothing → ~zero of the 200k/day budget). Trade-off accepted: no post-mortem without someone watching tail / opening dashboard; no alerting. If paging or history is later required: add Logpush-to-R2 (paid) or a third-party error tracker — DESCRIBED ONLY, waiting for owner approval (no SDK added).
- Current gap this closes: before T5 the app had ONE console.* in all of functions/+src — every uncaught exception was a silent 500.

## 16. External pinger quota math + owner hand-do list
- Pinger every 5 min = 12/hour = 288/day. Shallow: 288 Workers requests/day = 0.3% of the 100k/day free budget; zero D1/KV/R2. Deep (`?deep=1`): +288 D1 queries/day × ~1 row read = 288 rows/day = 0.006% of the 5M/day budget; zero writes. Recommendation: shallow every 5 min (uptime), deep every 30–60 min or on-demand (dependency check).
- Owner hand-do (nothing below was done by the agent — all require dashboard/GitHub/human access):
  1. GitHub: review + merge `maintenance/step-1` yourself; in repo Settings → Actions: leave as-is (CI only, no secrets needed); optional: require the `verify` job as a branch-protection check.
  2. Cloudflare per client account — PARTLY DONE BY AGENT 2026-11-01 (wrangler was already logged in): branch pushed → live preview https://96b39c50.chou-3abelak-menu.pages.dev (verified: `/api/health` 200 `{"ok":true}`); preview D1 `chou-3abelak-orders-preview` created + migrated through 0017; preview KV `MENU_KV_PREVIEW` created + seeded with `menu.seed.json` (remote read verified); preview R2 bucket created; wrangler.toml `[env.preview]` filled with real ids. STILL OWNER-ONLY (dashboard, no CLI path): bind the three preview resources under the Preview tab (NOT Production) — then `?deep=1` must flip 503 → 200, which also proves production was never touched; set preview env vars (fake secrets; `wrangler pages secret` has no --env flag); confirm bindings in deployment details.
  3. R2: apply the 37-month lifecycle backstop on `reports/` (recommended, unverified).
  4. Access (optional): gate preview deployments to the team.
  5. Restore drill on STAGING once: follow docs/RESTORE.md checklist; fill the drill log; do NOT claim it done until every box is ticked by hand.
  6. Decide on third-party error tracking (Sentry-style) if paging/history is wanted — none added.
  7. Run migration 0017 per client explicitly (from the WhatsApp removal); run `test:live` before first real deploy (needs :3000 + seed orders and emulator D1 state).
