# 06 — Cloudflare FREE-plan limits (fetched 2026-11-01, all from developers.cloudflare.com + cloudflare.com/plans unless noted)

| # | Limit (Free plan) | Value | Source URL |
|---|---|---|---|
| L1 | Workers/Pages Functions requests | 100,000 / day / account (UTC reset; static-asset hits free) | https://developers.cloudflare.com/workers/platform/limits/ + https://developers.cloudflare.com/workers/platform/pricing/ |
| L2 | CPU time per invocation | 10 ms (HTTP), 10 ms (cron); avg worker ~2.2 ms | https://developers.cloudflare.com/workers/platform/limits/ |
| L3 | Subrequests per invocation | 50 external / 1,000 to Cloudflare services | https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/ |
| L4 | Workers per account | 100 (paid 500); cron triggers 5 / account | https://developers.cloudflare.com/workers/platform/limits/ |
| L5 | D1 rows read / written | 5,000,000 / day ; 100,000 / day (hard fail past 2026-09-01 enforcement) | https://developers.cloudflare.com/d1/platform/pricing/ + https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/ |
| L6 | D1 storage / DB size / DBs | 5 GB total / 500 MB per DB / 10 DBs per account | https://developers.cloudflare.com/d1/platform/limits/ |
| L7 | KV reads / writes-deletes-lists | 100,000 / day ; 1,000 / day each | https://developers.cloudflare.com/kv/platform/pricing/ + https://developers.cloudflare.com/kv/platform/limits/ |
| L8 | KV storage / namespaces | 1 GB total+per-namespace / 1,000 namespaces | https://developers.cloudflare.com/kv/platform/limits/ |
| L9 | R2 (Standard, free tier) | 10 GB-month / mo ; 1M Class-A / 10M Class-B ops / mo ; egress free | https://developers.cloudflare.com/r2/pricing/ |
| L10 | R2 buckets | 100,000 default (shared all classes) | https://developers.cloudflare.com/r2/platform/limits/ |
| L11 | Pages projects / files / builds | 100 projects / account ; 20,000 files/site ; 500 builds/mo ; 100 custom domains/project | https://developers.cloudflare.com/pages/platform/limits/ |

Account-level white-label caps that matter: D1 = 10 databases (L6) is the client-count ceiling on free (1 ORDERS_DB per client). Cron = 5/account, scheduler uses 1 (L4). All daily quotas are ACCOUNT-wide, so N client-sites on one account share them.
D1 rows-read definition (scan-based, not return-based) + index note: https://developers.cloudflare.com/d1/platform/pricing/ items 1-6.
