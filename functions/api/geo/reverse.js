/**
 * GET /api/geo/reverse?lat=…&lng=…&lang=…
 *
 * Server-side Nominatim reverse-geocode proxy (zoom=18, building level).
 * The browser cannot send the identifying User-Agent the Nominatim usage
 * policy requires, so the keyless lookup rides server-to-server here with
 * `chou-3abelak-menu/1.0` while the client only ever sees the stripped
 * `{ ok: true, address: string|null }` shape.
 *
 * - lat/lng missing, non-numeric or out of range → 400 invalid_query.
 * - Per-IP burst cap (60/min) plus a global daily cap
 *   (GEO_REVERSE_DAILY_MAX, default 2500) → 429 rate_limited. Both ride
 *   the shared KV limiter, which fails OPEN when KV is missing.
 * - Upstream failure → 502 reverse_failed (address null is NOT a failure:
 *   open water and unnamed plots legitimately have no address — the client
 *   then confirms with raw coordinates).
 * - Success → 200 { ok: true, address } via jsonNoStore (no-store).
 * - Responses and logs never carry coordinates or the provider body.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { checkCustomerApiHeaders } from '../../_shared/auth-session.js';
import { hitRateLimit } from '../../_shared/ratelimit.js';
import { fetchReverse, validateLatLng, normalizeReverseLang } from '../../_shared/reverse.js';

const IP_RATE_MAX = 60;
const IP_RATE_WINDOW_SEC = 60;
const DAY_RATE_WINDOW_SEC = 86400;
const DEFAULT_DAILY_MAX = 2500;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function dailyMax(env) {
  const raw = env && typeof env.GEO_REVERSE_DAILY_MAX === 'string'
    ? env.GEO_REVERSE_DAILY_MAX.trim()
    : env && env.GEO_REVERSE_DAILY_MAX;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_MAX;
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
  const coords = validateLatLng(params.get('lat'), params.get('lng'));
  if (!coords) return jsonNoStore({ error: 'invalid_query' }, 400);
  const lang = normalizeReverseLang(params.get('lang'));

  const kv = env ? env.MENU_KV : null;
  if (!(await hitRateLimit(kv, `rl:geo-rev:${clientIp(request)}`, IP_RATE_MAX, IP_RATE_WINDOW_SEC))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }
  const day = new Date().toISOString().slice(0, 10);
  if (!(await hitRateLimit(kv, `geo-rev-day:${day}`, dailyMax(env), DAY_RATE_WINDOW_SEC))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }

  let upstream;
  try {
    upstream = await fetchReverse(env, { lat: coords.lat, lng: coords.lng, lang });
  } catch {
    return jsonNoStore({ error: 'reverse_failed' }, 502);
  }
  if (!upstream || !upstream.ok) {
    return jsonNoStore({ error: 'reverse_failed' }, 502);
  }
  return jsonNoStore({ ok: true, address: upstream.address });
}
