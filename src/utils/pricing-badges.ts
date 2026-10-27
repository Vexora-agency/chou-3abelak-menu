/**
 * Smart-badge helpers (client copy, split from pricing.ts).
 * MUST stay behavior-identical to functions/_shared/pricing-badges.js.
 * Pure functions only — no dependencies.
 * Re-exported from ./pricing.ts so existing importers keep working.
 */
import type { MenuData, MenuItem } from '@/src/types/menu';

export interface TopSellerOptions {
  days?: number;
  count?: number;
  nowMs?: number;
}

export interface RankedItem {
  id: string;
  qty: number;
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function badgeSettings(menu: MenuData): { newDays: number; topDays: number; topCount: number } {
  const raw = (menu && (menu.settings as { badges?: unknown }).badges && typeof (menu.settings as { badges?: unknown }).badges === 'object'
    ? (menu.settings as unknown as { badges: Record<string, unknown> }).badges
    : {});
  return {
    newDays: isInt(raw.newDays) && (raw.newDays) > 0 ? (raw.newDays) : 14,
    topDays: isInt(raw.topDays) && (raw.topDays) > 0 ? (raw.topDays) : 30,
    topCount: isInt(raw.topCount) && (raw.topCount) > 0 ? (raw.topCount) : 6,
  };
}

/** True while the item is within its NEW window (addedAt + newDays). */
export function isNewItem(menu: MenuData, item: MenuItem, nowMs?: number): boolean {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const { newDays } = badgeSettings(menu);
  if (!item || typeof item.addedAt !== 'string') return false;
  const t = Date.parse(item.addedAt);
  if (!Number.isFinite(t) || t > now) return false;
  return now - t <= newDays * 86400000;
}

/** Stored badges plus the automatic NEW badge (deduped). */
export function effectiveBadges(menu: MenuData, item: MenuItem, nowMs?: number): string[] {
  const set = new Set<string>(Array.isArray(item && item.badges) ? (item.badges as string[]) : []);
  if (isNewItem(menu, item, nowMs)) set.add('new');
  return [...set];
}

/**
 * Rank items by quantity sold in the window (cancelled excluded).
 * Returns [{ id, qty }] sorted by qty desc (ties by id).
 */
export function topSellers(
  orders: { createdAt: string; status: string; items: { id: string; qty: number }[] }[],
  menu: MenuData,
  opts?: TopSellerOptions
): RankedItem[] {
  const o = opts || {};
  const now = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
  const { topDays, topCount } = badgeSettings(menu);
  const days = isInt(o.days) && (o.days) > 0 ? (o.days) : topDays;
  const count = isInt(o.count) && (o.count) > 0 ? (o.count) : topCount;
  const start = now - days * 86400000;
  const map = new Map<string, number>();
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
