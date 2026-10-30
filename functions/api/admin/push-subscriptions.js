/**
 * Admin kitchen-push subscriptions: GET (list, masked) / POST (subscribe or
 * unsubscribe this device). ADMIN SESSION REQUIRED — unlike the customer
 * endpoint (which is authorized by the order tracking token), owner devices
 * are bound by the admin login: no session, no subscription. Never returns
 * full endpoints or keys (masked prefix only, for device recognition).
 */
import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import { validatePushSub } from '../../_shared/push.js';

const MAX_BODY_BYTES = 4 * 1024;

function maskEndpoint(e) {
  if (typeof e !== 'string') return '';
  try {
    const u = new URL(e);
    return `${u.host.slice(0, 24)}…${e.slice(-6)}`;
  } catch {
    return `${e.slice(0, 12)}…`;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!hasFeature(env, 'orderLogging')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // List devices (masked) — so the owner sees what's listening.
  if (request.method === 'GET') {
    try {
      const res = await db
        .prepare('SELECT endpoint, label, created_at FROM admin_push_subscriptions ORDER BY created_at DESC')
        .all();
      const rows = (res && res.results) || [];
      return jsonNoStore({
        ok: true,
        devices: rows.map((r) => ({
          id: maskEndpoint(r.endpoint),
          label: typeof r.label === 'string' ? r.label.slice(0, 60) : '',
          createdAt: r.created_at || null,
        })),
      });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, DELETE' });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_content_type' }, 400);
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_body' }, 400);
  }

  // Unsubscribe one device (endpoint required so one device can never drop
  // another's subscription without holding it).
  if (request.method === 'DELETE') {
    const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
    if (!endpoint.startsWith('https://') || endpoint.length > 512) {
      return jsonNoStore({ error: 'bad_request' }, 400);
    }
    try {
      await db.prepare('DELETE FROM admin_push_subscriptions WHERE endpoint = ?1').bind(endpoint).run();
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
    return jsonNoStore({ ok: true });
  }

  // Subscribe (upsert by endpoint: re-subscribing refreshes keys).
  // Failures name the field (never values) so the UI can explain + support
  // can pinpoint without a single guess.
  const sub = validatePushSub(body || {});
  if (!sub.ok) {
    return jsonNoStore({ error: 'bad_subscription', field: sub.field, got: sub.got }, 400);
  }
  const label = body && typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '';
  try {
    await db
      .prepare(
        'INSERT OR REPLACE INTO admin_push_subscriptions (endpoint, p256dh, auth, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
      )
      .bind(sub.endpoint, sub.p256dh, sub.auth, label || null, new Date().toISOString())
      .run();
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
  return jsonNoStore({ ok: true });
}
