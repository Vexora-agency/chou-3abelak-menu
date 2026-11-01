# ADR-003: SITE_PLAN gating is fail-closed on the server

`features.config` hides UI; `hasFeature(env, …)` in `functions/_shared/plan.js`
404s gated routes server-side. A hidden feature is never reachable by URL
fiddling. `SITE_PLAN` is app-level (starter|pro) and unrelated to Cloudflare
billing. Ordering itself stays open on every plan (fail-open ordering is a
feature: a fresh deploy accepts orders before SITE_PLAN is set).
