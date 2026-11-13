/**
 * Live state for the signed-in customer's own orders.
 *
 * Mirrors the two facts /api/track/batch computes for the guest bell:
 *  - receivableAt: when the "received" action unlocks (confirmed/ready only),
 *    including the joint-delivery parent when one exists;
 *  - groupNumbers: the linked group a single "received" tap completes.
 *
 * The account route is authenticated, owner-scoped, and no-store, so the
 * owner's track token is included with the order payload (the account sheet
 * reuses the same cancel/receive components as the bell). A guest never
 * reaches this helper.
 */

import { linkedReceivableAtMs, receivableAtMs } from './eta.js';
import { findTrackRowsByNumbers } from './repositories/orders.repo.js';

const ACTIVE = new Set(['new', 'confirmed', 'ready']);

function parentShape(row) {
  return {
    status: row.status,
    type: row.type,
    created_at: row.created_at,
    confirmed_at: row.confirmed_at,
    eta_at: row.eta_at,
  };
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown>} env
 * @param {Array<Record<string, unknown>>} orders mapped order rows
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function attachOrderLiveState(db, env, orders) {
  const list = Array.isArray(orders) ? orders : [];
  if (list.length === 0) return list;

  const active = list.filter((o) => o && ACTIVE.has(o.status));
  if (active.length === 0) {
    return list.map((o) => ({ ...o, receivableAt: null, groupNumbers: [] }));
  }

  // Settings only affect confirmed/ready unlock math; history-only pages
  // never pay for this KV read.
  let ordering = null;
  if (active.some((o) => o.status === 'confirmed' || o.status === 'ready')) {
    try {
      const kv = env && env.MENU_KV ? env.MENU_KV : null;
      const menu = kv ? await kv.get('menu', { type: 'json', cacheTtl: 300 }) : null;
      ordering = menu && menu.settings ? menu.settings.ordering : null;
    } catch {
      ordering = null;
    }
  }

  // Joint-delivery parents in one read (same helper as the bell).
  let parentByNumber = new Map();
  try {
    const parentNums = [...new Set(
      active
        .filter((o) => Number.isInteger(o.parentNumber))
        .map((o) => o.parentNumber)
    )].slice(0, 50);
    if (parentNums.length) {
      const rows = await findTrackRowsByNumbers(db, parentNums);
      parentByNumber = new Map(rows.map((r) => [r.number, r]));
    }
  } catch {
    parentByNumber = new Map();
  }

  // Children of these orders and of their parents in one read.
  let childrenByParent = new Map();
  try {
    const keys = [...new Set([...active.map((o) => o.number), ...parentByNumber.keys()])]
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 50);
    if (keys.length) {
      const placeholders = keys.map((_, i) => `?${i + 1}`).join(',');
      const res = await db
        .prepare(`SELECT number, parent_number FROM orders WHERE parent_number IN (${placeholders}) LIMIT 200`)
        .bind(...keys)
        .all();
      for (const row of (res && res.results) || []) {
        if (!row || !Number.isInteger(row.number) || !Number.isInteger(row.parent_number)) continue;
        if (!childrenByParent.has(row.parent_number)) childrenByParent.set(row.parent_number, []);
        childrenByParent.get(row.parent_number).push(row.number);
      }
    }
  } catch {
    childrenByParent = new Map();
  }

  return list.map((o) => {
    const parentNumber = Number.isInteger(o.parentNumber) ? o.parentNumber : null;
    let receivableAt = null;
    let groupNumbers = [];

    if (o.status === 'confirmed' || o.status === 'ready') {
      try {
        const ownMs = receivableAtMs({
          confirmedAt: o.confirmedAt || null,
          createdAt: o.createdAt || null,
          etaAt: o.etaAt || null,
          orderType: o.type,
          settings: ordering,
        });
        let finalMs = ownMs;
        if (parentNumber !== null) {
          const parent = parentByNumber.get(parentNumber);
          if (parent) finalMs = linkedReceivableAtMs(ownMs, parentShape(parent), ordering, Date.now());
        }
        receivableAt = new Date(finalMs).toISOString();
      } catch {
        receivableAt = null;
      }
    }

    if (ACTIVE.has(o.status)) {
      try {
        const set = new Set();
        if (parentNumber !== null) {
          set.add(parentNumber);
          for (const n of childrenByParent.get(parentNumber) || []) set.add(n);
        }
        for (const n of childrenByParent.get(o.number) || []) set.add(n);
        set.delete(o.number);
        groupNumbers = [...set].sort((a, b) => a - b);
      } catch {
        groupNumbers = [];
      }
    }

    return { ...o, receivableAt, groupNumbers };
  });
}
