/**
 * Revoke an invite: POST /api/admin/invites/revoke  { id }
 * Owner-only. Deletes the row outright — a revoked link dies immediately,
 * and no hash material lingers. Idempotent (unknown ids still return ok).
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import { requireOwner } from '../../../_shared/access.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'POST' });
  }
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonNoStore({ error: 'bad_request', message: 'Invalid JSON body' }, 400);
  }

  const owner = await requireOwner(request, env);
  if (!owner) return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable', message: 'Login is not configured' }, 503);

  const id = typeof body.id === 'string' ? body.id.trim().slice(0, 64) : '';
  if (!id) return jsonNoStore({ error: 'bad_request', message: 'Missing invite id' }, 400);

  try {
    await db.prepare('DELETE FROM invites WHERE id = ?').bind(id).run();
    return jsonNoStore({ ok: true });
  } catch {
    return jsonNoStore({ error: 'unavailable', message: 'Could not revoke the invite' }, 503);
  }
}
