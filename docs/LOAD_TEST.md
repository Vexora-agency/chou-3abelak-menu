# Load Test — Cloudflare Pages + D1 (local-stack results, 2026-10-28)

> Scope: LOCAL stack only (`wrangler pages dev`, miniflare emulation).
> No preview URL was available and production was never touched.
> Re-run against a `*.pages.dev` preview before trusting edge numbers:
> `-e BASE_URL=https://<branch>.chou-3abelak-menu.pages.dev`.

## How to run

```bash
npm run build
npx wrangler pages dev ./dist --port 3000   # local D1+KV+R2, throwaway state
# seed menu once (admin PUT works with ALLOW_LOCAL_DEV=1 in .dev.vars,
# or reuse persisted local state that already holds the 52-item seed):
node scripts/load/autocannon-quick.mjs http://127.0.0.1:3000
<k6-binary> run -e BASE_URL=http://127.0.0.1:3000 -e SCENARIO=baseline_gets scripts/load/k6-load-test.js
<k6-binary> run -e BASE_URL=http://127.0.0.1:3000 -e SCENARIO=stress_gets  scripts/load/k6-load-test.js
<k6-binary> run -e BASE_URL=http://127.0.0.1:3000 -e SCENARIO=spike_gets   scripts/load/k6-load-test.js
<k6-binary> run -e BASE_URL=http://127.0.0.1:3000 -e SCENARIO=post_orders  scripts/load/k6-load-test.js
```

k6 v1.6.0 standalone binary was used (no install needed, no admin rights).
Scenarios: `baseline_gets` (10 VUs/60s) · `stress_gets` (ramp→100 VUs/3min) ·
`spike_gets` (200 VUs burst) · `post_orders` (4 paced writes, see §4).
Summaries land in `scripts/load/results/k6-summary.json` (untracked artifact).

## Results — GET mix (20% `/`, 50% `/api/menu`, 30% `/api/ordering-state`)

| Run | Reqs | Fail | Throughput | avg | med | p90 | p95 | max |
|---|---|---|---|---|---|---|---|---|
| autocannon `/` (10 conn/30s) | 836 | 0 | 27.9 rps | 359 ms | 337 ms | ~700 ms | ~788 ms (p99) | 842 ms |
| autocannon `/api/menu` | 2,001 | 0 | 66.7 rps | 150 ms | 135 ms | ~430 ms | ~456 ms (p99) | 588 ms |
| autocannon `/api/ordering-state` | 1,923 | 0 | 64.1 rps | 156 ms | 144 ms | ~470 ms | ~503 ms (p99) | 557 ms |
| k6 baseline (10 VUs) | 721 | 0% | 11.9 rps | 78 ms | 47 ms | 137 ms | 237 ms | 620 ms |
| k6 stress (→100 VUs) | 7,136 | 0% | 39.6 rps | 456 ms | 335 ms | 1,053 ms | 1,279 ms | 2,385 ms |
| k6 spike (200 VUs) | 4,967 | 0% | 70.7 rps | 1,296 ms | 1,020 ms | 2,596 ms | 2,935 ms | 4,280 ms |

## Results — POST /api/orders (D1 write path)

4/4 writes accepted (`orderNumber` 1002–1005, sequential, no conflicts):
avg 307 ms · med 249 ms · p90 459 ms · p95 496 ms · max 532 ms · 0 × 5xx.
Each write = KV menu read + full validation + atomic counter increment
(`nextOrderNumber`, one `UPDATE ... RETURNING` statement) + batched
INSERT + re-read + KV rate-bookkeeping (`functions/api/orders.js`).

## What the numbers mean (read carefully)

1. **These are LOCAL floors, not edge ceilings.** Miniflare runs workerd on
   one laptop core with ~120 ms baseline overhead; real edge isolates are
   faster per-request but enforce a **50 ms CPU limit (free plan)** that
   local runs do NOT enforce. Our hottest path (order validation over
   52 items + pricing math) must be watched against that budget on preview.
2. **Zero failures everywhere, including the 200-VU spike.** The stack
   queues (latency climbs) instead of breaking — good failure mode.
   The knee on this laptop is ~40 rps mixed reads; p95 crosses the
   1,000 ms budget only past ~50 concurrent readers *locally*.
3. **D1 throttling was NOT observed and CANNOT be observed locally.**
   Local D1 is a SQLite file — no distributed contention, no 10 GB cap,
   no per-DB write-rate governor. The former `MAX(number)+1`
   read-modify-write hotspot is GONE (replaced 2026-10-28 by the atomic
   `order_counter`: 5 simultaneous POSTs → numbers 1007–1011 unique, plus
   10 parallel raw increments → 1012–1021 unique, zero 503s). Preview
   re-test with 20–50 concurrent POSTs from distinct IPs is still
   worthwhile to confirm under real D1.
4. **The rate limiter is the effective single-IP ceiling by design:**
   5 orders / 10 min / IP (`RATE_MAX`, KV-backed). A load test from one
   machine can never produce more than 5 writes per window — the 429s are
   the system working, not failing. Any preview POST test needs distinct
   egress IPs or a limiter bypass in a scratch branch.
5. **CDN behaviour untested.** `/` will be far faster at the edge than the
   359 ms local average (static asset, cacheable). `/api/menu` responses
   should carry cache headers if they don't already (check `_headers`).

## Limits to know (free plan)

- Functions: 50 ms CPU / request, 30 s wall time, 100k requests/day.
- D1: 10 GB, 100k rows read/day, 100k rows written/day, ~100 writes/s
  guidance; 1,000-row query cap (our reads are single-row/bounded ✓).
- KV: 100k reads/day; menu doc read per order-write + per menu-GET.

Back-of-envelope: 52-item menu ≈ single KV read per `/api/menu` hit.
At 67 rps sustained that is ~5.8 M KV reads/day — **over the free quota
without edge caching**. Cache `/api/menu` (Cache API, 60 s TTL) before
any traffic spike. Writes are the scarcer budget: each order costs
~4 D1 statements + 2 KV ops.

## Recommendations (priority order)

1. **Edge-cache `GET /api/menu`** (Cache API or `Cache-Control: public,
   max-age=60` + KV purge on admin save — `purgePublicMenu` already
   exists in `versions.js`; verify it also purges the edge cache).
2. **Keep the 5/10-min/IP limiter** — it is the abuse backstop; verify its
   KV key (`order:ip:*`) has TTL set (it does: `RATE_TTL_SEC`).
3. **Order-number contention: FIXED** (2026-10-28) — atomic `order_counter`
   (`UPDATE ... RETURNING`, migration `0006`). Verified: 5 simultaneous
   POSTs → unique sequential numbers, 0 conflicts; 10 parallel raw
   increments → 10/10 unique. No action unless preview shows otherwise.
4. **No order queue needed yet.** Measured write p95 (496 ms local) is
   fine for restaurant volume; revisit only if preview POST p95 > 1 s.
5. **Dashboard watch-list for preview runs:** Functions → CPU time
   (p99 vs 50 ms), Errors; D1 → query latency + failed queries;
   KV → read ops vs quota.

## Re-run checklist for preview

- [ ] Deploy branch, confirm `SITE_PLAN`/env match production shape
- [ ] Seed preview menu, confirm `ordering-state: open`
- [ ] GET scenarios at preview BASE_URL (compare p95 to §2)
- [ ] POST from ≥2 egress IPs, ≤5/window/IP, unique `idemKey`s
- [ ] Record Functions CPU p99 + D1 latency, paste into §2
