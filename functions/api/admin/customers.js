/**
 * GET /api/admin/customers?q=<name|email|phone>&limit=200
 *
 * Registered customer accounts (Better Auth users) with their optional
 * phone/address and aggregate order stats. Admin middleware + owner/client
 * only; the kitchen gate already denies this path.
 */

import { checkApiHeaders, jsonNoStore } from '../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import { listRegisteredCustomers } from '../../_shared/repositories/customers.repo.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (!hasFeature(env, 'orderLogging')) return featureOffResponse();
  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable' }, 503);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const limitRaw = Number.parseInt(url.searchParams.get('limit') || '200', 10);
  const limit = Number.isInteger(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 200;

  try {
    const customers = await listRegisteredCustomers(db, q, limit);
    return jsonNoStore({ customers, count: customers.length, q });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
