/**
 * Mint an invite link: POST /api/admin/invites/create  { username, role?, durationDays? }
 * Owner-only (master session). The raw token is returned ONCE — only its
 * SHA-256 hash is stored. Fails closed without SITE_URL (no Host-derived
 * links, ever) or without D1. role is 'client' (default) or 'kitchen';
 * anything else is a 400 — never silently coerced. durationDays is
 * 1, 7, 30 or null/omitted (open-ended, the default); anything else is a
 * 400. The duration is stamped onto the account as expires_at at redeem
 * time; open invites mint accounts with expires_at NULL.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import {
  INVITE_TTL_SEC,
  ROLE_CLIENT,
  inviteLinkFor,
  isDurationDays,
  isInviteUsername,
  isMissingColumnError,
  isRole,
  newInviteToken,
  normalizeDurationDays,
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

  const roleInput = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
  if (roleInput && !isRole(roleInput)) {
    return jsonNoStore({ error: 'bad_role', message: "Role must be 'client' or 'kitchen'" }, 400);
  }
  const role = roleInput || ROLE_CLIENT;

  // Optional account lifetime: 1/7/30 days, or null/omitted for open-ended.
  // Numeric strings ('7') are accepted leniently; anything else is a 400 —
  // never silently coerced to open.
  const rawDuration = body.durationDays === undefined ? null : body.durationDays;
  const durationInput =
    typeof rawDuration === 'string' && rawDuration.trim() !== '' ? Number(rawDuration.trim()) : rawDuration;
  if (!isDurationDays(durationInput)) {
    return jsonNoStore({ error: 'bad_duration', message: 'Duration must be 1, 7, 30 or omitted (open-ended)' }, 400);
  }
  const durationDays = normalizeDurationDays(durationInput);

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
    try {
      await db
        .prepare(
          'INSERT INTO invites (id, username, role, duration_days, token_hash, created_at, expires_at, used_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)'
        )
        .bind(id, username, role, durationDays, await sha256Hex(token), now.toISOString(), expiresAt)
        .run();
    } catch (e) {
      // Pre-0030 database: no duration_days column. An open-ended invite is
      // storable in the older shape; a limited one fails closed (503) rather
      // than silently minting an open-ended account.
      if (!isMissingColumnError(e)) throw e;
      if (durationDays !== null) throw e;
      try {
        await db
          .prepare(
            'INSERT INTO invites (id, username, role, token_hash, created_at, expires_at, used_at, attempts) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)'
          )
          .bind(id, username, role, await sha256Hex(token), now.toISOString(), expiresAt)
          .run();
      } catch (e2) {
        // Pre-0028 database: no role column either. A default-role invite is
        // storable in the legacy shape; a kitchen invite fails closed (503)
        // rather than silently minting the wrong role.
        if (!isMissingColumnError(e2) || role !== ROLE_CLIENT) throw e2;
        await db
          .prepare(
            'INSERT INTO invites (id, username, token_hash, created_at, expires_at, used_at, attempts) VALUES (?, ?, ?, ?, ?, NULL, 0)'
          )
          .bind(id, username, await sha256Hex(token), now.toISOString(), expiresAt)
          .run();
      }
    }
    return jsonNoStore({ ok: true, link, username, role, durationDays, expiresAt });
  } catch {
    return jsonNoStore({ error: 'unavailable', message: 'Could not create the invite' }, 503);
  }
}
