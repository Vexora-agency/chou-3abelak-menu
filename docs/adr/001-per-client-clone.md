# ADR-001: Per-client clone on a separate Cloudflare account

One repo snapshot per restaurant, each with its OWN Cloudflare account
(D1+KV+R2+Pages). Free-plan quotas are per-account, so clients never share
quotas; a busy client cannot bill or break another. Trade-off: N accounts to
administer (see RF-13); structural changes must be merged into every clone.
