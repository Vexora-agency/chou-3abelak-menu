/**
 * Redeem an invite: POST /api/invite/redeem
 *   client invite:  { token, password } — sets the account password
 *   kitchen invite: { token } — passwordless device pairing (single-use link,
 *                   long-lived session; the account gets an unusable random
 *                   pass_hash that can never sign in via /api/auth/login)
 * Public + token-gated. On success the invite is atomically consumed, the
 * password is PBKDF2-hashed into client_users (client path only), sibling
 * pending invites for the same name die, and a FRESH session is minted
 * (never reuses one). Every failure returns the same generic shape —
 * valid/invalid/used/expired are indistinguishable, and the token field is
 * mandatory and strict (an absent or malformed token can never authorize
 * anything).
 */

import {
  checkApiHeaders,
  createSessionToken,
  getSessionSecret,
  jsonNoStore,
  readJsonBody,
  sessionCookieHeader,
} from '../../_shared/session.js';
import {
  ROLE_CLIENT,
  ROLE_KITCHEN,
  bumpInviteAttempts,
  checkRateLimit,
  consumeInvite,
  findInviteByHash,
  hashClientPassword,
  inviteUsable,
  isMissingColumnError,
  isPasswordOk,
  isRole,
  isTokenFormat,
  rateKey,
  sha256Hex,
  MIN_CLIENT_PASSWORD,
  MAX_CLIENT_PASSWORD,
} from '../../_shared/access.js';

const SESSION_SEC = 12 * 3600;
// Kitchen pairing sessions outlive a shift: one single-use link keeps the
// device signed in for months. Revocation (disable/delete) still kills the
// session immediately — the link stays single-use, only the session is long.
const KITCHEN_SESSION_SEC = 90 * 24 * 3600;

/**
 * Unusable password slot for passwordless (kitchen) accounts: 128 hex chars
 * (64 bytes) of CSPRNG output, deliberately NOT in the `pbkdf2$…` format —
 * parsePasswordHash() rejects it, so verifyPassword() can never accept any
 * password against it. No password to guess, phish, or brute-force.
 */
function newUnusablePassHash() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'POST' });
  }
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_request', message: 'Content-Type must be application/json' }, 400);
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonNoStore({ error: 'bad_request', message: 'Invalid JSON body' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  // Client path keeps its exact shape check here: a PROVIDED but weak
  // password is rejected before any rate-limit or DB work, exactly as
  // before. A missing password skips this gate — it may be a passwordless
  // kitchen pairing, decided below once the invite role is known. A client
  // invite with no password still fails the re-check there with the
  // identical weak response.
  if (password.length > 0 && !isPasswordOk(password)) {
    return jsonNoStore(
      {
        error: 'weak',
        message: `Password must be ${MIN_CLIENT_PASSWORD}-${MAX_CLIENT_PASSWORD} characters`,
      },
      400
    );
  }

  const kv = env.MENU_KV || null;
  const rl = await checkRateLimit(kv, rateKey('invite:redeem', request), 10, 15 * 60);
  if (!rl.ok) return jsonNoStore({ error: 'locked', retryMin: rl.retryMin, message: 'Too many attempts' }, 429);

  const db = env.ORDERS_DB || null;
  const secret = getSessionSecret(env);
  if (!isTokenFormat(token) || !db || !secret) {
    // Same generic failure as a wrong token — format/config reveal nothing.
    return jsonNoStore({ error: 'invalid', message: 'This link is invalid or expired' }, 401);
  }

  const nowIso = new Date().toISOString();
  try {
    const tokenHash = await sha256Hex(token);
    const row = await findInviteByHash(db, tokenHash);
    if (!inviteUsable(row, nowIso)) {
      if (row) await bumpInviteAttempts(db, row);
      return jsonNoStore({ error: 'invalid', message: 'This link is invalid or expired' }, 401);
    }
    // The invite carries the account role (client default, kitchen for staff
    // invites). Fail-closed read: anything unexpected becomes 'client'.
    const inviteRole = isRole(row.role) ? row.role : ROLE_CLIENT;

    // Kitchen path: passwordless pairing. The token alone authorizes; any
    // password field sent along is ignored (kitchen accounts can never use
    // it — /api/auth/login refuses them outright).
    if (inviteRole === ROLE_KITCHEN) {
      // Atomic consume: exactly one pairing wins; everyone else sees invalid.
      const consumed = await consumeInvite(db, tokenHash, nowIso);
      if (!consumed) {
        return jsonNoStore({ error: 'invalid', message: 'This link is invalid or expired' }, 401);
      }
      const unusableHash = newUnusablePassHash();
      // Create-or-update: a fresh device name inserts; re-pairing an already
      // paired name (a second invite minted for it) rotates the unusable
      // hash and keeps the kitchen role. ON CONFLICT keeps this atomic.
      // Pre-0028 database (no role column): the statement fails and the
      // outer catch returns the generic invalid — kitchen fails closed,
      // exactly like the client legacy fallback below refuses it.
      await db
        .prepare(
          'INSERT INTO client_users (username, pass_hash, created_at, role) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(username) DO UPDATE SET pass_hash = excluded.pass_hash, role = excluded.role'
        )
        .bind(consumed.username, unusableHash, nowIso, ROLE_KITCHEN)
        .run();
      // One account, one live invite: any other pending invite for this name dies.
      await db
        .prepare('DELETE FROM invites WHERE username = ? AND used_at IS NULL')
        .bind(consumed.username)
        .run();

      // Long-lived session carrying the role claim (90 days).
      const session = await createSessionToken(secret, `client:${consumed.username}`, KITCHEN_SESSION_SEC, {
        role: ROLE_KITCHEN,
      });
      return jsonNoStore({ ok: true }, 200, {
        'Set-Cookie': sessionCookieHeader(session, KITCHEN_SESSION_SEC),
      });
    }

    // Client path: unchanged — a password is mandatory.
    if (!isPasswordOk(password)) {
      return jsonNoStore(
        {
          error: 'weak',
          message: `Password must be ${MIN_CLIENT_PASSWORD}-${MAX_CLIENT_PASSWORD} characters`,
        },
        400
      );
    }

    // Atomic consume: exactly one redeem wins; everyone else sees invalid.
    const consumed = await consumeInvite(db, tokenHash, nowIso);
    if (!consumed) {
      return jsonNoStore({ error: 'invalid', message: 'This link is invalid or expired' }, 401);
    }

    const passHash = await hashClientPassword(password);
    // Kitchen invites never reach here (paired above); fail-closed read kept
    // so anything unexpected still becomes 'client', never escalated.
    const clientRole = isRole(consumed.role) ? consumed.role : ROLE_CLIENT;
    try {
      await db
        .prepare('INSERT INTO client_users (username, pass_hash, created_at, role) VALUES (?, ?, ?, ?)')
        .bind(consumed.username, passHash, nowIso, clientRole)
        .run();
    } catch (e) {
      // Pre-0028 database: no role column. Only a default-role account is
      // storable in the legacy shape; a kitchen redeem fails closed (the
      // generic invalid below) rather than creating the wrong role.
      if (!isMissingColumnError(e) || clientRole !== ROLE_CLIENT) throw e;
      await db
        .prepare('INSERT INTO client_users (username, pass_hash, created_at) VALUES (?, ?, ?)')
        .bind(consumed.username, passHash, nowIso)
        .run();
    }
    // One account, one live invite: any other pending invite for this name dies.
    await db
      .prepare('DELETE FROM invites WHERE username = ? AND used_at IS NULL')
      .bind(consumed.username)
      .run();

    // Fresh session minted with the role claim (legacy sessions simply lack
    // it and read as 'client' via roleFromPayload until re-login).
    const session = await createSessionToken(secret, `client:${consumed.username}`, SESSION_SEC, { role: clientRole });
    return jsonNoStore({ ok: true }, 200, {
      'Set-Cookie': sessionCookieHeader(session, SESSION_SEC),
    });
  } catch {
    return jsonNoStore({ error: 'invalid', message: 'This link is invalid or expired' }, 401);
  }
}
