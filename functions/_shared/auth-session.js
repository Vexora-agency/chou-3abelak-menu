/**
 * Customer-session helpers for Pages Functions.
 *
 * `requireCustomer` is the server-side gate for every protected customer
 * API. UI hiding is not protection: the session is validated against
 * Better Auth on every request, and the returned user id is the only
 * source of truth for ownership checks.
 *
 * No SQL here — account routes belong in
 * `functions/_shared/repositories/orders.repo.js`.
 */

import { createAuth } from './auth.js';
import { checkApiHeaders, jsonNoStore } from './session.js';

/** Customer-side twin of the admin CSRF gate (same rules, different header). */
export function checkCustomerApiHeaders(request) {
  return checkApiHeaders(request, 'menu-customer');
}

/**
 * Read the Better Auth session for this request.
 * Returns `null` when there is no valid session.
 * Throws only for infrastructure/config failures (auth factory, D1).
 */
export async function getCustomerSession(request, env, authFactory = createAuth) {
  const auth = authFactory(env, request);
  const result = await auth.api.getSession({ headers: request.headers });
  return result || null;
}

/**
 * @returns {{ ok: true, user: object, session: object } | { ok: false, response: Response }}
 */
export async function requireCustomer(request, env, authFactory = createAuth) {
  let result;
  try {
    result = await getCustomerSession(request, env, authFactory);
  } catch {
    return {
      ok: false,
      response: jsonNoStore({ error: 'auth_unavailable', message: 'Authentication is temporarily unavailable' }, 503),
    };
  }

  if (!result || !result.user || !result.session) {
    return {
      ok: false,
      response: jsonNoStore({ error: 'unauthorized', message: 'Sign in required' }, 401),
    };
  }

  return { ok: true, user: result.user, session: result.session };
}
