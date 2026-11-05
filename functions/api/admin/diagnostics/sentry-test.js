/**
 * Sentry backend test: POST /api/admin/diagnostics/sentry-test — owner-only.
 * Captures ONE deliberate test error with the request id so the owner can
 * verify it in Sentry (issue shows source=admin-test + the reqId tag).
 * Answers 200 with the reqId either way — the response contract never
 * depends on whether monitoring is configured or reachable.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { requireOwner } from '../../../_shared/access.js';
import { logError } from '../../../_shared/log.js';
import { captureBackendException } from '../../../_shared/sentry.js';

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'POST' });
  }
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const owner = await requireOwner(request, context.env);
  if (!owner) return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);

  const err = new Error('Sentry admin backend test (deliberate, owner-triggered)');
  let reqId = null;
  try {
    reqId = logError(request, err, { code: 'sentry_test', status: 200 });
  } catch {
    // keep null — the 200 response carries a null reqId then
  }
  captureBackendException(context, err, { code: 'sentry_test', reqId, test: true });
  return jsonNoStore({ ok: true, reqId: reqId || null });
}
