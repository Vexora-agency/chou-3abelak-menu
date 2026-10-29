/**
 * List invites: GET /api/admin/invites/list — owner-only.
 * Returns metadata only (usernames, dates, status). Hashes never leave D1.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { requireOwner } from '../../../_shared/access.js';

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
    const res = await db
      .prepare(
        'SELECT id, username, created_at AS createdAt, expires_at AS expiresAt, used_at AS usedAt FROM invites ORDER BY created_at DESC LIMIT 100'
      )
      .all();
    const invites = (res.results || []).map((r) => ({
      id: r.id,
      username: r.username,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      status: r.usedAt ? 'used' : r.expiresAt <= nowIso ? 'expired' : 'pending',
    }));
    return jsonNoStore({ ok: true, invites });
  } catch {
    return jsonNoStore({ error: 'unavailable', message: 'Could not list invites' }, 503);
  }
}
