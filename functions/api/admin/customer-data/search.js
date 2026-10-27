/**
 * GET /api/admin/customer-data/search?phone=<digits> — masked matches only.
 * Digits only, minimum 6, bind parameters, LIMIT 50. No reveal button exists.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';
import { digitsOnly, findMatches, maskRow } from '../../../_shared/customer-data.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'orderLogging')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'GET') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.ORDERS_DB) return jsonNoStore({ error: 'unavailable' }, 503);
  const url = new URL(request.url);
  const q = digitsOnly(url.searchParams.get('phone'));
  if (q.length < 6) return jsonNoStore({ error: 'bad_request', message: 'Enter at least 6 digits' }, 400);
  let rows;
  try {
    rows = await findMatches(env.ORDERS_DB, q);
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  return jsonNoStore({ results: rows.map(maskRow), count: rows.length });
}
