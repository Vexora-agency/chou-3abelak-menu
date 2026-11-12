/**
 * Batched order tracking: POST /api/track/batch { orders: [{ number, t }] }
 * Bell-only endpoint — one request for the whole shelf instead of N× GET
 * /api/track (one KV rate-limit probe + one D1 round-trip per tick).
 * Token-gated per row (same 128-bit capability model as GET /api/track).
 *
 * No-oracle shape: every input pair yields exactly one result entry —
 * valid pairs get the status payload, unknown numbers / bad tokens get
 * the same `unknown` shape with their number, malformed pairs get the
 * same `unknown` shape with `number: null`. Never 404s per row.
 * Accepted residual: `number: null` vs int still differs, so well-formed
 * vs malformed stays distinguishable by shape; the bell never sends
 * malformed pairs and the real attack surface — token/number guessing —
 * stays identical (bad token reads exactly like unknown number).
 * Minimal fields only (number, status, total, itemsCount, createdAt +
 * receivableAt): the bell gates its receive button on the unlock instant,
 * so per-row unlocks ride along — two small fields, computed from columns
 * already fetched, plus one edge-cached settings read per batch tick.
 * etaAt itself stays out: the bell renders no ETA copy (the track page
 * re-fetches the single order for its countdown banner).
 */

import { jsonNoStore, readJsonBody, safeCompareStrings } from '../../_shared/session.js';
import { isRateLimited, noteRateLimitHit, rateKey } from '../../_shared/access.js';
import { findTrackRowsByNumbers } from '../../_shared/repositories/orders.repo.js';
import { linkedReceivableAtMs, receivableAtMs } from '../../_shared/eta.js';

const MAX_BODY_BYTES = 8 * 1024;
const MAX_BATCH = 20;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const STATUSES = ['new', 'confirmed', 'ready', 'completed', 'cancelled'];

const unknownShape = (number) => ({
  number,
  status: 'unknown',
  total: null,
  itemsCount: null,
  createdAt: null,
  receivableAt: null,
  etaAt: null,
  parentNumber: null,
  groupNumbers: [],
});

function cleanPair(pair) {
  if (!pair || typeof pair !== 'object') return null;
  const number = typeof pair.number === 'number' ? pair.number : NaN;
  const t = typeof pair.t === 'string' ? pair.t.trim() : '';
  if (!Number.isInteger(number) || number <= 0 || !TOKEN_RE.test(t)) return null;
  return { number, t };
}

function countItems(row) {
  try {
    const parsed = JSON.parse(row.items_json || '[]');
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  const rawList = body && Array.isArray(body.orders) ? body.orders : null;
  if (!rawList) {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }
  if (rawList.length > MAX_BATCH) {
    return jsonNoStore({ error: 'too_many' }, 400);
  }

  // One shared probe for the whole batch (same per-IP window as the
  // single route). Successes stay write-free; a batch containing at
  // least one bad token counts once — brute force still burns budget.
  const limitKey = rateKey('track', request);
  if (await isRateLimited(env.MENU_KV || null, limitKey, 120, 5 * 60)) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }

  const pairs = rawList.map(cleanPair);
  const byNumber = new Map();
  for (const pair of pairs) {
    if (pair && !byNumber.has(pair.number)) byNumber.set(pair.number, pair.t);
  }

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  let rows = [];
  try {
    rows = await findTrackRowsByNumbers(db, [...byNumber.keys()]);
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  const rowByNumber = new Map(rows.map((r) => [r.number, r]));

  let anyFailed = false;
  const results = [];
  // Settings for the unlock computation: ONE edge-cached menu KV read per
  // batch tick, and only when at least one row can actually need it
  // (confirmed/ready) — batches of pure-`new` orders cost zero extra reads.
  // Best-effort with hardcoded fallbacks: a KV miss degrades to defaults,
  // never to an error.
  const needsUnlock = rows.some((r) => r && (r.status === 'confirmed' || r.status === 'ready'));
  let ordering = null;
  if (needsUnlock) {
    try {
      const kv = env.MENU_KV || null;
      const menu = kv ? await kv.get('menu', { type: 'json', cacheTtl: 300 }) : null;
      ordering = menu && menu.settings ? menu.settings.ordering : null;
    } catch {
      ordering = null;
    }
  }
  // Joint-delivery parents: collect every parent_number on the shelf and
  // load them in ONE extra round-trip so each child can unlock with its
  // parent (courier carries both together). Best-effort, never fails batch.
  let parentByNumber = new Map();
  try {
    const parentNums = [...new Set(
      rows
        .filter((r) => r && Number.isInteger(r.parent_number))
        .map((r) => r.parent_number)
    )].slice(0, 20);
    if (parentNums.length) {
      const prows = await findTrackRowsByNumbers(db, parentNums);
      parentByNumber = new Map(prows.map((r) => [r.number, r]));
    }
  } catch {
    parentByNumber = new Map();
  }
  // Joint groups for one-tap receipt: children of every shelf number AND of
  // every shelf parent, in ONE extra round-trip (≤100 rows). Best-effort.
  let childrenByParent = new Map();
  try {
    const keys = [...new Set([...byNumber.keys(), ...parentByNumber.keys()])].slice(0, 40);
    if (keys.length) {
      const cres = await db
        .prepare(`SELECT number, parent_number FROM orders WHERE parent_number IN (${keys.map(() => '?').join(',')}) LIMIT 100`)
        .bind(...keys)
        .all();
      for (const r of (cres && cres.results) || []) {
        if (!r || !Number.isInteger(r.number) || !Number.isInteger(r.parent_number)) continue;
        if (!childrenByParent.has(r.parent_number)) childrenByParent.set(r.parent_number, []);
        childrenByParent.get(r.parent_number).push(r.number);
      }
    }
  } catch {
    childrenByParent = new Map();
  }
  // Preserve request order and duplicates: one entry per input pair.
  // Malformed pairs also yield one `unknown` entry (number: null) so
  // result length never leaks well-formed vs malformed.
  for (const pair of pairs) {
    if (!pair) {
      anyFailed = true;
      results.push(unknownShape(null));
      continue;
    }
    const row = rowByNumber.get(pair.number);
    let ok = false;
    try {
      ok = !!(row && typeof row.track_token === 'string' && (await safeCompareStrings(pair.t, row.track_token)));
    } catch {
      ok = false;
    }
    if (!ok || !row || !STATUSES.includes(row.status)) {
      anyFailed = true;
      results.push(unknownShape(pair.number));
      continue;
    }
    // Receive-unlock instant for confirmed/ready rows only — the bell
    // disables its button until this passes (same rule as GET /api/track,
    // so the two surfaces can never disagree). Follow-ups unlock with the
    // earlier of own/parent (joint delivery).
    let receivableAt = null;
    const parentNumber = Number.isInteger(row.parent_number) ? row.parent_number : null;
    if (row.status === 'confirmed' || row.status === 'ready') {
      try {
        const ownMs = receivableAtMs({
          confirmedAt: row.confirmed_at,
          createdAt: row.created_at,
          etaAt: row.eta_at,
          orderType: row.type,
          settings: ordering,
        });
        let finalMs = ownMs;
        if (parentNumber !== null) {
          const prow = parentByNumber.get(parentNumber);
          if (prow) {
            finalMs = linkedReceivableAtMs(ownMs, {
              status: prow.status,
              type: prow.type,
              created_at: prow.created_at,
              confirmed_at: prow.confirmed_at,
              eta_at: prow.eta_at,
            }, ordering, Date.now());
          }
        }
        receivableAt = new Date(finalMs).toISOString();
      } catch {
        receivableAt = null;
      }
    }
    results.push({
      number: row.number,
      status: row.status,
      parentNumber,
      // Joint group (one-tap receipt): parent + fellow children + own
      // children, minus self. Empty when solo — the bell keeps single taps.
      groupNumbers: (() => {
        try {
          const set = new Set();
          if (parentNumber !== null) {
            set.add(parentNumber);
            for (const n of childrenByParent.get(parentNumber) || []) set.add(n);
          }
          for (const n of childrenByParent.get(row.number) || []) set.add(n);
          set.delete(row.number);
          return [...set].sort((a, b) => a - b);
        } catch {
          return [];
        }
      })(),
      total: typeof row.total === 'number' ? row.total : null,
      itemsCount: countItems(row),
      createdAt: typeof row.created_at === 'string' ? row.created_at : null,
      receivableAt,
      // ETA range for the bell's expected-arrival line (same instant the
      // track page banners; null when the kitchen hasn't confirmed yet).
      etaAt: typeof row.eta_at === 'string' ? row.eta_at : null,
    });
  }

  if (anyFailed) {
    await noteRateLimitHit(env.MENU_KV || null, limitKey, 120, 5 * 60);
  }

  return jsonNoStore({ ok: true, results });
}
