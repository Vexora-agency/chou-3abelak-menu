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
