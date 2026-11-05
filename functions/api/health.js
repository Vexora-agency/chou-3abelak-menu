/**
 * GET /api/health — public liveness probe (no auth, no bindings touched).
 * Shallow (default): answers from compute only — safe to ping often.
 * Deep (?deep=1): exactly ONE `SELECT 1` on ORDERS_DB (no KV, no writes);
 * 503 when the database is missing or the probe query fails.
 * Never exposes versions, config, or row contents.
 */
import { jsonNoStore } from '../_shared/session.js';
import { captureBackendException } from '../_shared/sentry.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  let deep = false;
  try {
    deep = new URL(request.url).searchParams.get('deep') === '1';
  } catch {}
  if (!deep) {
    return jsonNoStore({ ok: true });
  }
  const db = (env && env.ORDERS_DB) || null;
  if (!db) {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  try {
    await db.prepare('SELECT 1').first();
    return jsonNoStore({ ok: true, deep: { d1: 'ok' } });
  } catch (err) {
    captureBackendException(context, err, { binding: 'd1', code: 'health_deep' });
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
}
