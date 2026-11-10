/**
 * Who am I: GET /api/admin/whoami — { role: 'owner' | 'kitchen' | 'client' }
 *
 * UX-only role signal so the admin shell can show kitchen sessions the
 * orders board alone (real enforcement stays in the per-route server
 * gates + requireOwner). Behind the admin middleware like every other
 * /api/admin/* route, so reaching here already means authenticated.
 *
 * Role source: the canonical getRole() (JWT claim, DB fallback for legacy
 * sessions). Client and kitchen are DISTINCT — a client login must never
 * be routed into the kitchen shell.
 */

import {
  checkApiHeaders,
  jsonNoStore,
} from '../../_shared/session.js';
import { getRole } from '../../_shared/access.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'GET' });
  }
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  // Local development bypass mirrors functions/api/admin/_middleware.js.
  try {
    const url = new URL(request.url);
    if (env.ALLOW_LOCAL_DEV === '1' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return jsonNoStore({ role: 'owner', via: 'local' });
    }
  } catch {}

  // Canonical role: owner session, kitchen/client invite sessions.
  // Client and kitchen stay distinct — never route a client into the
  // kitchen shell. Authenticated-without-cookie (Cloudflare Access
  // assertion, already accepted by the middleware) is the owner path.
  try {
    const role = await getRole(request, env);
    if (role === 'owner' || role === 'kitchen' || role === 'client') {
      return jsonNoStore({ role });
    }
  } catch {}

  // Authenticated without a cookie session (Cloudflare Access assertion,
  // which the middleware already accepted) — the owner path.
  return jsonNoStore({ role: 'owner', via: 'access' });
}
