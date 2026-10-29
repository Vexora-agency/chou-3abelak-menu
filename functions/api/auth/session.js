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
import { isSessionRevoked } from '../../_shared/access.js';

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
  if (!payload) return jsonNoStore({ authenticated: false });
  // A disabled/deleted account reads as logged-out everywhere at once.
  if (await isSessionRevoked(env.MENU_KV || null, payload.sub, payload.iat)) {
    return jsonNoStore({ authenticated: false });
  }
  return jsonNoStore({ authenticated: true });
}
