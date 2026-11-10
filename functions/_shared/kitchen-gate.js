/**
 * Kitchen-role gate (central policy for the kitchen login).
 *
 * ALLOWED for kitchen (`kitchen` role only — owner/admin and client traffic
 * passes through untouched, see _middleware.js):
 *   - GET  /api/admin/orders            (order feed)
 *   - GET  /api/admin/orders/<id>       (future single-order read)
 *   - PATCH /api/admin/orders/<id>      (status updates: new/confirmed/ready/...)
 * Public surfaces (storefront menu, /api/ordering-state, /api/track/*)
 * stay public as today — no gate needed there.
 *
 * DENIED for kitchen (403): EVERYTHING else under /api/admin/*, notably
 *   - PUT /api/admin/menu              (menu saves)
 *   - POST/DELETE /api/admin/images    (photo upload/delete)
 *   - GET  /api/admin/push-subscriptions (device list stays owner-only)
 *   - reports, backups, versions, trash, import, invites, clients,
 *     sessions, telegram, diagnostics, customer-data, activity,
 *     ordering pause/enabled, report-settings, ...
 * EXCEPTION (own device only): POST/DELETE /api/admin/push-subscriptions
 *   are open to kitchen — subscriptions are endpoint-keyed (a device can
 *   only ever add/remove ITSELF) and the kitchen phone needs background
 *   alerts. GET (list all devices) stays blocked.
 * Owner-only routes (requireOwner) stay owner-only on their own — a kitchen
 * session is never `admin`, so those keep 403ing without any change here.
 *
 * Role source: prefers the canonical `getRole(request, env)` from
 * ./access.js when the parallel role-system work lands there; until then
 * (and as a fallback) the role is read from the verified session payload
 * via ./session.js (`role` claim, or a `kitchen[:...]` subject).
 */

import * as access from './access.js';
import { getSessionCookie, getSessionSecret, verifySessionToken } from './session.js';

export const KITCHEN_ROLE = 'kitchen';

/** Normalize a role string; `owner` is accepted as an alias of `admin`. */
export function normalizeRole(r) {
  if (r === 'admin' || r === 'owner') return 'admin';
  if (r === 'client') return 'client';
  if (r === KITCHEN_ROLE) return KITCHEN_ROLE;
  return null;
}

function roleFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.role === 'string') {
    const norm = normalizeRole(payload.role.trim().toLowerCase());
    if (norm) return norm;
  }
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (sub === 'admin') return 'admin';
  if (sub === KITCHEN_ROLE || sub.startsWith(`${KITCHEN_ROLE}:`)) return KITCHEN_ROLE;
  if (sub === 'client' || sub.startsWith('client:')) return 'client';
  return null;
}

async function readSessionPayload(request, env) {
  try {
    const secret = getSessionSecret(env);
    if (!secret) return null;
    const token = getSessionCookie(request);
    if (!token) return null;
    return await verifySessionToken(secret, token);
  } catch {
    return null;
  }
}

/**
 * Resolve the caller role: `admin` | `client` | `kitchen` | null.
 * `sessionPayloadHint` avoids a second HMAC verification when the caller
 * (e.g. _middleware.js) already verified the session cookie.
 * Never throws; unknown/anonymous callers resolve to null (the middleware
 * then applies the pre-existing closed-by-default behavior).
 */
export async function getRequestRole(request, env, sessionPayloadHint = null) {
  // Canonical hook: use the shared role system when it exists.
  try {
    if (access && typeof access.getRole === 'function') {
      const norm = normalizeRole(await access.getRole(request, env));
      if (norm) return norm;
    }
  } catch {
    // Fall through to the session-payload fallback below.
  }
  if (sessionPayloadHint && typeof sessionPayloadHint === 'object') {
    return roleFromPayload(sessionPayloadHint);
  }
  return roleFromPayload(await readSessionPayload(request, env));
}

/** True only for the two order-surface shapes the kitchen may touch. */
export function isKitchenAllowed(pathname, method) {
  const m = String(method || 'GET').toUpperCase();
  let path = String(pathname || '');
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/+$/, '') || '/';
  if (path === '/api/admin/orders') return m === 'GET';
  if (path.startsWith('/api/admin/orders/')) return m === 'GET' || m === 'PATCH';
  // Role probe for the admin shell (whoami returns {role} only — the UX
  // router depends on it; without it a kitchen session renders the full
  // shell and every forbidden button just 403s).
  if (path === '/api/admin/whoami') return m === 'GET';
  // Own-device push subscription only (background alerts for the kitchen
  // phone). Endpoint-keyed: a device can never touch another's row, and
  // the device LIST (GET) stays owner-only.
  if (path === '/api/admin/push-subscriptions') return m === 'POST' || m === 'DELETE';
  return false;
}
