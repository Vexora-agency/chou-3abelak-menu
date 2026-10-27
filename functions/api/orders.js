/**
 * Public Order Endpoint: POST /api/orders
 * Records a customer order. Prices/names always come from the live menu —
 * client-supplied totals are ignored. Never reads or modifies existing orders
 * except through the idempotency key.
 */

import { jsonNoStore, readJsonBody } from '../_shared/session.js';
import { mapOrderRow, newOrderId, validateOrderInput } from '../_shared/orders.js';
import { getOrderingState } from '../_shared/status.js';

const MAX_BODY_BYTES = 8 * 1024;
const RATE_PREFIX = 'order:ip:';
const RATE_TTL_SEC = 10 * 60;
const RATE_MAX = 5;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  let reqOrigin;
  try {
    reqOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (!origin) return false;
  const sameHost = (h) => h === 'localhost' || h === '127.0.0.1';
  let originHost;
  let reqHost;
  try {
    originHost = new URL(origin).hostname;
    reqHost = new URL(reqOrigin).hostname;
  } catch {
    return false;
  }
  const local = sameHost(originHost) && sameHost(reqHost);
  return origin === reqOrigin || local;
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

  if (!checkOrigin(request)) {
    return jsonNoStore({ error: 'forbidden' }, 403);
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  // Honeypot: bots fill it, humans never see it. Fake success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return jsonNoStore({ ok: true });
  }

  const kv = env.MENU_KV || null;
  const db = env.ORDERS_DB || null;
  if (!kv || !db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Load the live menu (prices/names come only from here)
  let menu = null;
  try {
    menu = await kv.get('menu', { type: 'json' });
  } catch {}
  if (!menu || !Array.isArray(menu.items)) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Availability is evaluated FIRST from the live menu at submit time, so
  // the answer is always 403 {error:'paused'|'closed'|'disabled', message}.
  // Client-sent state is ignored. Not open -> no order is recorded.
  let orderingState = { state: 'open' };
  try {
    orderingState = getOrderingState((menu && menu.settings) || {}, Date.now());
  } catch {}
  if (orderingState.state !== 'open') {
    return jsonNoStore({ error: orderingState.state, message: orderingState.message || { en: '', ar: '' } }, 403);
  }

  const checked = validateOrderInput(body, menu);
  if (!checked.ok) {
    const code = (checked.errors && checked.errors[0]) || 'invalid';
    if (code === 'min_order') {
      const out = { error: code };
      if (typeof checked.minOrder === 'number') out.minOrder = checked.minOrder;
      return jsonNoStore(out, 400);
    }
    return jsonNoStore({ error: code }, 400);
  }
  const c = checked.cleaned;

  // Rate limit: 5 orders per 10 minutes per IP
  const ip = clientIp(request);
  const nowSec = Math.floor(Date.now() / 1000);
  let used = 0;
  let windowReset = nowSec + RATE_TTL_SEC;
  try {
    const raw = await kv.get(RATE_PREFIX + ip);
    if (raw) {
      const state = JSON.parse(raw);
      if (state && typeof state.n === 'number' && typeof state.reset === 'number' && nowSec < state.reset) {
        used = state.n;
        windowReset = state.reset;
      }
    }
  } catch {}
  if (used >= RATE_MAX) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }

  // Idempotency: a repeated key returns the original order (stored totals, not
  // freshly computed ones — the menu may have changed since the first insert).
  if (c.idemKey) {
    try {
      const existing = await db
        .prepare('SELECT number, total FROM orders WHERE idem_key = ?1')
        .bind(c.idemKey)
        .first();
      if (existing && typeof existing.number === 'number') {
        return jsonNoStore({
          ok: true,
          orderNumber: existing.number,
          total: typeof existing.total === 'number' ? existing.total : c.total,
        });
      }
    } catch {}
  }

  const nowIso = new Date().toISOString();
  const insertWithNumber = async (num) => {
    const id = newOrderId();
    await db.batch([
      db
        .prepare(
          'INSERT INTO orders (id, number, idem_key, created_at, updated_at, status, type, customer_name, customer_phone, phone_norm, customer_address, customer_table, notes, location_lat, location_lng, items_json, subtotal, delivery_fee, total, lang) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)'
        )
        .bind(
          id,
          num,
          c.idemKey,
          nowIso,
          nowIso,
          'new',
          c.type,
          c.name,
          c.phone,
          c.phoneNorm,
          c.address,
          c.table,
          c.notes,
          c.location ? c.location.lat : null,
          c.location ? c.location.lng : null,
          JSON.stringify(c.items),
          c.subtotal,
          c.deliveryFee,
          c.total,
          c.lang
        ),
    ]);
    return { id, num };
  };

  // Order numbers start at 1001: MAX(number)+1 inside one batch, one retry on conflict
  let created = null;
  for (let attempt = 0; attempt < 2 && !created; attempt++) {
    try {
      const row = await db.prepare('SELECT MAX(number) AS m FROM orders').first();
      const next = (row && typeof row.m === 'number' ? row.m : 1000) + 1;
      created = await insertWithNumber(next);
    } catch {
      created = null;
      if (c.idemKey) {
        try {
          const existing = await db
            .prepare('SELECT number, total FROM orders WHERE idem_key = ?1')
            .bind(c.idemKey)
            .first();
          if (existing && typeof existing.number === 'number') {
            return jsonNoStore({
              ok: true,
              orderNumber: existing.number,
              total: typeof existing.total === 'number' ? existing.total : c.total,
            });
          }
        } catch {}
      }
    }
  }
  if (!created) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Bookkeeping (never blocks the response). Retention lives in the daily
  // /api/internal/run-reports job now — never here.
  const after = (async () => {
    try {
      await kv.put(
        RATE_PREFIX + ip,
        JSON.stringify({ n: used + 1, reset: windowReset }),
        { expirationTtl: RATE_TTL_SEC }
      );
    } catch {}
  })();
  if (context.waitUntil) {
    try {
      context.waitUntil(after);
    } catch {}
  } else {
    await after;
  }

  // Fetch the stored row back so the response reflects exactly what was saved
  let savedTotal = c.total;
  try {
    const row = await db.prepare('SELECT * FROM orders WHERE id = ?1').bind(created.id).first();
    if (row) savedTotal = mapOrderRow(row).total;
  } catch {}
  return jsonNoStore({ ok: true, orderNumber: created.num, total: savedTotal });
}
