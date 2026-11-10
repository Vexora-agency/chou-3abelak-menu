/**
 * Manage client logins: POST /api/admin/clients/update
 *   { username, action: 'disable' | 'enable' | 'delete' }
 * Owner-only.
 *
 *  - disable: account stays, login rejected, LIVE sessions die at once
 *    (KV revocation stamp — stateless sessions can't be edited in place).
 *  - enable: account works again immediately (stamp cleared).
 *  - delete: row + pending invites gone, live sessions die at once.
 *    The name becomes reusable for a future invite.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import {
  ROLE_CLIENT,
  clearRevocation,
  isInviteUsername,
  isMissingColumnError,
  isRole,
  normalizeUsername,
  requireOwner,
  revokeSessions,
} from '../../../_shared/access.js';

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

  const username = normalizeUsername(body.username);
  const action = typeof body.action === 'string' ? body.action : '';
  if (!isInviteUsername(username)) {
    return jsonNoStore({ error: 'bad_username', message: 'Unknown login name' }, 400);
  }
  if (action !== 'disable' && action !== 'enable' && action !== 'delete') {
    return jsonNoStore({ error: 'bad_action', message: 'Action must be disable, enable or delete' }, 400);
  }

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable', message: 'Login is not configured' }, 503);
  const kv = env.MENU_KV || null;

  try {
    // Role-agnostic by design: disable/enable/delete key on username only,
    // so client and kitchen accounts are managed identically (owner-only).
    let role = ROLE_CLIENT;
    try {
      const row = await db.prepare('SELECT username, role FROM client_users WHERE username = ?').bind(username).first();
      if (!row) return jsonNoStore({ error: 'not_found', message: 'No login under that name' }, 404);
      role = isRole(row.role) ? row.role : ROLE_CLIENT;
    } catch (e) {
      // Pre-0028 database without the role column.
      if (!isMissingColumnError(e)) throw e;
      const row = await db.prepare('SELECT username FROM client_users WHERE username = ?').bind(username).first();
      if (!row) return jsonNoStore({ error: 'not_found', message: 'No login under that name' }, 404);
    }

    if (action === 'disable') {
      await db
        .prepare('UPDATE client_users SET disabled_at = ? WHERE username = ?')
        .bind(new Date().toISOString(), username)
        .run();
      await revokeSessions(kv, username);
      return jsonNoStore({ ok: true, username, role, disabled: true });
    }
    if (action === 'enable') {
      await db.prepare('UPDATE client_users SET disabled_at = NULL WHERE username = ?').bind(username).run();
      await clearRevocation(kv, username);
      return jsonNoStore({ ok: true, username, role, disabled: false });
    }
    await db.prepare('DELETE FROM invites WHERE username = ?').bind(username).run();
    await db.prepare('DELETE FROM client_users WHERE username = ?').bind(username).run();
    await revokeSessions(kv, username);
    return jsonNoStore({ ok: true, username, role, deleted: true });
  } catch {
    return jsonNoStore({ error: 'unavailable', message: 'Could not update the login' }, 503);
  }
}
