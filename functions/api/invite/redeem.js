/**
 * Redeem an invite (set the account password): POST /api/invite/redeem
 *   { token, password }
 * Public + token-gated. On success the invite is atomically consumed, the
 * password is PBKDF2-hashed into client_users, sibling pending invites for
 * the same name die, and a FRESH session is minted (never reuses one).
 * Every failure returns the same generic shape — valid/invalid/used/expired
 * are indistinguishable, and the token field is mandatory and strict
 * (an absent or malformed token can never authorize anything).
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
  bumpInviteAttempts,
  checkRateLimit,
  consumeInvite,
  findInviteByHash,
  hashClientPassword,
  inviteUsable,
  isPasswordOk,
  isTokenFormat,
  rateKey,
  sha256Hex,
  MIN_CLIENT_PASSWORD,
  MAX_CLIENT_PASSWORD,
} from '../../_shared/access.js';

const SESSION_SEC = 12 * 3600;

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
  if (!isPasswordOk(password)) {
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

    // Atomic consume: exactly one redeem wins; everyone else sees invalid.
    const consumed = await consumeInvite(db, tokenHash, nowIso);
    if (!consumed) {
      return jsonNoStore({ error: 'invalid', message: 'This link is invalid or expired' }, 401);
    }

    const passHash = await hashClientPassword(password);
    await db
      .prepare('INSERT INTO client_users (username, pass_hash, created_at) VALUES (?, ?, ?)')
      .bind(consumed.username, passHash, nowIso)
      .run();
    // One account, one live invite: any other pending invite for this name dies.
    await db
      .prepare('DELETE FROM invites WHERE username = ? AND used_at IS NULL')
      .bind(consumed.username)
      .run();

    const session = await createSessionToken(secret, `client:${consumed.username}`, SESSION_SEC);
    return jsonNoStore({ ok: true }, 200, {
      'Set-Cookie': sessionCookieHeader(session, SESSION_SEC),
    });
  } catch {
    return jsonNoStore({ error: 'invalid', message: 'This link is invalid or expired' }, 401);
  }
}
