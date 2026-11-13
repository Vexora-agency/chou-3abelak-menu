/**
 * GET /api/account/orders?days=365&limit=50
 *
 * The signed-in customer's own order history. Scoped by the session user id;
 * a client-supplied user id is never read. Defaults to the last 365 days.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { checkCustomerApiHeaders, requireCustomer } from '../../_shared/auth-session.js';
import { listOrdersForCustomer } from '../../_shared/repositories/orders.repo.js';
import { attachOrderLiveState } from '../../_shared/order-live-state.js';

function intParam(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const gate = checkCustomerApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const auth = await requireCustomer(request, env);
  if (!auth.ok) return auth.response;

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable' }, 503);

  const url = new URL(request.url);
  const days = intParam(url.searchParams.get('days'), 365, 1, 365);
  const limit = intParam(url.searchParams.get('limit'), 50, 1, 50);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    const orders = await listOrdersForCustomer(db, auth.user.id, since, limit);
    const enriched = await attachOrderLiveState(db, env, orders);
    return jsonNoStore({ orders: enriched, days, count: enriched.length });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
