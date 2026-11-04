# Security Audit — Task Tracker

Check off each task when done. Evidence goes to `results.md` + `raw/`.

## Phase 0 — Recon

- [ ] 0.1 Map repo: entry points, all API routes (public / auth / admin)
- [ ] 0.2 Middleware order, DB layer (D1/KV), file uploads, outbound HTTP, webhooks, jobs
- [ ] 0.3 Dockerfile / compose / CI workflows / Pages config
- [ ] 0.4 Record every version (runtime, deps, tools)

## Phase 1 — Tooling (free only, verify with --version)

- [ ] 1.1 Secrets: gitleaks (tree + history) — fallback: truffleHog or manual grep
- [ ] 1.2 SAST: semgrep (`auto` + owasp/js-ts/secrets) — fallback: eslint-plugin-security
- [ ] 1.3 Deps: `npm audit`, osv-scanner, trivy fs (fallback chain as available)
- [ ] 1.4 Headers/TLS: `curl -I` on live + staging, testssl.sh if installable
- [ ] 1.5 DAST: ZAP baseline vs LOCALHOST/STAGING only (skip if no local env + record why)
- [ ] 1.6 Save every raw output to `raw/` with the exact command

## Phase 2 — Review checklist (PASS / FAIL / PARTIAL / N/A + evidence)

- [ ] 2.1 Secrets (repo, history, bundles, .gitignore, .env.example)
- [ ] 2.2 AuthN/AuthZ (admin gate, IDOR/BOLA, mass assignment, track-token scoping)
- [ ] 2.3 OWASP Top 10 (injection, XSS, CSRF, SSRF, traversal, redirects, errors)
- [ ] 2.4 Headers & transport (HSTS, CSP, framing, CORS, banners)
- [ ] 2.5 Input validation & file upload (schemas, sizes, uploads if any)
- [ ] 2.6 Dependencies & supply chain (audit triage + reachability)
- [ ] 2.7 Rate limiting & abuse (limits, 429s, trust-proxy, CDN/WAF)
- [ ] 2.8 Production-readiness (least privilege, non-root, panels, logging, backups)

## Phase 3 — Report

- [ ] 3.1 Executive summary + verdict + top 5 risks
- [ ] 3.2 Stack/attack-surface + tools used + NOT-tested list
- [ ] 3.3 Findings table by severity (CONFIRMED/LIKELY/MANUAL + fix + verify)
- [ ] 3.4 Phase-2 table + remediation plan + dismissed false positives
- [ ] 3.5 Final chat reply: (a) summary+table (b) paths (c) Arabic summary (d) open questions
