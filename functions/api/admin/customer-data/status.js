/**
 * GET /api/admin/customer-data/status — tool visibility probe.
 * 404 when the orderLogging feature is off.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'orderLogging')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  return jsonNoStore({ enabled: !!env.ORDERS_DB });
}
