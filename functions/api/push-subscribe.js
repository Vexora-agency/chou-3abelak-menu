/**
 * Public push subscribe: POST /api/push-subscribe
 * Body { endpoint, p256dh, auth, orderNumber, trackToken }.
 * The (number, token) pair IS the authorization: only the customer holding
 * the tracking link can attach a device to the order. One device = one row
 * (endpoint PRIMARY KEY): re-subscribing replaces. Gone endpoints are
 * pruned at send time, never here.
 */
import { jsonNoStore, readJsonBody } from '../_shared/session.js';
import { validatePushSub } from '../_shared/push.js';

const MAX_BODY_BYTES = 4 * 1024;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_content_type' }, 400);
  }

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_body' }, 400);
  }

  const sub = validatePushSub(body || {});
  if (!sub.ok) {
    return jsonNoStore({ error: 'bad_subscription', field: sub.field, got: sub.got }, 400);
  }
  const { endpoint, p256dh, auth } = sub;
  const orderNumber = Number.parseInt(body.orderNumber, 10);
  const trackToken = typeof body.trackToken === 'string' ? body.trackToken.trim() : '';

  if (
    !Number.isInteger(orderNumber) || orderNumber <= 0 ||
    !/^[0-9a-f]{32}$/.test(trackToken)
  ) {
    return jsonNoStore({ error: 'bad_order_ref' }, 400);
  }

  // Capability check: the token must belong to this order number.
  let orderId = null;
  try {
    const row = await db
      .prepare('SELECT id FROM orders WHERE number = ?1 AND track_token = ?2')
      .bind(orderNumber, trackToken)
      .first();
    orderId = row && row.id ? row.id : null;
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  if (!orderId) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  try {
    await db
      .prepare(
        'INSERT OR REPLACE INTO push_subscriptions (endpoint, order_id, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
      )
      .bind(endpoint, orderId, p256dh, auth, new Date().toISOString())
      .run();
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  return jsonNoStore({ ok: true });
}
