/**
 * GET /api/geo/resolve-link?url=<google-maps-link>
 *
 * Pasted Google Maps links (full URLs and maps.app.goo.gl short links):
 * follows the redirect server-side, extracts coordinates from the final
 * URL (@lat,lng or !3d/!4d forms) and validates the point against the
 * delivery zones. Answers { ok:true, lat, lng, outside } — `outside` is
 * true when zones are selected and the point falls in another country
 * (the client still pins it, with a warning, exactly like a hand pin).
 *
 * - Missing/unparseable link or unlisted host → 400 invalid_link.
 * - No coordinates in the target → 404 not_found (generic, no URL echoed).
 * - Reverse lookup failure → coordinates WITHOUT a zone verdict
 *   ({ ok:true, lat, lng, outside:null }) — never a hard failure.
 * - Rate limits mirror the reverse proxy (shared keys).
 * - Responses and logs never carry the pasted URL.
 */

import { jsonNoStore } from '../../_shared/session.js';
import { checkCustomerApiHeaders } from '../../_shared/auth-session.js';
import { hitRateLimit } from '../../_shared/ratelimit.js';
import { extractCoordsFromGoogleUrl, validateMapsLinkUrl } from '../../_shared/maplink.js';
import { fetchReverseCountry, validateLatLng } from '../../_shared/reverse.js';
import { extractServiceCountries } from '../../_shared/geoapify.js';

const IP_RATE_MAX = 60;
const IP_RATE_WINDOW_SEC = 60;
const DAY_RATE_WINDOW_SEC = 86400;
const DEFAULT_DAILY_MAX = 2500;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function readMenu(env) {
  try {
    const kv = env ? env.MENU_KV : null;
    if (!kv || typeof kv.get !== 'function') return null;
    const menu = await kv.get('menu', { type: 'json' });
    return menu && typeof menu === 'object' ? menu : null;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const gate = checkCustomerApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  let raw = null;
  try {
    raw = new URL(request.url).searchParams.get('url');
  } catch {
    return jsonNoStore({ error: 'invalid_link' }, 400);
  }
  if (!validateMapsLinkUrl(raw)) return jsonNoStore({ error: 'invalid_link' }, 400);

  const kv = env ? env.MENU_KV : null;
  if (!(await hitRateLimit(kv, `rl:geo-rl:${clientIp(request)}`, IP_RATE_MAX, IP_RATE_WINDOW_SEC))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }
  const day = new Date().toISOString().slice(0, 10);
  const rawMax = env && typeof env.GEO_REVERSE_DAILY_MAX === 'string'
    ? env.GEO_REVERSE_DAILY_MAX.trim()
    : env && env.GEO_REVERSE_DAILY_MAX;
  const dayMax = (() => {
    const n = Number(rawMax);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_MAX;
  })();
  if (!(await hitRateLimit(kv, `geo-rev-day:${day}`, dayMax, DAY_RATE_WINDOW_SEC))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }

  // Follow the short link server-side (redirects stay server-side; the
  // pasted URL is never reflected). 8s cap via AbortController.
  let finalUrl = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, 8000);
    try {
      const res = await fetch(raw.trim(), { signal: controller.signal, redirect: 'follow' });
      if (res && typeof res.url === 'string' && res.url) finalUrl = res.url;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    finalUrl = null;
  }
  const coords = finalUrl ? extractCoordsFromGoogleUrl(finalUrl) : extractCoordsFromGoogleUrl(raw);
  if (!coords || !validateLatLng(coords.lat, coords.lng)) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }

  // Zone verdict (best effort): unknown country reads as null, never a block.
  let outside = null;
  try {
    const menu = await readMenu(env);
    const zones = extractServiceCountries(menu);
    if (zones.length > 0) {
      const rev = await fetchReverseCountry(env, { lat: coords.lat, lng: coords.lng });
      if (rev && rev.ok) {
        outside = rev.country ? !zones.includes(rev.country.toLowerCase()) : null;
      }
    } else {
      outside = false;
    }
  } catch {
    outside = null;
  }
  return jsonNoStore({ ok: true, lat: coords.lat, lng: coords.lng, outside });
}
