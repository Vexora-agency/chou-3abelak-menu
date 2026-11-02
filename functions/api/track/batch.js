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
 * Minimal fields only (number, status, total, itemsCount, createdAt):
 * the bell needs nothing else, and items/names stay out of this payload.
 */

import { jsonNoStore, readJsonBody, safeCompareStrings } from '../../_shared/session.js';
import { isRateLimited, noteRateLimitHit, rateKey } from '../../_shared/access.js';
import { findTrackRowsByNumbers } from '../../_shared/repositories/orders.repo.js';

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
    results.push({
      number: row.number,
      status: row.status,
      total: typeof row.total === 'number' ? row.total : null,
      itemsCount: countItems(row),
      createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    });
  }

  if (anyFailed) {
    await noteRateLimitHit(env.MENU_KV || null, limitKey, 120, 5 * 60);
  }

  return jsonNoStore({ ok: true, results });
}
