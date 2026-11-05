/**
 * Revoke all owner sessions: POST /api/admin/sessions/revoke
 * Owner-only kill switch for a stolen/compromised master cookie.
 *
 * Effect: stamps `access:revoked:admin` = now. Every admin session minted
 * at or before the stamp dies on its next middleware check — INCLUDING the
 * caller's own session, so the UI signs out immediately after `{ok:true}`.
 * Logging in again mints a newer iat and works normally. The stamp lives
 * 30 days (REVOKE_TTL_SEC, covers the longest 30-day "remember me"
 * session), then expires harmlessly.
 *
 * Fails closed: a revoked-or-unreadable caller session gets 403 before any
 * state change (the explicit isSessionRevoked check doubles the
 * _middleware gate so the route stays safe under direct invocation too).
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import { isSessionRevoked, requireOwner, revokeSessions } from '../../../_shared/access.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'POST' });
  }
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  try {
    await readJsonBody(request);
  } catch {
    return jsonNoStore({ error: 'bad_request', message: 'Invalid JSON body' }, 400);
  }

  const owner = await requireOwner(request, env);
  if (!owner) return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);

  const kv = env.MENU_KV || null;
  if (await isSessionRevoked(kv, owner.sub, owner.iat)) {
    return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);
  }

  await revokeSessions(kv, 'admin');
  return jsonNoStore({ ok: true });
}
