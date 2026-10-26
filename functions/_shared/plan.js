/**
 * Plan + feature gating (WebCrypto/node-compatible, no dependencies).
 *
 * The site plan comes from the SITE_PLAN env var ('starter' when unset).
 * Features not included in the current plan answer 404 — same shape as a
 * missing route so outsiders cannot tell a gated feature from a absent one.
 */

export const PLANS = ['starter', 'pro', 'signature'];

export const FEATURES = {
  // Monthly reports (dashboard tab, report APIs, scheduled emails).
  monthlyReports: ['pro', 'signature'],
  // Order recording + customer data tool (privacy page itself is public).
  orderLogging: ['pro', 'signature'],
};

export function getPlan(env) {
  const p = typeof env?.SITE_PLAN === 'string' ? env.SITE_PLAN.trim().toLowerCase() : '';
  return PLANS.includes(p) ? p : 'starter';
}

export function hasFeature(env, feature) {
  const allowed = FEATURES[feature];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(getPlan(env));
}

/** 404 JSON response used when a feature is off (same as a missing route). */
export function featureOffResponse() {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
