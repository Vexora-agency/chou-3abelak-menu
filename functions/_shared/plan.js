/**
 * Plan + feature gating (WebCrypto/node-compatible, no dependencies).
 *
 * Tiers (low to high): starter < pro < plus. Plus currently unlocks the same
 * code features as pro — it differs by service (custom domain, redesign,
 * review calls), not by gates — but it is a first-class plan value so the
 * marketing tiers and the code never disagree on names.
 *
 * The site plan comes from the SITE_PLAN env var ('starter' when unset).
 * Features not included in the current plan answer 404 — same shape as a
 * missing route so outsiders cannot tell a gated feature from an absent one.
 */

export const PLANS = ['starter', 'pro', 'plus'];

export const FEATURES = {
  // Monthly reports (dashboard tab, report APIs, scheduled emails).
  monthlyReports: ['pro', 'plus'],
  // Order recording views + customer data tool (recording itself always runs
  // so an upgrade unlocks history; the privacy page itself is public).
  orderLogging: ['pro', 'plus'],
  // Backup & history: versions, trash listing, import/export/print, auto
  // weekly mail, activity feed. (Trash delete-with-undo + restore-by-id stay
  // open on every plan: they are safety, not premium.)
  backups: ['pro', 'plus'],
  // Announcement banner authoring (the banner renders from saved data, so a
  // starter storefront simply has nothing to show).
  announcements: ['pro', 'plus'],
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
