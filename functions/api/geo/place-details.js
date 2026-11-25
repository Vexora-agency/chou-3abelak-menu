/**
 * GET /api/geo/place-details?placeId=…
 *
 * Resolves one picked Google suggestion to coordinates (one call per PICK,
 * never per keystroke). The Google key rides server-to-server in the
 * X-Goog-Api-Key header; the client only ever sees
 * { ok:true, lat, lng, label }.
 *
 * - placeId missing/malformed → 400 invalid_query.
 * - Per-IP burst cap (60/min) plus a SHARED Google daily cap
 *   (GOOGLE_PLACES_DAILY_MAX, default 300 — shared with the autocomplete
 *   pass, because details calls bill too) → 429 rate_limited.
 * - Upstream failure → 502 place_failed.
 * - Success → 200 { ok:true, lat, lng, label } via jsonNoStore.
 * - Responses and logs never carry the key, the placeId, or coordinates
 *   beyond the answered point itself.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { checkCustomerApiHeaders } from '../../_shared/auth-session.js';
import { hitRateLimit } from '../../_shared/ratelimit.js';
import { fetchPlaceDetails, googleDailyMax, validatePlaceId, validateSessionToken } from '../../_shared/google.js';

const IP_RATE_MAX = 60;
const IP_RATE_WINDOW_SEC = 60;
const DAY_RATE_WINDOW_SEC = 86400;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const gate = checkCustomerApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  let params;
  try {
    params = new URL(request.url).searchParams;
  } catch {
    return jsonNoStore({ error: 'invalid_query' }, 400);
  }
  const placeId = validatePlaceId(params.get('placeId'));
  if (!placeId) return jsonNoStore({ error: 'invalid_query' }, 400);
  const sessionToken = validateSessionToken(params.get('session'));

  const kv = env ? env.MENU_KV : null;
  if (!(await hitRateLimit(kv, `rl:geo-ggpd:${clientIp(request)}`, IP_RATE_MAX, IP_RATE_WINDOW_SEC))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }
  const day = new Date().toISOString().slice(0, 10);
  if (!(await hitRateLimit(kv, `geo-gg-day:${day}`, googleDailyMax(env), DAY_RATE_WINDOW_SEC))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }

  let upstream;
  try {
    upstream = await fetchPlaceDetails(env, { placeId, sessionToken: sessionToken || undefined });
  } catch {
    return jsonNoStore({ error: 'place_failed' }, 502);
  }
  if (!upstream || !upstream.ok) {
    if (upstream && upstream.error === 'not_configured') {
      return jsonNoStore({ error: 'place_unavailable' }, 503);
    }
    return jsonNoStore({ error: 'place_failed' }, 502);
  }
  return jsonNoStore({ ok: true, lat: upstream.lat, lng: upstream.lng, label: upstream.label });
}
