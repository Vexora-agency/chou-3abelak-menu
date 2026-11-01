# Security Audit — Results Log

Everything DONE and FIXED, newest first. (Fixes are applied only after
owner approval — this log records audit progress, not code changes.)

## 2026-11-01 — Audit opened

- [x] Created `security-audit/` with `README.md`, `TASKS.md`, `results.md`
  (this file). Report skeleton `SECURITY_REVIEW.md` + `raw/` next.
- [ ] …(entries appended as each TASKS.md item completes)

## 2026-11-01 — 5-gap audit (STEPS 1–3) DONE, tamper fix DONE

- [x] STEP 1 “what I found” compiled from repo files (React 19 + Vite 8 +
  Pages Functions + KV/D1 + HMAC cookie/Access JWT).
- [x] STEP 2 judged all 5 gaps with `file:line` evidence — full table in
  `SECURITY_REVIEW.md`. Verdict: **nothing exploitable now**; one WEAK
  (public-GET rate limits); two follow-ups (gitleaks history scan,
  `hitRateLimit` on `track.js`).
- [x] STEP 4 (approved in-chat): DOM tamper guard implemented —
  `src/hooks/useGuardedText.ts` + applied to CartBar total, drawer grand
  total, modal header pill + Add-button total. `tsc` clean, `vite build`
  green. Real enforcement was already server-side
  (`functions/_shared/orders.js:51-55`, `functions/api/orders.js:83-90`).
- [ ] Awaiting owner approval for: #12 rate-limit hardening + history scan.

## 2026-11-01 — Approved follow-ups DONE (owner: "اوافق")

- [x] **History scan:** gitleaks 8.28.0 installed + full run (238 commits).
  Result: 2 hits, both CONFIRMED false positives (HMAC test fixtures in
  `scripts/test-backup.mjs` / `test-backup-diff.mjs`). No rotation, no
  history rewrite needed. Evidence: `raw/gitleaks.json`.
- [x] **npm audit (prod):** 0 vulnerabilities. Evidence: `raw/npm-audit.json`.
- [x] **`track.js` rate limit:** `checkRateLimit` 120 req / 5 min / IP → 429
  (`functions/api/track.js:8-27`), same helper family as invite/login.
  Both clients fail soft. `tsc` clean, `vite build` green.
- [ ] Optional backlog: same limiter for `ordering-state.js`/`menu.js`,
  gitleaks in CI.
