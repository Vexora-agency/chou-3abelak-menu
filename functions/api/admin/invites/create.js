/**
 * Mint an invite link: POST /api/admin/invites/create  { username }
 * Owner-only (master session). The raw token is returned ONCE — only its
 * SHA-256 hash is stored. Fails closed without SITE_URL (no Host-derived
 * links, ever) or without D1.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import {
  INVITE_TTL_SEC,
  inviteLinkFor,
  isInviteUsername,
  newInviteToken,
  normalizeUsername,
  requireOwner,
  sha256Hex,
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
  if (!isInviteUsername(username)) {
    return jsonNoStore(
      { error: 'bad_username', message: 'Use 2-31 lowercase letters, digits, - or _' },
      400
    );
  }

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable', message: 'Login is not configured' }, 503);

  // Reserved: the master env login keeps working under its own name.
  const masterUser = ((env.ADMIN_USERNAME || '').trim() || '').toLowerCase();
  if (masterUser && username === masterUser) {
    return jsonNoStore({ error: 'reserved', message: 'That name belongs to the master login' }, 409);
  }

  try {
    const existing = await db
      .prepare('SELECT username FROM client_users WHERE username = ?')
      .bind(username)
      .first();
    if (existing) {
      return jsonNoStore({ error: 'exists', message: 'A login already exists for this name' }, 409);
    }
    const nowIso = new Date().toISOString();
    const pending = await db
      .prepare('SELECT id FROM invites WHERE username = ? AND used_at IS NULL AND expires_at > ?')
      .bind(username, nowIso)
      .first();
    if (pending) {
      return jsonNoStore({ error: 'pending', message: 'An unused invite already exists — revoke it first' }, 409);
    }

    const token = newInviteToken();
    const link = inviteLinkFor(env, token);
    if (!link) {
      return jsonNoStore({ error: 'unconfigured', message: 'SITE_URL is not configured' }, 503);
    }
    const id = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_SEC * 1000).toISOString();
    await db
      .prepare(
        'INSERT INTO invites (id, username, token_hash, created_at, expires_at, used_at, attempts) VALUES (?, ?, ?, ?, ?, NULL, 0)'
      )
      .bind(id, username, await sha256Hex(token), now.toISOString(), expiresAt)
      .run();
    return jsonNoStore({ ok: true, link, username, expiresAt });
  } catch {
    return jsonNoStore({ error: 'unavailable', message: 'Could not create the invite' }, 503);
  }
}
