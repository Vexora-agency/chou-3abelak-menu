/**
 * Public VAPID key: GET /api/push-key -> { ok, publicKey }.
 * The pair is generated lazily once (see _shared/push.js): no secrets here,
 * the public key is MEANT for browsers. Caches for a day at the edge.
 */
import { jsonNoStore } from '../_shared/session.js';
import { getVapidSettings } from '../_shared/push.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  let origin = '';
  try {
    origin = new URL(request.url).origin;
  } catch {
    origin = '';
  }

  const vapid = await getVapidSettings(db, origin);
  if (!vapid || !vapid.public_key) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  return jsonNoStore(
    { ok: true, publicKey: vapid.public_key },
    200,
    { 'Cache-Control': 'public, max-age=86400' }
  );
}
