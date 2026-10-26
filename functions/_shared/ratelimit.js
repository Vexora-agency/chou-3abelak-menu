/**
 * Tiny KV-backed rate limiter (no dependencies).
 * hitRateLimit(kv, key, max, windowSec) -> true when the hit is allowed.
 * Fails open when KV is missing or errors (availability over strictness);
 * routes that must not send mail treat a missing KV as unavailable instead.
 */
export async function hitRateLimit(kv, key, max, windowSec) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return true;
  try {
    const raw = await kv.get(key);
    const parsed = raw ? parseInt(raw, 10) : 0;
    const used = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    if (used >= max) return false;
    await kv.put(key, String(used + 1), { expirationTtl: windowSec });
    return true;
  } catch {
    return true;
  }
}
