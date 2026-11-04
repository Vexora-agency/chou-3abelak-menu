# Security Audit — Chou 3abelak

**Role:** senior Application Security Engineer / DevSecOps auditor.
**Rules:** no source-code changes during the audit (findings + patches in the
report only), no full secrets in any file, no dynamic attacks on production,
no fabricated results — every finding is `CONFIRMED` / `LIKELY` / `NEEDS MANUAL REVIEW`.

## Files

| File | Purpose |
|---|---|
| `TASKS.md` | Phase-by-phase checklist — the tracker we follow one by one ✅ |
| `results.md` | Log of everything DONE and FIXED (grows as tasks complete) |
| `SECURITY_REVIEW.md` | The full report (verdict, findings, fixes, checklist, plan) |
| `raw/` | Raw tool outputs, one file per tool + exact command |

## Progress

- [x] Audit structure created (`README/TASKS/results/REPORT/raw`)
- [ ] Phase 0 — Recon (stack, routes, auth, configs)
- [ ] Phase 1 — Tooling (secrets, SAST, deps, headers/TLS)
- [ ] Phase 2 — Manual + automated checklist (§1–§8)
- [ ] Phase 3 — Final report + verdict (GO / NO-GO / GO WITH CONDITIONS)

## How we work

1. One task at a time from `TASKS.md`.
2. When a task finishes, it is checked off **here and in `TASKS.md`**,
   and the outcome is appended to `results.md`.
3. Fixes are applied only after explicit owner approval (separate step).
