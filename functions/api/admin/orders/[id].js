/**
 * Admin Order Status Endpoint: PATCH /api/admin/orders/<id>
 * Body {status} must be one of the four order statuses. Unknown id -> 404.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import { mapOrderRow } from '../../../_shared/orders.js';

const STATUSES = ['new', 'confirmed', 'completed', 'cancelled'];

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'PATCH') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'PATCH' });
  }

  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  const status = typeof body.status === 'string' ? body.status : '';
  if (!STATUSES.includes(status)) {
    return jsonNoStore({ error: 'invalid_status' }, 400);
  }

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  const id = params && typeof params.id === 'string' ? params.id : '';
  if (!id || id.length > 128) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  const nowIso = new Date().toISOString();
  try {
    const res = await db
      .prepare('UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3')
      .bind(status, nowIso, id)
      .run();
    const changed = res && res.meta ? res.meta.changes : 0;
    if (!changed) {
      return jsonNoStore({ error: 'not_found' }, 404);
    }
    const row = await db.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
    if (!row) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ order: mapOrderRow(row) });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
