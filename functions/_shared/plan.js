/**
 * Plan + feature gating (WebCrypto/node-compatible, no dependencies).
 *
 * Two tiers: starter (menu display) < pro (full ordering + business tools).
 * Starter is display-only by UI contract (no cart, no checkout); the server
 * gates data features. Features not included answer 404 — same shape as a
 * missing route so outsiders cannot tell a gated feature from an absent one.
 *
 * The site plan comes from the SITE_PLAN env var ('starter' when unset).
 */

export const PLANS = ['starter', 'pro'];

export const FEATURES = {
  // Monthly reports (dashboard tab, report APIs, scheduled emails).
  monthlyReports: ['pro'],
  // Order recording views + customer data tool (recording itself always runs
  // so an upgrade unlocks history; the privacy page itself is public).
  orderLogging: ['pro'],
  // NOTE — no `ordering` entry on purpose: order TAKING stays open on every
  // plan (fail-open ordering is a feature, not a leak — a fresh deploy must
  // accept orders before SITE_PLAN is set). Only the views above are gated.
  // Backup & history: versions, trash listing, import/export/print, auto
  // weekly mail, activity feed. (Trash delete-with-undo + restore-by-id stay
  // open on every plan: they are safety, not premium.)
  backups: ['pro'],
  // Announcement banner authoring (the banner renders from saved data, so a
  // starter storefront simply has nothing to show).
  announcements: ['pro'],
};

export function getPlan(env) {
  const p = typeof env?.SITE_PLAN === 'string' ? env.SITE_PLAN.trim().toLowerCase() : '';
  // Legacy alias: 'plus'/'signature' always meant pro-equivalent — existing
  // deployments keep working with zero flag-day (new sales use starter|pro).
  if (p === 'plus' || p === 'signature') return 'pro';
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

/**
 * Plan scrub for menu saves (starter): the stored announcement is FROZEN,
 * never wiped. A starter save keeps whatever announcement was already stored
 * (downgraded Pro data survives untouched and reappears on upgrade); only a
 * client with no stored announcement gets the inert disabled-empty block —
 * and since the admin UI is hidden, no new announcement can be authored.
 * Type-valid, validation-safe (validate.js treats it as optional), and every
 * reader already tolerates it (announcementStatus(undefined) === off).
 * Returns the same object when nothing is gated (no copy, no surprise).
 */
const INERT_ANNOUNCEMENT = { enabled: false, text: { en: '', ar: '' }, startsAt: null, expiresAt: null };

export function applyPlanToSettings(env, settings, preservedAnnouncement) {
  if (!settings || typeof settings !== 'object') return settings;
  if (hasFeature(env, 'announcements')) return settings;
  const keep = preservedAnnouncement && typeof preservedAnnouncement === 'object'
    ? preservedAnnouncement
    : INERT_ANNOUNCEMENT;
  if (settings.announcement === keep) return settings;
  return { ...settings, announcement: keep };
}
