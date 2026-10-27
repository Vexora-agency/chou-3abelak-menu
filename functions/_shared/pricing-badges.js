/**
 * Smart-badge helpers (server copy, split from pricing.js).
 * MUST stay behavior-identical with src/utils/pricing.ts badge logic.
 * Pure functions only — no dependencies, works in Cloudflare Workers and Node.
 * Re-exported from ./pricing.js so existing importers keep working.
 */

function isInt(n) {
  return typeof n === 'number' && Number.isInteger(n);
}

function badgeSettings(menu) {
  const raw = menu && menu.settings && typeof menu.settings.badges === 'object' ? menu.settings.badges : {};
  return {
    newDays: isInt(raw.newDays) && raw.newDays > 0 ? raw.newDays : 14,
    topDays: isInt(raw.topDays) && raw.topDays > 0 ? raw.topDays : 30,
    topCount: isInt(raw.topCount) && raw.topCount > 0 ? raw.topCount : 6,
  };
}

/** True while the item is within its NEW window (addedAt + newDays). */
export function isNewItem(menu, item, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const { newDays } = badgeSettings(menu);
  if (!item || typeof item.addedAt !== 'string') return false;
  const t = Date.parse(item.addedAt);
  if (!Number.isFinite(t) || t > now) return false;
  return now - t <= newDays * 86400000;
}

/** Stored badges plus the automatic NEW badge (deduped). */
export function effectiveBadges(menu, item, nowMs) {
  const set = new Set(Array.isArray(item && item.badges) ? item.badges : []);
  if (isNewItem(menu, item, nowMs)) set.add('new');
  return [...set];
}

/**
 * Rank items by quantity sold in the window (cancelled excluded).
 * orders: [{ createdAt, status, items: [{ id, qty }] }].
 * Returns [{ id, qty }] sorted by qty desc (ties by id).
 */
export function topSellers(orders, menu, opts) {
  const o = opts || {};
  const now = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
  const { topDays, topCount } = badgeSettings(menu);
  const days = isInt(o.days) && o.days > 0 ? o.days : topDays;
  const count = isInt(o.count) && o.count > 0 ? o.count : topCount;
  const start = now - days * 86400000;
  const map = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || order.status === 'cancelled') continue;
    const t = Date.parse(order.createdAt);
    if (!Number.isFinite(t) || t < start || t > now) continue;
    for (const it of Array.isArray(order.items) ? order.items : []) {
      if (!it || typeof it.id !== 'string' || !isInt(it.qty) || it.qty <= 0) continue;
      map.set(it.id, (map.get(it.id) || 0) + it.qty);
    }
  }
  return [...map.entries()]
    .map(([id, qty]) => ({ id, qty }))
    .sort((a, b) => (b.qty - a.qty) || (a.id < b.id ? -1 : 1))
    .slice(0, count);
}
