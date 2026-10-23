/**
 * Admin Session Endpoint: GET /api/auth/session
 * Returns { authenticated: boolean } — never leaks details.
 */

import {
  checkApiHeaders,
  getSessionCookie,
  getSessionSecret,
  jsonNoStore,
  verifySessionToken,
} from '../../_shared/session.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'GET' });
  }

  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const secret = getSessionSecret(env);
  if (!secret) return jsonNoStore({ authenticated: false });

  const token = getSessionCookie(request);
  if (!token) return jsonNoStore({ authenticated: false });

  const payload = await verifySessionToken(secret, token);
  return jsonNoStore({ authenticated: payload !== null });
}
