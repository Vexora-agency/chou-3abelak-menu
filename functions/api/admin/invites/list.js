/**
 * List invites: GET /api/admin/invites/list — owner-only.
 * Returns metadata only (usernames, dates, status). Hashes never leave D1.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { ROLE_CLIENT, isMissingColumnError, isRole, requireOwner } from '../../../_shared/access.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'GET' });
  }
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const owner = await requireOwner(request, env);
  if (!owner) return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable', message: 'Login is not configured' }, 503);

  try {
    const nowIso = new Date().toISOString();
    let inviteRows;
    try {
      const res = await db
        .prepare(
          'SELECT id, username, role, created_at AS createdAt, expires_at AS expiresAt, used_at AS usedAt FROM invites ORDER BY created_at DESC LIMIT 100'
        )
        .all();
      inviteRows = res.results || [];
    } catch (e) {
      // Pre-0028 database without the role column: legacy shape, every
      // invite reads as 'client' (the migration default).
      if (!isMissingColumnError(e)) throw e;
      const res = await db
        .prepare(
          'SELECT id, username, created_at AS createdAt, expires_at AS expiresAt, used_at AS usedAt FROM invites ORDER BY created_at DESC LIMIT 100'
        )
        .all();
      inviteRows = res.results || [];
    }
    const invites = inviteRows.map((r) => ({
      id: r.id,
      username: r.username,
      role: isRole(r.role) ? r.role : ROLE_CLIENT,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      status: r.usedAt ? 'used' : r.expiresAt <= nowIso ? 'expired' : 'pending',
    }));
    let clients = [];
    try {
      const cres = await db
        .prepare('SELECT username, role, created_at AS createdAt, disabled_at AS disabledAt FROM client_users ORDER BY created_at DESC LIMIT 100')
        .all();
      clients = (cres.results || []).map((r) => ({
        username: r.username,
        role: isRole(r.role) ? r.role : ROLE_CLIENT,
        createdAt: r.createdAt,
        disabled: !!r.disabledAt,
      }));
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
      try {
        const cres = await db
          .prepare('SELECT username, created_at AS createdAt, disabled_at AS disabledAt FROM client_users ORDER BY created_at DESC LIMIT 100')
          .all();
        clients = (cres.results || []).map((r) => ({
          username: r.username,
          role: ROLE_CLIENT,
          createdAt: r.createdAt,
          disabled: !!r.disabledAt,
        }));
      } catch {
        // Pre-0008 databases have no disabled_at: list names, all enabled.
        try {
          const fallback = await db
            .prepare('SELECT username, created_at AS createdAt FROM client_users ORDER BY created_at DESC LIMIT 100')
            .all();
          clients = (fallback.results || []).map((r) => ({ username: r.username, role: ROLE_CLIENT, createdAt: r.createdAt, disabled: false }));
        } catch {}
      }
    }
    return jsonNoStore({ ok: true, invites, clients });
  } catch {
    return jsonNoStore({ error: 'unavailable', message: 'Could not list invites' }, 503);
  }
}
