/**
 * GET /api/account/orders/:number
 *
 * One order, only when it belongs to the signed-in customer. A wrong owner
 * gets 404 (not 403) so order numbers cannot be probed.
 */

import { jsonNoStore } from '../../../_shared/session.js';
import { checkCustomerApiHeaders, requireCustomer } from '../../../_shared/auth-session.js';
import { findOrderForCustomer } from '../../../_shared/repositories/orders.repo.js';
import { parseOrderNumber } from '../../../_shared/validate-auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const gate = checkCustomerApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const auth = await requireCustomer(request, env);
  if (!auth.ok) return auth.response;

  const number = parseOrderNumber(params && params.number);
  if (!number) return jsonNoStore({ error: 'bad_request' }, 400);

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable' }, 503);

  try {
    const order = await findOrderForCustomer(db, auth.user.id, number);
    if (!order) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ order });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
