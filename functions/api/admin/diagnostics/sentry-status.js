/**
 * Sentry status: GET /api/admin/diagnostics/sentry-status — owner-only.
 * Returns whether backend error monitoring is configured plus the
 * environment/release it reports under. The DSN itself NEVER leaves
 * the server (configured is a boolean only).
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { requireOwner } from '../../../_shared/access.js';

function envText(env, key, fallback) {
  try {
    const v = env && typeof env[key] === 'string' ? env[key].trim() : '';
    return v || fallback;
  } catch {
    return fallback;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'GET' });
  }
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const owner = await requireOwner(request, env);
  if (!owner) return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);

  return jsonNoStore({
    ok: true,
    configured: Boolean(envText(env, 'SENTRY_DSN', '')),
    environment: envText(env, 'SENTRY_ENVIRONMENT', 'production'),
    release: envText(env, 'SENTRY_RELEASE', '') || null,
  });
}
