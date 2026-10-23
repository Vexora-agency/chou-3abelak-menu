/**
 * Admin Logout Endpoint: POST /api/auth/logout
 * Clears the session cookie. Idempotent — always succeeds.
 */

import { checkApiHeaders, clearSessionCookieHeader, jsonNoStore } from '../../_shared/session.js';

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'POST' });
  }

  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  return jsonNoStore({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() });
}
